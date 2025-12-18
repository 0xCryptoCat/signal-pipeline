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
// DB INTEGRATION (optional)
// ============================================================

import {
  storeSignalData,
  isSignalSeen,
  getTokenEnhancement,
  getWalletEnhancement,
  initializeDB,
  getSeenSignalsFromDB,
  pinIndexAfterUpdate,
} from './lib/db-integration.js';

// ============================================================
// CONSTANTS
// ============================================================

const SIGNAL_LABELS = {
  '1': 'Smart Money',
  '2': 'Influencers', 
  '3': 'Whales'
};

const TRENDS = {
  1: '🟢 BUY',
  2: '🔴 SELL'
};

const CHAIN_NAMES = {
  501: 'Solana',
  1: 'Ethereum',
  56: 'BSC',
  8453: 'Base'
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

function formatUsd(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '$0';
  const sign = n < 0 ? '-' : '+';
  const absN = Math.abs(n);
  if (absN >= 1_000_000) return `${sign}$${(absN / 1_000_000).toFixed(1)}M`;
  if (absN >= 1_000) return `${sign}$${(absN / 1_000).toFixed(1)}K`;
  if (absN >= 1) return `${sign}$${absN.toFixed(0)}`;
  return `${sign}$${absN.toFixed(2)}`;
}

function formatPct(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '0%';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function getTokenAge(createTime) {
  const ageMs = Date.now() - parseInt(createTime);
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
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
// SCORING (Simplified - no recalculation of OKX metrics)
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

/**
 * Format UTC timestamp
 */
function formatUtcTime() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Format a signal for Telegram (HTML)
 * @param {Object} signal - Signal data
 * @param {Array} walletDetails - Wallet details with scores
 * @param {Object} options - Optional: { tokenHistory } from DB for repeat signals
 */
function formatSignalMessage(signal, walletDetails, options = {}) {
  const explorer = CHAIN_EXPLORERS[signal.chainId] || CHAIN_EXPLORERS[501];
  const dex = DEX_LINKS[signal.chainId] || DEX_LINKS[501];
  const { tokenHistory } = options;
  
  // Calculate signal average score from wallets
  const scoredWallets = walletDetails.filter(w => w.entryScore !== undefined);
  const signalAvgScore = scoredWallets.length > 0
    ? scoredWallets.reduce((sum, w) => sum + w.entryScore, 0) / scoredWallets.length
    : 0;
  const rating = signalRating(signalAvgScore);
  
  // Header with rating
  let msg = `#${signal.chainName} 🚨 <b>${SIGNAL_LABELS[signal.signalLabel] || 'Signal'}</b> ${rating.emoji} ${signalAvgScore.toFixed(2)}\n\n`;
  
  // Token info with embedded link
  msg += `🪙 <b><a href="${explorer.token}${signal.tokenAddress}">${escapeHtml(signal.tokenName)}</a></b> (<code>${escapeHtml(signal.tokenSymbol)}</code>)`;
  
  // Add signal count if token seen before
  if (tokenHistory && tokenHistory.signalCount > 0) {
    const count = tokenHistory.signalCount;
    const priceChange = tokenHistory.firstPrice > 0 
      ? ((parseFloat(signal.priceAtSignal) / tokenHistory.firstPrice - 1) * 100)
      : 0;
    const priceEmoji = priceChange >= 100 ? '🚀' : priceChange >= 0 ? '📈' : '📉';
    msg += ` 🔄 <b>${count + 1}x</b>`;
    if (count > 0 && Math.abs(priceChange) >= 10) {
      msg += ` ${priceEmoji}${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(0)}%`;
    }
  }
  msg += '\n';
  
  msg += `<code>${signal.tokenAddress}</code>\n`;
  
  // Chain + Age + DEX links
  msg += `Age: ${signal.tokenAge} - `;
  msg += `<a href="${dex.dextools}${signal.tokenAddress}">DexT</a> | `;
  msg += `<a href="${dex.dexscreener}${signal.tokenAddress}">DexS</a>\n\n`;
  
  // Signal stats
  msg += `MCap: ${formatUsd(signal.mcapAtSignal)} | Vol: ${formatUsd(signal.volumeInSignal)} | ${formatUsd(signal.priceAtSignal)}\n`;
  msg += `${signal.addressNum} wallet${signal.addressNum > 1 ? 's' : ''} ${signal.maxMultiplier}x (${formatPct(signal.maxPctGain)})\n`;
  
  for (const w of walletDetails) {
    const isKol = w.addressInfo?.kolAddress;
    const twitter = w.addressInfo?.twitterHandle;
    const pnl = parseFloat(w.pnl7d) || 0;
    const roi = parseFloat(w.roi) || 0;
    const winRate = parseFloat(w.winRate) || 0;
    
    // Wallet link + Entry score on same line
    const shortAddr = `${w.walletAddress.slice(0, 6)}...${w.walletAddress.slice(-4)}`;
    msg += `\n<a href="${explorer.wallet}${w.walletAddress}">${shortAddr}</a>`;
    
    // Entry score inline
    if (w.entryScore !== undefined) {
      msg += ` ${scoreEmoji(w.entryScore)} ${w.entryScore.toFixed(2)} avg`;
      if (w.entryScore >= 0.5) {
        msg += ` ✨`;
      }
    }
    
    // KOL badge
    if (isKol && twitter) {
      msg += ` 🎤 <a href="https://twitter.com/${twitter}">@${escapeHtml(twitter)}</a>`;
    }
    
    msg += '\n';
    
    // OKX metrics on next line
    msg += `PnL ${formatUsd(pnl)} | ROI ${formatPct(roi)} | WR ${winRate.toFixed(0)}%\n`;
  }
  
  // Timestamp with hidden signal ID embedded in link (invisible to users)
  // The # anchor contains the sig ID for dedup parsing if needed
  const sigId = `${signal.batchId}-${signal.batchIndex}`;
  msg += `\n<i><a href="https://t.me/#${sigId}">${formatUtcTime()}</a></i>`;
  
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

async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
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
  
  for (const activity of sortedActivities) {
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
      const { signal, walletDetails } = await processSignal(
        activity, 
        data.tokenInfo, 
        data.overviewList,
        { scoreWallets }
      );
      
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
      
      // Get token history for repeat signal indicator
      let tokenHistory = null;
      if (db) {
        tokenHistory = getTokenEnhancement(db, signal.tokenAddress);
      }
      
      // Format and send message
      const msg = formatSignalMessage(signal, walletDetails, { tokenHistory });
      
      if (botToken && chatId) {
        const result = await sendTelegramMessage(botToken, chatId, msg);
        if (result.ok) {
          console.log(`   ✅ Posted to Telegram (avgScore: ${signalAvgScore.toFixed(2)})`);
          // Persist signal ID to /tmp for cold start recovery
          await saveSignalId(chainName, signalKey);
          
          // Store to Telegram DB for tracking (if enabled)
          if (db) {
            try {
              await storeSignalData(db, signal, walletDetails, signalAvgScore);
            } catch (dbErr) {
              console.warn(`   ⚠️ DB store failed (non-fatal): ${dbErr.message}`);
            }
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
  
  // Pin index after batch for cold start recovery
  if (db && newSignals > 0) {
    await pinIndexAfterUpdate(db);
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
