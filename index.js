/**
 * Signal Monitor Pipeline
 * 
 * Polls OKX signal endpoints and posts to Telegram channel.
 * Uses OKX reported pnl7d/roi/winRate (pre-calculated)
 * Uses our entry scoring for quality assessment
 * 
 * Deployment: Vercel Serverless (cron trigger)
 */

// ============================================================
// DB INTEGRATION (v5 - file-based)
// ============================================================

import {
  storeSignalData,
  updateTokenMsgId,
  updateTokenSecurity,
  getTokenLastMsgId,
  isSignalSeen,
  getTokenEnhancement,
  getWalletEnhancement,
  getWalletReputation,
  categorizeWallets,
  initializeDB,
  getSeenSignalsFromDB,
  saveDB,
  pinIndexAfterUpdate,
} from './lib/db-integration-v5.js';

import { generateChart } from './lib/chart-generator.js';
import { fetchSecurity } from './lib/security-fetcher.js';

// Channel IDs
const PRIVATE_CHANNEL = '-1003474351030';
const PUBLIC_CHANNEL = '-1003627230339';

// ============================================================
// CONSTANTS
// ============================================================

const SIGNAL_LABELS = {
  '1': 'Smart Money',
  '2': 'Influencers', 
  '3': 'Whales'
};

const CHAIN_NAMES = {
  501: 'SOL',
  1: 'ETH',
  56: 'BSC',
  8453: 'BASE'
};

const CHAIN_EXPLORERS = {
  501: { name: 'Solscan', wallet: 'https://solscan.io/account/', token: 'https://solscan.io/token/' },
  1: { name: 'Etherscan', wallet: 'https://etherscan.io/address/', token: 'https://etherscan.io/token/' },
  56: { name: 'BscScan', wallet: 'https://bscscan.com/address/', token: 'https://bscscan.com/token/' },
  8453: { name: 'Basescan', wallet: 'https://basescan.org/address/', token: 'https://basescan.org/token/' }
};

// DEX tools links
const DEX_LINKS = {
  501: {
    dextools: 'https://www.dextools.io/app/en/solana/pair-explorer/',
    dexscreener: 'https://dexscreener.com/solana/'
  },
  1: {
    dextools: 'https://www.dextools.io/app/en/ether/pair-explorer/',
    dexscreener: 'https://dexscreener.com/ethereum/'
  },
  56: {
    dextools: 'https://www.dextools.io/app/en/bnb/pair-explorer/',
    dexscreener: 'https://dexscreener.com/bsc/'
  },
  8453: {
    dextools: 'https://www.dextools.io/app/en/base/pair-explorer/',
    dexscreener: 'https://dexscreener.com/base/'
  }
};

const LOOKBACK_MS = 8 * 60 * 60 * 1000;
const LOOKFORWARD_MS = 24 * 60 * 60 * 1000;

// Scoring endpoints
const ENDPOINTS = {
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
  candles: 'https://web3.okx.com/priapi/v5/dex/token/market/dex-token-hlc-candles',
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function parseTokenKey(tokenKey) {
  const parts = tokenKey.split('!@#');
  return { chainId: parseInt(parts[0]), tokenAddress: parts[1] };
}

function formatUsd(num, showSign = false) {
  const n = parseFloat(num);
  if (isNaN(n)) return '$0';
  const sign = showSign ? (n < 0 ? '-' : '+') : (n < 0 ? '-' : '');
  const absN = Math.abs(n);
  if (absN >= 1_000_000) return `${sign}$${(absN / 1_000_000).toFixed(1)}M`;
  if (absN >= 1_000) return `${sign}$${(absN / 1_000).toFixed(1)}K`;
  if (absN >= 1) return `${sign}$${absN.toFixed(0)}`;
  if (absN >= 0.01) return `${sign}$${absN.toFixed(2)}`;
  if (absN >= 0.0001) return `${sign}$${absN.toFixed(4)}`;
  return `${sign}$${absN.toPrecision(3)}`;
}

function formatPnl(num) {
  return formatUsd(num, true); // PnL always shows +/-
}

function formatPct(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '0%';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function getTokenAge(createTime) {
  const ageMs = Date.now() - parseInt(createTime);
  const hours = ageMs / (1000 * 60 * 60);
  const days = hours / 24;
  const weeks = days / 7;
  const months = days / 30;
  
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  if (days < 7) return `${days.toFixed(1)}d`;
  if (weeks < 4) return `${weeks.toFixed(1)}w`;
  return `${months.toFixed(1)}mo`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scoreEmoji(score) {
  if (score >= 1.5) return '🔵';
  if (score >= 0.5) return '🟢';
  if (score >= -0.5) return '⚪️';
  if (score >= -1.5) return '🟠';
  return '🔴';
}

/**
 * Get signal rating based on average wallet score
 * Uses the -2 to +2 scale with 5 color tiers
 */
function signalRating(avgScore) {
  if (avgScore >= 1.5) return { emoji: '🔵', label: 'Excellent', color: 'blue' };
  if (avgScore >= 0.5) return { emoji: '🟢', label: 'Good', color: 'green' };
  if (avgScore >= -0.5) return { emoji: '⚪️', label: 'Neutral', color: 'gray' };
  if (avgScore >= -1.5) return { emoji: '🟠', label: 'Weak', color: 'orange' };
  return { emoji: '🔴', label: 'Poor', color: 'red' };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// API FUNCTIONS
// ============================================================

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchFilterActivity(chainId = 501, trend = '1', pageSize = 10) {
  const t = Date.now();
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview?t=${t}`;
  
  const body = {
    chainId,
    trend,
    signalLabelList: [1, 2, 3],
    protocolIdList: [],
    tokenMetricsFilter: {},
    signalMetricsFilter: {},
    pageSize
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (json.code !== 0) throw new Error(`API Error: ${json.error_message || json.msg}`);
  return json.data;
}

async function fetchSignalDetail(chainId, tokenAddress, batchId, batchIndex) {
  const t = Date.now();
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail?` +
    `chainId=${chainId}&tokenContractAddress=${tokenAddress}&batchId=${batchId}&batchIndex=${batchIndex}&t=${t}`;

  const json = await fetchJson(url);
  if (json.code !== 0) throw new Error(`API Error: ${json.error_message || json.msg}`);
  return json.data;
}

async function fetchTradingHistory(chainId, walletAddress, limit = 30) {
  const allTokens = [];
  let offset = 0;
  
  while (allTokens.length < limit) {
    const url = `${ENDPOINTS.tradingHistory}?walletAddress=${walletAddress}&chainId=${chainId}&isAsc=false&sortType=2&offset=${offset}&limit=20&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    
    const data = await fetchJson(url);
    if (data.code !== 0) break;
    
    allTokens.push(...data.data.tokenList);
    if (!data.data.hasNext || allTokens.length >= limit) break;
    offset = data.data.offset;
    await sleep(50);
  }
  
  return allTokens.slice(0, limit);
}

async function fetchCandles(chainId, tokenAddress, limit = 300) {
  const url = `${ENDPOINTS.candles}?chainId=${chainId}&address=${tokenAddress}&bar=15m&limit=${limit}&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== '0' && data.code !== 0) return [];
    
    return (data.data || []).map(c => ({
      timestamp: parseInt(c[0], 10),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));
  } catch {
    return [];
  }
}

// ============================================================
// SCORING (Relative Entry Timing - Before/After Context)
// 
// Scores range from -2 to +2:
// +2: Bought the dip, price mooned after (excellent timing)
// +1: Good entry, price pumped after
//  0: Neutral entry
// -1: Poor entry, bought pump, price dipped after
// -2: Terrible entry, bought pump, price dumped after
// ============================================================

function classifyBefore(entryPrice, beforeMin, beforeMax) {
  const riseToEntry = ((entryPrice - beforeMin) / beforeMin) * 100;
  const fallToEntry = ((beforeMax - entryPrice) / beforeMax) * 100;
  
  if (riseToEntry > 25 && riseToEntry > fallToEntry) return 'pumped_to';
  if (riseToEntry > 10 && riseToEntry > fallToEntry) return 'rose_to';
  if (fallToEntry > 25 && fallToEntry > riseToEntry) return 'dumped_to';
  if (fallToEntry > 10 && fallToEntry > riseToEntry) return 'fell_to';
  return 'flat';
}

function classifyAfter(entryPrice, afterMin, afterMax) {
  const pctUp = ((afterMax - entryPrice) / entryPrice) * 100;
  const pctDown = ((entryPrice - afterMin) / entryPrice) * 100;
  
  if (pctUp > 25 && pctUp > pctDown) return 'moon';
  if (pctUp > 10 && pctUp > pctDown) return 'pump';
  if (pctDown > 25 && pctDown > pctUp) return 'dump';
  if (pctDown > 10 && pctDown > pctUp) return 'dip';
  return 'flat';
}

function scoreBuy(beforeCtx, afterCtx) {
  const matrix = {
    'dumped_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'fell_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'flat': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'rose_to': { 'moon': 1, 'pump': 0, 'flat': -1, 'dip': -2, 'dump': -2 },
    'pumped_to': { 'moon': 0, 'pump': -1, 'flat': -1, 'dip': -2, 'dump': -2 },
  };
  return matrix[beforeCtx]?.[afterCtx] ?? 0;
}

function scoreEntry(entryPrice, entryTime, candles) {
  const beforeCandles = candles.filter(c => 
    c.timestamp < entryTime && c.timestamp >= entryTime - LOOKBACK_MS
  );
  const afterCandles = candles.filter(c => 
    c.timestamp > entryTime && c.timestamp <= entryTime + LOOKFORWARD_MS
  );
  
  const beforeMin = beforeCandles.length > 0 ? Math.min(...beforeCandles.map(c => c.low)) : entryPrice;
  const beforeMax = beforeCandles.length > 0 ? Math.max(...beforeCandles.map(c => c.high)) : entryPrice;
  const afterMin = afterCandles.length > 0 ? Math.min(...afterCandles.map(c => c.low)) : entryPrice;
  const afterMax = afterCandles.length > 0 ? Math.max(...afterCandles.map(c => c.high)) : entryPrice;
  
  const beforeCtx = classifyBefore(entryPrice, beforeMin, beforeMax);
  const afterCtx = classifyAfter(entryPrice, afterMin, afterMax);
  
  return scoreBuy(beforeCtx, afterCtx);
}

/**
 * Score a wallet's entry quality (simplified - 7d tokens only)
 */
async function scoreWalletEntries(walletAddress, chainId, maxTokens = 15) {
  const tokens = await fetchTradingHistory(chainId, walletAddress, maxTokens);
  
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentTokens = tokens.filter(t => 
    t.latestTime && parseInt(t.latestTime, 10) >= sevenDaysAgo
  );
  
  if (recentTokens.length === 0) return { avgScore: 0, count: 0 };
  
  const scores = [];
  
  for (const token of recentTokens.slice(0, 10)) {
    const tokenAddress = token.tokenContractAddress;
    const buyAvgPrice = parseFloat(token.buyAvgPrice) || 0;
    const buyCount = token.totalTxBuy || 0;
    
    if (buyCount > 0 && buyAvgPrice > 0) {
      const candles = await fetchCandles(chainId, tokenAddress);
      
      if (candles.length > 0) {
        const closestCandle = candles.reduce((best, c) => 
          Math.abs(c.close - buyAvgPrice) < Math.abs(best.close - buyAvgPrice) ? c : best
        );
        const score = scoreEntry(buyAvgPrice, closestCandle.timestamp, candles);
        for (let i = 0; i < Math.min(buyCount, 5); i++) {
          scores.push(score);
        }
      }
    }
    
    await sleep(30);
  }
  
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  
  return { avgScore, count: scores.length };
}

// ============================================================
// TELEGRAM FORMATTING (HTML)
// ============================================================

const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━'; 

/**
 * Format UTC timestamp
 */
function formatUtcTime() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Build a row of score dot emojis for visual representation
 * Shows up to 11 dots, sorted by score
 */
function buildScoreDots(walletDetails) {
  const scoredWallets = walletDetails.filter(w => w.entryScore !== undefined);
  if (scoredWallets.length === 0) return '';
  
  // Sort by score descending and take up to 11
  const sorted = [...scoredWallets]
    .sort((a, b) => b.entryScore - a.entryScore)
    .slice(0, 11);
  
  return sorted.map(w => scoreEmoji(w.entryScore)).join('');
}

/**
 * Format a signal for PRIVATE channel (HTML)
 * Full wallet details with explorer links
 */
function getContextTitle(score) {
  if (score >= 1.5) return 'Pre-Pump';
  if (score >= 0.5) return 'Momentum';
  if (score >= -0.5) return 'Dip-Buy';
  if (score >= -1.5) return 'DCA';
  return 'Top Blast';
}

function formatSignalMessage(signal, walletDetails, options = {}) {
  const explorer = CHAIN_EXPLORERS[signal.chainId] || CHAIN_EXPLORERS[501];
  const { tokenHistory, walletCategories, db, security } = options;
  
  // Calculate signal average score from wallets
  const scoredWallets = walletDetails.filter(w => w.entryScore !== undefined);
  const signalAvgScore = scoredWallets.length > 0
    ? scoredWallets.reduce((sum, w) => sum + w.entryScore, 0) / scoredWallets.length
    : 0;
  const rating = signalRating(signalAvgScore);
  const contextTitle = getContextTitle(signalAvgScore);
  
  // ===== HEADER =====
  const isNewToken = !tokenHistory || !tokenHistory.signalCount || tokenHistory.signalCount === 0;
  const signalEmoji = isNewToken ? '🆕' : '🚨';
  let msg = `#${signal.chainName} ${signalEmoji} <b>${SIGNAL_LABELS[signal.signalLabel] || ''} Signal</b> ${rating.emoji} ${contextTitle}\n`;
  msg += `${SEPARATOR}\n`;
  
  // ===== WALLET SUMMARY LINE =====
  const newCount = walletCategories?.newWallets?.length || walletDetails.length;
  const totalUnique = walletCategories?.totalUnique || walletDetails.length;
  const repeatCount = walletCategories?.repeatWallets?.length || 0;
  
  // Format: "11 new wallets (14 total) │ up +181.7% │ 🔄x2"
  let summaryLine = `${newCount} new wallet${newCount !== 1 ? 's' : ''} (${totalUnique} total)`;
  
  // Max gain
  const maxPct = parseFloat(signal.maxPctGain) || 0;
  if (maxPct !== 0) {
    const gainEmoji = maxPct >= 0 ? 'up' : 'down';
    summaryLine += ` │ ${gainEmoji} <b>${formatPct(maxPct)}</b>`;
  }
  
  // Repeat signal count
  if (tokenHistory && tokenHistory.signalCount > 0) {
    summaryLine += ` │ 🔄x${tokenHistory.signalCount + 1}`;
  }
  
  msg += `${summaryLine}\n`;
  
  // Score dots row
  const scoreDots = buildScoreDots(walletDetails);
  if (scoreDots) {
    msg += `${scoreDots}\n`;
  }
  
  msg += `${SEPARATOR}\n`;
  
  // ===== TOKEN INFO =====
  // Token name with link, symbol, price change since first signal
  let tokenLine = `<b><a href="${explorer.token}${signal.tokenAddress}">${escapeHtml(signal.tokenName)}</a></b> ($${escapeHtml(signal.tokenSymbol)})`;
  
  if (tokenHistory && tokenHistory.firstPrice > 0) {
    const priceChange = ((parseFloat(signal.priceAtSignal) / tokenHistory.firstPrice - 1) * 100);
    if (Math.abs(priceChange) >= 5) {
      const priceEmoji = priceChange >= 0 ? '📈' : '📉';
      tokenLine += ` │ ${priceEmoji}${formatPct(priceChange)}`;
    }
  }
  
  msg += `${tokenLine}\n`;
  msg += `<code>${signal.tokenAddress}</code>\n\n`;
  
  // ===== STATS BLOCK (code formatted) =====
  msg += `<code>`;
  if (security) {
    if (security.status === 'UNKNOWN') {
      msg += `Risk : Unknown\n`;
    } else {
      let icon = '✅';
      if (security.isHoneypot) icon = '🍯';
      else if (security.status === 'SCAM') icon = '❌';
      else if (security.status === 'RISK') icon = '⚠️';
      
      msg += `Risk : ${security.riskScore}/100 ${icon}\n`;
    }
  }
  msg += `Age  : ${signal.tokenAge}\n`;
  msg += `MCap : ${formatUsd(signal.mcapAtSignal)}\n`;
  msg += `Vol  : ${formatUsd(signal.volumeInSignal)}</code>\n`;
  msg += `${SEPARATOR}\n`;
  
  // ===== WALLET DETAILS =====
  const repeatPrefixes = new Set(
    (walletCategories?.repeatWallets || []).map(w => w.walletAddress.slice(0, 8))
  );
  
  for (const w of walletDetails) {
    const isKol = w.addressInfo?.kolAddress;
    const twitter = w.addressInfo?.twitterHandle;
    const pnl = parseFloat(w.pnl7d) || 0;
    const roi = parseFloat(w.roi) || 0;
    const okxWinRate = parseFloat(w.winRate) || 0;
    const isRepeat = repeatPrefixes.has(w.walletAddress.slice(0, 8));
    
    // Get our tracked reputation data if available
    const rep = db ? getWalletReputation(db, w.walletAddress) : null;
    
    // Wallet link
    const shortAddr = `${w.walletAddress.slice(0, 6)}...${w.walletAddress.slice(-4)}`;
    msg += `<a href="${explorer.wallet}${w.walletAddress}">${shortAddr}</a>`;
    
    // Entry score
    if (w.entryScore !== undefined) {
      msg += ` ${scoreEmoji(w.entryScore)} ${w.entryScore >= 0 ? '+' : ''}${w.entryScore.toFixed(2)}`;
    }
    
    // Repeat indicator
    if (isRepeat) {
      msg += ` 🔄`;
    }
    
    // KOL badge
    if (isKol && twitter) {
      msg += ` 🎤 <a href="https://x.com/${twitter}">@${escapeHtml(twitter)}</a>`;
    }
    
    msg += '\n';
    
    // Stats line: PnL | ROI | WR
    msg += `<code>PnL ${formatPnl(pnl)} │ ROI ${formatPct(roi)} │ WR ${okxWinRate.toFixed(0)}%</code>\n\n`;
  }
  
  // ===== TIMESTAMP =====
  const sigId = `${signal.batchId}-${signal.batchIndex}`;
  msg += `${SEPARATOR}\n`;
  msg += `<i><a href="https://t.me/#${sigId}">${formatUtcTime()}</a></i>`;
  
  return msg;
}

/**
 * Format a REDACTED signal for PUBLIC channel (HTML)
 * No wallet addresses or links, just summary stats
 */
function formatRedactedSignalMessage(signal, walletDetails, options = {}) {
  const explorer = CHAIN_EXPLORERS[signal.chainId] || CHAIN_EXPLORERS[501];
  const { tokenHistory, walletCategories, security } = options;
  
  // Calculate signal average score from wallets
  const scoredWallets = walletDetails.filter(w => w.entryScore !== undefined);
  const signalAvgScore = scoredWallets.length > 0
    ? scoredWallets.reduce((sum, w) => sum + w.entryScore, 0) / scoredWallets.length
    : 0;
  const rating = signalRating(signalAvgScore);
  const contextTitle = getContextTitle(signalAvgScore);
  
  // ===== HEADER =====
  const isNewToken = !tokenHistory || !tokenHistory.signalCount || tokenHistory.signalCount === 0;
  const signalEmoji = isNewToken ? '🆕' : '🚨';
  let msg = `#${signal.chainName} ${signalEmoji} <b>${SIGNAL_LABELS[signal.signalLabel] || ''} Signal</b> ${rating.emoji} ${contextTitle}\n`;
  msg += `${SEPARATOR}\n`;
  
  // ===== WALLET SUMMARY LINE =====
  const newCount = walletCategories?.newWallets?.length || walletDetails.length;
  const totalUnique = walletCategories?.totalUnique || walletDetails.length;
  
  // Format: "11 new wallets (14 total) │ up +181.7% │ 🔄x2"
  let summaryLine = `${newCount} new wallet${newCount !== 1 ? 's' : ''} (${totalUnique} total)`;
  
  // Max gain
  const maxPct = parseFloat(signal.maxPctGain) || 0;
  if (maxPct !== 0) {
    const gainEmoji = maxPct >= 0 ? 'up' : 'down';
    summaryLine += ` │ ${gainEmoji} <b>${formatPct(maxPct)}</b>`;
  }
  
  // Repeat signal count
  if (tokenHistory && tokenHistory.signalCount > 0) {
    summaryLine += ` │ 🔄x${tokenHistory.signalCount + 1}`;
  }
  
  msg += `${summaryLine}\n`;
  
  // Score dots row
  const scoreDots = buildScoreDots(walletDetails);
  if (scoreDots) {
    msg += `${scoreDots}\n`;
  }
  
  msg += `${SEPARATOR}\n`;
  
  // ===== TOKEN INFO =====
  let tokenLine = `<b><a href="${explorer.token}${signal.tokenAddress}">${escapeHtml(signal.tokenName)}</a></b> ($${escapeHtml(signal.tokenSymbol)})`;
  
  if (tokenHistory && tokenHistory.firstPrice > 0) {
    const priceChange = ((parseFloat(signal.priceAtSignal) / tokenHistory.firstPrice - 1) * 100);
    if (Math.abs(priceChange) >= 5) {
      const priceEmoji = priceChange >= 0 ? '📈' : '📉';
      tokenLine += ` │ ${priceEmoji}${formatPct(priceChange)}`;
    }
  }
  
  msg += `${tokenLine}\n`;
  msg += `<code>${signal.tokenAddress}</code>\n`;
  msg += `\n`;
  
  // ===== STATS BLOCK (code formatted) =====
  msg += `<code>Age  : ${signal.tokenAge}\n`;
  msg += `MCap : ${formatUsd(signal.mcapAtSignal)}\n`;
  msg += `Vol  : ${formatUsd(signal.volumeInSignal)}</code>\n`;
  msg += `${SEPARATOR}\n`;
  
  // ===== TIMESTAMP =====
  const sigId = `${signal.batchId}-${signal.batchIndex}`;
  msg += `<i><a href="https://t.me/#${sigId}">${formatUtcTime()}</a></i>\n`;
  
  // ===== CTA =====
  msg += `<i>Full wallet details in premium channel! Coming soon!</i>`;
  
  return msg;
}

// ============================================================
// TELEGRAM API
// ============================================================

/**
 * Get the last message sent to a channel/chat
 * Uses getUpdates with negative offset to get recent messages
 */
async function getLastChannelMessage(botToken, chatId) {
  try {
    // For channels, we need to use getChat to get pinned, but can't get history
    // Workaround: Use forwardMessage trick or store in bot's chat
    // Simplest: Just return null and rely on in-memory + embedded sig ID
    
    // Try getChatHistory via Bot API (requires bot to be admin)
    // This won't work for most setups, so we'll use a different approach
    return null;
  } catch {
    return null;
  }
}

/**
 * Get last signal IDs we've sent (from recent messages)
 * Parses the embedded sig:XXXXX code from messages
 */
async function getRecentSignalIds(botToken, chatId, chainName) {
  try {
    // Unfortunately, Telegram Bot API doesn't allow reading channel history
    // We'll use /tmp file storage as a workaround (persists in warm lambdas)
    const fs = await import('fs').then(m => m.promises);
    const tmpFile = `/tmp/last-signal-${chainName}.txt`;
    
    try {
      const content = await fs.readFile(tmpFile, 'utf8');
      return new Set(content.split('\n').filter(Boolean));
    } catch {
      return new Set();
    }
  } catch {
    return new Set();
  }
}

/**
 * Save signal ID to /tmp (persists across warm invocations)
 */
async function saveSignalId(chainName, signalKey) {
  try {
    const fs = await import('fs').then(m => m.promises);
    const tmpFile = `/tmp/last-signal-${chainName}.txt`;
    
    // Read existing, add new, keep last 50
    let existing = [];
    try {
      const content = await fs.readFile(tmpFile, 'utf8');
      existing = content.split('\n').filter(Boolean);
    } catch { /* file doesn't exist */ }
    
    existing.push(signalKey);
    const toSave = existing.slice(-50).join('\n'); // Keep last 50
    
    await fs.writeFile(tmpFile, toSave);
  } catch (err) {
    console.log(`   ⚠️ Could not save signal ID: ${err.message}`);
  }
}

/**
 * Build inline keyboard buttons for PRIVATE channel
 */
function buildPrivateButtons(chainId, tokenAddress) {
  const dex = DEX_LINKS[chainId] || DEX_LINKS[501];
  
  return {
    inline_keyboard: [
      [
        { text: '📊 DexTools', url: `${dex.dextools}${tokenAddress}` },
        { text: '📈 DexScreener', url: `${dex.dexscreener}${tokenAddress}` },
      ],
      [
        { text: '🤖 Buy', callback_data: `buy_${tokenAddress.slice(0, 8)}` },
      ],
    ],
  };
}

/**
 * Build inline keyboard buttons for PUBLIC channel
 */
function buildPublicButtons(chainId, tokenAddress) {
  const dex = DEX_LINKS[chainId] || DEX_LINKS[501];
  
  return {
    inline_keyboard: [
      [
        { text: '📊 DexTools', url: `${dex.dextools}${tokenAddress}` },
        { text: '📈 DexScreener', url: `${dex.dexscreener}${tokenAddress}` },
      ],
      [
        { text: '🔓 Premium Coming Soon!', callback_data: 'premium_soon' },
      ],
    ],
  };
}

async function sendTelegramMessage(botToken, chatId, text, replyToMsgId = null, inlineKeyboard = null) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  
  // Reply to previous message if provided (for chaining signals)
  if (replyToMsgId) {
    body.reply_to_message_id = replyToMsgId;
    body.allow_sending_without_reply = true; // Don't fail if original deleted
  }
  
  // Add inline keyboard if provided
  if (inlineKeyboard) {
    body.reply_markup = inlineKeyboard;
  }
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  return res.json();
}

async function sendTelegramPhoto(botToken, chatId, photoBuffer, caption, replyToMsgId = null, inlineKeyboard = null) {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');
  // formData.append('disable_web_page_preview', 'true'); // Not supported for photos
  
  // Append photo buffer
  const blob = new Blob([photoBuffer], { type: 'image/png' });
  formData.append('photo', blob, 'chart.png');

  if (replyToMsgId) {
    formData.append('reply_to_message_id', replyToMsgId);
    formData.append('allow_sending_without_reply', 'true');
  }
  
  if (inlineKeyboard) {
    formData.append('reply_markup', JSON.stringify(inlineKeyboard));
  }
  
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  
  return res.json();
}

// ============================================================
// MAIN PIPELINE
// ============================================================

/**
 * Process a single signal
 */
async function processSignal(activity, tokenInfo, overviewList, config) {
  const { chainId, tokenAddress } = parseTokenKey(activity.tokenKey);
  const tokenData = tokenInfo[activity.tokenKey] || {};
  const overview = overviewList.find(o => o.tokenKey === activity.tokenKey) || {};
  const labelIndex = parseInt(activity.signalLabel) - 1;
  
  // Build signal object
  const signal = {
    signalId: activity.id,
    batchId: activity.batchId,
    batchIndex: activity.batchIndex,
    eventTime: activity.eventTime,
    trend: activity.trend,
    signalLabel: activity.signalLabel,
    addressNum: activity.addressNum,
    chainId,
    chainName: CHAIN_NAMES[chainId] || `Chain ${chainId}`,
    tokenAddress,
    tokenName: tokenData.tokenName || 'Unknown',
    tokenSymbol: tokenData.tokenSymbol || '???',
    tokenAge: tokenData.tokenCreateTime ? getTokenAge(tokenData.tokenCreateTime) : 'Unknown',
    priceAtSignal: activity.price,
    mcapAtSignal: activity.mcap,
    volumeInSignal: activity.volume,
    maxMultiplier: overview.maxIncreaseMultiplier || '0',
    maxPctGain: overview.maxIncreasePercentage || '0',
  };
  
  // Fetch wallet details
  const detail = await fetchSignalDetail(chainId, tokenAddress, activity.batchId, activity.batchIndex);
  const walletDetails = detail.addresses || [];
  
  // Score wallets if enabled
  if (config.scoreWallets) {
    for (const wallet of walletDetails) {
      try {
        const scoring = await scoreWalletEntries(wallet.walletAddress, chainId, 10);
        wallet.entryScore = scoring.avgScore;
        wallet.entryCount = scoring.count;
      } catch (err) {
        console.error(`Failed to score ${wallet.walletAddress}:`, err.message);
        wallet.entryScore = undefined;
      }
      await sleep(100);
    }
  }
  
  return { signal, walletDetails };
}

/**
 * Main monitor function
 * 
 * Deduplication: in-memory Set (resets on cold start, acceptable)
 * Filtering: Only post signals with avgScore > minScore (default 0)
 * DB Storage: When useDB=true, stores signals/tokens/wallets to Telegram channels
 */
async function monitorSignals(config) {
  const {
    chainId = 501,
    trend = '1',
    pageSize = 5,
    botToken,
    chatId,
    scoreWallets = true,
    minWallets = 1,
    minScore = 0,            // Only post signals with avgScore > this
    seenSignals = new Set(), // In-memory dedup (per invocation)
    useDB = false,           // Enable Telegram DB storage
  } = config;
  
  const chainName = CHAIN_NAMES[chainId] || `Chain${chainId}`;
  
  console.log(`\n📡 Polling signals (chain=${chainId}, trend=${trend}, minScore=${minScore}, db=${useDB})...`);
  
  // Initialize DB if enabled (also loads index from pinned message for dedup)
  let db = null;
  if (useDB && botToken) {
    try {
      db = await initializeDB(botToken, chainId);
      console.log(`   💾 DB initialized for ${chainName}`);
      
      // Merge DB seen signals into seenSignals set (survives cold starts!)
      const dbSeenSignals = getSeenSignalsFromDB(db);
      for (const sig of dbSeenSignals) {
        // Convert DB key format (batchId_batchIndex) to our format (batchId-batchIndex)
        const converted = sig.replace('_', '-');
        seenSignals.add(converted);
      }
      console.log(`   💾 Loaded ${dbSeenSignals.size} seen signals from DB index`);
    } catch (err) {
      console.warn(`   ⚠️ DB init failed, continuing without DB: ${err.message}`);
    }
  }
  
  // Load persisted signal IDs from /tmp (survives warm lambda restarts)
  const persistedSignals = await getRecentSignalIds(botToken, chatId, chainName);
  console.log(`   📁 Loaded ${persistedSignals.size} persisted signal IDs from /tmp`);
  
  // Merge persisted with in-memory
  for (const sig of persistedSignals) {
    seenSignals.add(sig);
  }
  
  const data = await fetchFilterActivity(chainId, trend, pageSize);
  
  let newSignals = 0;
  let skippedByScore = 0;
  
  // Sort by ID descending to process newest first
  const sortedActivities = [...data.activityList].sort((a, b) => b.id - a.id);
  
  const startTime = Date.now();
  const TIMEOUT_LIMIT = 45000; // 45 seconds (leave 15s buffer for Vercel 60s limit)

  for (const activity of sortedActivities) {
    // Timeout Guard
    if (Date.now() - startTime > TIMEOUT_LIMIT) {
      console.warn(`   ⏱️ Time limit reached (${TIMEOUT_LIMIT}ms), stopping processing to avoid timeout. Remaining signals will be picked up next run.`);
      break;
    }

    const signalKey = `${activity.batchId}-${activity.batchIndex}`;
    
    // In-memory + persisted + DB dedup
    if (seenSignals.has(signalKey)) {
      console.log(`   ⏭️ Already seen: ${signalKey}`);
      continue;
    }
    seenSignals.add(signalKey);
    
    // Skip if too few wallets
    if (activity.addressNum < minWallets) {
      console.log(`   ⏭️ Skipping ${activity.id}: only ${activity.addressNum} wallet(s)`);
      continue;
    }
    
    console.log(`   🔔 Processing signal ${activity.id}: ${data.tokenInfo[activity.tokenKey]?.tokenSymbol || 'Unknown'}`);
    
    try {
      let { signal, walletDetails } = await processSignal(
        activity, 
        data.tokenInfo, 
        data.overviewList,
        { scoreWallets }
      );
      
      // Security Check
      let security = null;
      try {
        security = await fetchSecurity(signal.chainId, signal.tokenAddress);
        if (security.status === 'SCAM') {
          console.log(`   🛑 Skipping SCAM token: ${signal.tokenSymbol} (Score: ${security.riskScore})`);
          
          // Update DB if token exists (mark as SCAM/RUGGED)
          if (db) {
            updateTokenSecurity(db, signal.tokenAddress, 'SCAM');
          }
          
          skippedByScore++; // Count as skipped
          await saveSignalId(chainName, signalKey);
          continue;
        }
      } catch (err) {
        console.warn(`   ⚠️ Security check failed: ${err.message}`);
      }

      // Get token history and categorize wallets EARLY (for filtering)
      let tokenHistory = null;
      let replyToMsgId = null;
      let walletCategories = null;
      
      if (db) {
        tokenHistory = getTokenEnhancement(db, signal.tokenAddress);
        // Get previous message ID for reply chaining
        replyToMsgId = getTokenLastMsgId(db, signal.tokenAddress);
        // Categorize wallets as new vs repeat
        walletCategories = categorizeWallets(db, signal.tokenAddress, walletDetails);
        
        // FILTER: Only keep NEW wallets for this signal
        // This prevents old wallets from skewing the score or re-triggering signals
        if (walletCategories && walletCategories.newWallets) {
           // If we have new wallets, use ONLY them for scoring and display
           // If all wallets are repeats, this becomes empty and will be skipped by minScore check
           walletDetails = walletCategories.newWallets;
           
           // Update signal wallet count to reflect filtered list
           signal.walletCount = walletDetails.length;
           
           console.log(`   👥 Filtered wallets: ${walletDetails.length} new (${walletCategories.repeatWallets.length} repeats removed)`);
        }
      }

      // Calculate signal average score BEFORE deciding to post
      const scoredWallets = walletDetails.filter(w => w.entryScore !== undefined);
      const signalAvgScore = scoredWallets.length > 0
        ? scoredWallets.reduce((sum, w) => sum + w.entryScore, 0) / scoredWallets.length
        : 0;
      
      // Score filter: only post if avgScore > minScore
      if (signalAvgScore <= minScore) {
        console.log(`   ⏭️ Skipping ${activity.id}: avgScore ${signalAvgScore.toFixed(2)} <= ${minScore}`);
        skippedByScore++;
        // Still persist so we don't re-process on cold start
        await saveSignalId(chainName, signalKey);
        continue;
      }
      
      // Format and send message (reply to previous signal for same token)
      // Pass db for wallet reputation lookup
      const msg = formatSignalMessage(signal, walletDetails, { tokenHistory, walletCategories, db, security });
      const redactedMsg = formatRedactedSignalMessage(signal, walletDetails, { tokenHistory, walletCategories, db, security });
      const privateButtons = buildPrivateButtons(signal.chainId, signal.tokenAddress);
      const publicButtons = buildPublicButtons(signal.chainId, signal.tokenAddress);
      
      // Check if signal is a loss (negative score or negative gain)
      const maxPctGain = parseFloat(signal.maxPctGain) || 0;
      const isLoss = signalAvgScore < 0 || maxPctGain < 0;
      
      if (botToken && chatId) {
        // Generate Chart
        let chartBuffer = null;
        try {
          const tokenData = data.tokenInfo[activity.tokenKey] || {};
          const tokenLogo = tokenData.tokenLogoUrl || tokenData.logoUrl || null;
          chartBuffer = await generateChart(
            CHAIN_NAMES[signal.chainId]?.toLowerCase() || 'sol',
            signal.tokenSymbol,
            tokenLogo,
            null, // priceData (mock)
            []    // signalEntries
          );
        } catch (err) {
          console.error('   ⚠️ Chart generation failed:', err.message);
        }

        // Send to PRIVATE channel (full details)
        let result;
        if (chartBuffer) {
          try {
            result = await sendTelegramPhoto(botToken, chatId, chartBuffer, msg, replyToMsgId, privateButtons);
          } catch (e) {
            console.warn(`   ⚠️ Private photo exception: ${e.message}`);
            result = null;
          }
        }
        
        // Fallback to text if photo failed or no chart
        if (!result || !result.ok) {
          if (result && !result.ok) {
            console.warn(`   ⚠️ Private photo failed (${result.description}), falling back to text...`);
          }
          result = await sendTelegramMessage(botToken, chatId, msg, replyToMsgId, privateButtons);
        }

        if (result.ok) {
          const replyInfo = replyToMsgId ? ` (reply to ${replyToMsgId})` : '';
          console.log(`   ✅ Posted to PRIVATE (avgScore: ${signalAvgScore.toFixed(2)})${replyInfo}`);
          // Persist signal ID to /tmp for cold start recovery
          await saveSignalId(chainName, signalKey);
          
          // Store to Telegram DB for tracking (if enabled)
          if (db) {
            try {
              await storeSignalData(db, signal, walletDetails, signalAvgScore, security);
              // Store the private message ID for future reply chaining
              await updateTokenMsgId(db, signal.tokenAddress, result.result.message_id, false);
            } catch (dbErr) {
              console.warn(`   ⚠️ DB store failed (non-fatal): ${dbErr.message}`);
            }
          }
          
          // Send to PUBLIC channel (redacted) - WITH reply chaining to public messages
          // Skip public channel for losses (negative score or negative gain)
          if (isLoss) {
            console.log(`   ⏭️ Skipping PUBLIC (loss signal: score=${signalAvgScore.toFixed(2)}, gain=${maxPctGain.toFixed(1)}%)`);
          } else try {
            const publicReplyId = db ? getTokenLastMsgId(db, signal.tokenAddress, true) : null;
            let publicResult;
            
            // Try sending with photo first
            if (chartBuffer) {
              try {
                publicResult = await sendTelegramPhoto(botToken, PUBLIC_CHANNEL, chartBuffer, redactedMsg, publicReplyId, publicButtons);
              } catch (e) {
                console.warn(`   ⚠️ Public photo exception: ${e.message}`);
                publicResult = null;
              }
            }
            
            // Fallback to text if photo failed or no chart
            if (!publicResult || !publicResult.ok) {
              if (publicResult && !publicResult.ok) {
                console.warn(`   ⚠️ Public photo failed (${publicResult.description}), falling back to text...`);
              }
              publicResult = await sendTelegramMessage(botToken, PUBLIC_CHANNEL, redactedMsg, publicReplyId, publicButtons);
            }

            if (publicResult.ok) {
              const pubReplyInfo = publicReplyId ? ` (reply to ${publicReplyId})` : '';
              console.log(`   ✅ Posted to PUBLIC (redacted)${pubReplyInfo}`);
              // Store the public message ID for public reply chaining
              if (db) {
                await updateTokenMsgId(db, signal.tokenAddress, publicResult.result.message_id, true);
              }
            } else {
              console.log(`   ⚠️ Public channel error: ${publicResult.description}`);
            }
          } catch (pubErr) {
            console.log(`   ⚠️ Public channel failed (non-fatal): ${pubErr.message}`);
          }
        } else {
          console.log(`   ❌ Telegram error: ${result.description}`);
        }
      } else {
        console.log(`   📝 Message (no bot configured):\n${msg}`);
      }
      
      newSignals++;
      
    } catch (err) {
      console.error(`   ❌ Error processing signal ${activity.id}:`, err.message);
    }
    
    await sleep(200);
  }
  
  // Save DB after batch (v5 file-based storage)
  if (db) {
    try {
      await saveDB(db);
      console.log(`   💾 DB saved`);
    } catch (err) {
      console.warn(`   ⚠️ DB save failed: ${err.message}`);
    }
  }
  
  console.log(`   📊 Processed ${newSignals} new signal(s), skipped ${skippedByScore} by score`);
  
  return { 
    newSignals, 
    skippedByScore,
    seenSignals, 
  };
}

// ============================================================
// CLI / LOCAL TESTING
// ============================================================

async function main() {
  console.log('🚀 Signal Monitor Pipeline - Test Mode\n');
  
  // For testing, don't send to Telegram - just print
  const config = {
    chainId: 501,
    trend: '1',
    pageSize: 3,
    botToken: null,  // Set to test locally
    chatId: null,
    scoreWallets: true,
    minWallets: 2,
    seenSignals: new Set(),
  };
  
  // Single poll
  await monitorSignals(config);
  
  console.log('\n✅ Test complete');
}

// Export for Vercel
export {
  monitorSignals,
  processSignal,
  formatSignalMessage,
  sendTelegramMessage,
  scoreWalletEntries,
  CHAIN_EXPLORERS,
};

// Run if called directly
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(console.error);
}
