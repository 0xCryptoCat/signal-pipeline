/**
 * /api/gains - Telegram Gains Leaderboard Bot Command
 * 
 * Handles /gains command and inline keyboard period selection.
 * Shows top performing signal calls with stats.
 * 
 * Usage:
 *   /gains             - Shows ALL CHAINS combined leaderboard
 *   /gains sol         - Shows SOL only
 *   /gains 24h         - Shows all chains, 24h period
 *   /gains sol 24h     - Shows SOL, 24h period
 *   Inline button      - Switch time periods & chains
 * 
 * POST /api/gains (webhook mode - for Telegram bot)
 * GET /api/gains?period=7d&chain=all (API mode - for testing)
 */

import { TelegramDBv5, CHAIN_IDS, CHANNELS } from '../lib/telegram-db-v5.js';
import pnlHandler from './pnl.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAINS = ['sol', 'eth', 'bsc', 'base'];

// ============================================================
// CONFIG
// ============================================================

const PERIODS = {
  '1h': '1h', '6h': '6h', '12h': '12h', '24h': '24h',
  '2d': '2d', '3d': '3d', '7d': '7d', '1w': '7d', '2w': '2w', '4w': '4w',
};

const PERIOD_LABELS = {
  '1h': '1h', '6h': '6h', '12h': '12h', '24h': '24h',
  '2d': '2d', '3d': '3d', '7d': '1w', '1w': '1w', '2w': '2w', '4w': '4w',
};

// Chain emoji (updated per request)
const CHAIN_EMOJI = {
  sol: '🟣',
  eth: '🔷',
  bsc: '🔸',
  base: '🔵',
  all: '🌐',
};

// Private channel for signal links
const PRIVATE_CHANNEL = CHANNELS.private; // -1003474351030

// Multiplier brackets for distribution
const BRACKETS = [
  { key: '<1x', min: 0, max: 1.0, label: '&lt;1x' },
  { key: '1-1.3x', min: 1.0, max: 1.3, label: '1-1.3x' },
  { key: '1.3-2x', min: 1.3, max: 2.0, label: '1.3-2x' },
  { key: '2-5x', min: 2.0, max: 5.0, label: '2-5x' },
  { key: '5-10x', min: 5.0, max: 10.0, label: '5-10x' },
  { key: '10-25x', min: 10.0, max: 25.0, label: '10-25x' },
  { key: '25-50x', min: 25.0, max: 50.0, label: '25-50x' },
  { key: '50-100x', min: 50.0, max: 100.0, label: '50-100x' },
  { key: '≥100x', min: 100.0, max: Infinity, label: '≥100x' },
];

// ============================================================
// TELEGRAM API HELPERS
// ============================================================

async function api(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function sendMessage(chatId, text, replyMarkup = null, replyToMessageId = null) {
  const params = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) params.reply_markup = replyMarkup;
  if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
  return api('sendMessage', params);
}

async function editMessage(chatId, messageId, text, replyMarkup = null) {
  const params = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) params.reply_markup = replyMarkup;
  return api('editMessageText', params);
}

async function answerCallback(callbackId, text = '') {
  return api('answerCallbackQuery', {
    callback_query_id: callbackId,
    text,
  });
}

// ============================================================
// DATA LOADING & STATS
// ============================================================

/**
 * Load gains data for one or all chains
 * Returns ALL tokens for stats, with top 15 separately for display
 */
async function loadGainsData(chain, period) {
  const chainsToLoad = chain === 'all' ? CHAINS : [chain];
  const results = {};
  
  for (const c of chainsToLoad) {
    const chainId = CHAIN_IDS[c];
    if (!chainId) continue;
    
    const db = new TelegramDBv5(BOT_TOKEN, chainId);
    await db.load();
    // Get ALL tokens (pass 0 for no limit) for accurate stats
    const data = db.getGainsLeaderboard(period, 0);
    data.chainKey = c;
    // Store top 15 for display, keep all for stats
    data.topTokens = data.tokens.slice(0, 15);
    data.allTokens = data.tokens;
    results[c] = data;
  }
  
  return results;
}

/**
 * Calculate bracket distribution
 */
function calcBracketDistribution(tokens) {
  const dist = {};
  for (const b of BRACKETS) {
    dist[b.key] = { count: 0, pct: 0 };
  }
  
  for (const token of tokens) {
    const mult = token.peakMult || 1;
    for (const b of BRACKETS) {
      if (mult >= b.min && mult < b.max) {
        dist[b.key].count++;
        break;
      }
    }
  }
  
  const total = tokens.length;
  for (const b of BRACKETS) {
    dist[b.key].pct = total > 0 ? Math.round((dist[b.key].count / total) * 100) : 0;
  }
  
  return dist;
}

/**
 * Calculate sum of multipliers (hybrid method)
 * For mults < 2x: add decimal part only (1.3x adds 0.3)
 * For mults >= 2x: add full mult (5x adds 5)
 */
function calcMultSum(tokens) {
  let sum = 0;
  for (const token of tokens) {
    const mult = token.peakMult || 1;
    if (mult >= 2) {
      sum += mult;
    } else if (mult > 1) {
      sum += mult - 1; // Only the gain portion (1.3x adds 0.3)
    }
    // Note: < 1x = loss, contributes 0 to sum (we don't subtract losses)
    // The loss is already reflected in hit rate and bracket distribution
  }
  return sum;
}

/**
 * Calculate median multiplier
 */
function calcMedian(tokens) {
  if (tokens.length === 0) return 1;
  const sorted = [...tokens].map(t => t.peakMult || 1).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Combine data from multiple chains (uses ALL tokens for stats)
 */
function combineChainData(chainResults) {
  const allTokens = [];
  const topTokens = [];
  
  for (const [chain, data] of Object.entries(chainResults)) {
    // Add ALL tokens for stats
    for (const token of data.allTokens || data.tokens) {
      allTokens.push({ ...token, chain });
    }
    // Add top tokens for display
    for (const token of (data.topTokens || data.tokens.slice(0, 15))) {
      topTokens.push({ ...token, chain });
    }
  }
  
  // Sort by peakMult
  allTokens.sort((a, b) => b.peakMult - a.peakMult);
  topTokens.sort((a, b) => b.peakMult - a.peakMult);
  
  const totalCount = allTokens.length;
  
  // Calculate combined stats from ALL tokens
  const hitCount = allTokens.filter(t => (t.peakMult || 1) >= 1.3).length;
  const bracketDist = calcBracketDistribution(allTokens);
  const multSum = calcMultSum(allTokens);
  const median = calcMedian(allTokens);
  const avgMult = totalCount > 0 ? allTokens.reduce((s, t) => s + (t.peakMult || 1), 0) / totalCount : 1;
  
  return {
    stats: {
      total: totalCount,
      hitCount,
      hitRate: totalCount > 0 ? Math.round((hitCount / totalCount) * 100) : 0,
      multSum: Math.round(multSum * 10) / 10,
      median: Math.round(median * 100) / 100,
      avgMult: Math.round(avgMult * 100) / 100,
      brackets: bracketDist,
    },
    tokens: topTokens.slice(0, 15),
  };
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Format multiplier display
 */
function formatMult(mult) {
  if (mult >= 100) return `${Math.round(mult)}x`;
  if (mult >= 10) return `${mult.toFixed(1)}x`;
  return `${mult.toFixed(2)}x`;
}

/**
 * Format multiplier sum with abbreviation (x1.99K, x2.5M, etc.)
 */
function formatMultSum(sum) {
  if (sum >= 1000000) return `x${(sum / 1000000).toFixed(2)}M`;
  if (sum >= 1000) return `x${(sum / 1000).toFixed(2)}K`;
  return `x${sum.toFixed(1)}`;
}

/**
 * Format market cap with abbreviation ($40.9K, $1.2M, etc.)
 */
function formatMcap(mcap) {
  if (!mcap || mcap <= 0) return null;
  if (mcap >= 1000000000) return `$${(mcap / 1000000000).toFixed(1)}B`;
  if (mcap >= 1000000) return `$${(mcap / 1000000).toFixed(1)}M`;
  if (mcap >= 1000) return `$${(mcap / 1000).toFixed(1)}K`;
  return `$${Math.round(mcap)}`;
}

/**
 * Convert multiplier to percent gain/loss
 */
function multToPercent(mult) {
  if (mult >= 1) {
    const pct = (mult - 1) * 100;
    return pct >= 1000 ? `+${(pct / 1000).toFixed(1)}K%` : `+${Math.round(pct)}%`;
  } else {
    const pct = (1 - mult) * 100;
    return `-${Math.round(pct)}%`;
  }
}

/**
 * Format time ago (compact)
 */
function formatAge(timestamp) {
  const diff = Date.now() - timestamp;
  const hours = diff / (60 * 60 * 1000);
  
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${days.toFixed(1)}d`;
  return `${(days / 7).toFixed(1)}w`;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build signal link (to private channel message)
 */
function buildSignalLink(msgId) {
  if (!msgId) return null;
  // Format: https://t.me/c/CHANNEL_ID_WITHOUT_-100/MESSAGE_ID
  const channelId = PRIVATE_CHANNEL.replace('-100', '');
  return `https://t.me/c/${channelId}/${msgId}`;
}

/**
 * Format bracket distribution
 * Format: (<1x): 25 (42%)
 */
function formatBrackets(brackets) {
  let msg = '';
  for (const b of BRACKETS) {
    const data = brackets[b.key];
    if (data.count > 0) {
      // Pad bracket label to 9 chars for alignment
      const label = `(${b.label})`.padEnd(9);
      msg += `├ ${label} <b>${data.count}</b> (${data.pct}%)\n`;
    }
  }
  // Replace last ├ with └
  const lines = msg.trim().split('\n');
  if (lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].replace('├', '└');
  }
  return lines.join('\n');
}

/**
 * Format single chain message
 */
function formatSingleChainMessage(chain, data) {
  const emoji = CHAIN_EMOJI[chain];
  const periodLabel = PERIOD_LABELS[data.period] || data.period;
  
  // Use allTokens for stats (already calculated from ALL tokens)
  const allTokens = data.allTokens || data.tokens;
  const topTokens = data.topTokens || allTokens.slice(0, 15);
  const hitCount = allTokens.filter(t => (t.peakMult || 1) >= 1.3).length;
  const bracketDist = calcBracketDistribution(allTokens);
  const multSum = calcMultSum(allTokens);
  const median = calcMedian(allTokens);
  const avgMult = allTokens.length > 0 
    ? allTokens.reduce((s, t) => s + (t.peakMult || 1), 0) / allTokens.length 
    : 1;
  
  let msg = `<b>${emoji} ${chain.toUpperCase()} Gains — ${periodLabel}</b>\n`;
  msg += `<code>────────────────────</code>\n\n`;
  
  // Stats (flipped format)
  const total = allTokens.length;
  const hitPct = total > 0 ? Math.round((hitCount / total) * 100) : 0;
  msg += `📊 <b>Stats</b>\n`;
  msg += `├ Signals: <b>${total}</b> (${formatMultSum(multSum)})\n`;
  msg += `├ Hit Rate: <b>${hitCount}</b> (${hitPct}%)\n`;
  msg += `├ Median: <b>${multToPercent(median)}</b> [${formatMult(median)}]\n`;
  msg += `└ Avg: <b>${multToPercent(avgMult)}</b> [${formatMult(avgMult)}]\n\n`;
  
  // Bracket distribution
  msg += `📈 <b>Distribution</b>\n`;
  msg += formatBrackets(bracketDist) + '\n\n';
  
  // Top performers in blockquote (with mc0)
  if (topTokens.length === 0) {
    msg += `<i>No signals in this period</i>\n`;
  } else {
    msg += `🏆 <b>Top ${Math.min(15, topTokens.length)}</b>\n`;
    msg += `<blockquote>`;
    
    topTokens.slice(0, 15).forEach((token, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      const multStr = formatMult(token.peakMult);
      const age = formatAge(token.firstSeen);
      const mcStr = formatMcap(token.mc0);
      
      // Symbol links to signal message only
      const symLink = token.msgId 
        ? `<a href="${buildSignalLink(token.msgId)}">${escapeHtml(token.sym)}</a>`
        : `<b>${escapeHtml(token.sym)}</b>`;
      
      // Format: 🥇 🟣Buttcoin [25.8x] 4h @ $40.9K
      if (mcStr) {
        msg += `${medal} ${symLink} [${multStr}] ${age} @ ${mcStr}\n`;
      } else {
        msg += `${medal} ${symLink} [${multStr}] ${age}\n`;
      }
    });
    
    msg += `</blockquote>`;
  }
  
  return msg;
}

/**
 * Format all chains combined message
 */
function formatAllChainsMessage(chainResults, period) {
  const periodLabel = PERIOD_LABELS[period] || period;
  const combined = combineChainData(chainResults);
  
  let msg = `<b>🌐 ALL CHAINS — ${periodLabel}</b>\n`;
  msg += `<code>════════════════════</code>\n\n`;
  
  // Combined stats (flipped format)
  const { stats } = combined;
  msg += `📊 <b>Combined Stats</b>\n`;
  msg += `├ Signals: <b>${stats.total}</b> (${formatMultSum(stats.multSum)})\n`;
  msg += `├ Hit Rate: <b>${stats.hitCount}</b> (${stats.hitRate}%)\n`;
  msg += `├ Median: <b>${multToPercent(stats.median)}</b> [${formatMult(stats.median)}]\n`;
  msg += `└ Avg: <b>${multToPercent(stats.avgMult)}</b> [${formatMult(stats.avgMult)}]\n\n`;
  
  // Per-chain summary with aligned columns
  msg += `📈 <b>By Chain</b> <code>[Sig │ Hit │ Avg]</code>\n`;
  for (const [chain, data] of Object.entries(chainResults)) {
    const emoji = CHAIN_EMOJI[chain];
    const allTokens = data.allTokens || data.tokens;
    const hitCount = allTokens.filter(t => (t.peakMult || 1) >= 1.3).length;
    const hitPct = allTokens.length > 0 ? Math.round((hitCount / allTokens.length) * 100) : 0;
    const avgMult = allTokens.length > 0 
      ? allTokens.reduce((s, t) => s + (t.peakMult || 1), 0) / allTokens.length 
      : 1;
    // Aligned columns: [Sig │ Hit │ Avg]
    const sigStr = String(allTokens.length).padStart(3);
    const hitStr = `${hitPct}%`.padStart(3);
    const avgStr = formatMult(avgMult);
    msg += `${emoji} <code>${sigStr} │ ${hitStr} │ ${avgStr}</code>\n`;
  }
  msg += `\n`;
  
  // Bracket distribution
  msg += `📊 <b>Distribution</b>\n`;
  msg += formatBrackets(stats.brackets) + '\n\n';
  
  // Top performers (with mc0)
  if (combined.tokens.length === 0) {
    msg += `<i>No signals in this period</i>\n`;
  } else {
    msg += `🏆 <b>Top 15 All Chains</b>\n`;
    msg += `<blockquote>`;
    
    combined.tokens.forEach((token, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      const chainEmoji = CHAIN_EMOJI[token.chain] || '';
      const multStr = formatMult(token.peakMult);
      const age = formatAge(token.firstSeen);
      const mcStr = formatMcap(token.mc0);
      
      // Symbol links to signal message only
      const symLink = token.msgId 
        ? `<a href="${buildSignalLink(token.msgId)}">${escapeHtml(token.sym)}</a>`
        : `<b>${escapeHtml(token.sym)}</b>`;
      
      // Format: 🥇 🟣Buttcoin [25.8x] 4h @ $40.9K
      if (mcStr) {
        msg += `${medal} ${chainEmoji}${symLink} [${multStr}] ${age} @ ${mcStr}\n`;
      } else {
        msg += `${medal} ${chainEmoji}${symLink} [${multStr}] ${age}\n`;
      }
    });
    
    msg += `</blockquote>`;
  }
  
  return msg;
}

/**
 * Build inline keyboard
 */
function buildPeriodKeyboard(currentPeriod, chain) {
  const periods = ['1h', '6h', '12h', '24h', '2d', '3d', '1w', '2w', '4w'];
  const rows = [];
  
  // Row 1: periods
  const row1 = periods.slice(0, 5).map(p => {
    const periodKey = PERIODS[p] || p;
    return {
      text: periodKey === currentPeriod ? `•${p}•` : p,
      callback_data: `gains:${chain}:${periodKey}`,
    };
  });
  rows.push(row1);
  
  // Row 2: periods continued
  const row2 = periods.slice(5).map(p => {
    const periodKey = PERIODS[p] || p;
    return {
      text: periodKey === currentPeriod ? `•${p}•` : p,
      callback_data: `gains:${chain}:${periodKey}`,
    };
  });
  rows.push(row2);
  
  // Row 3: chains
  const chainOptions = ['all', 'sol', 'eth', 'bsc', 'base'];
  const row3 = chainOptions.map(c => ({
    text: c === chain ? `•${CHAIN_EMOJI[c]}•` : CHAIN_EMOJI[c],
    callback_data: `gains:${c}:${currentPeriod}`,
  }));
  rows.push(row3);
  
  return { inline_keyboard: rows };
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  // GET: API testing
  if (req.method === 'GET') {
    const period = PERIODS[req.query.period] || req.query.period || '7d';
    const chain = req.query.chain || 'all';
    
    if (chain !== 'all' && !CHAIN_IDS[chain]) {
      return res.status(400).json({ error: 'Invalid chain. Use: all, sol, eth, bsc, base' });
    }
    
    try {
      const chainResults = await loadGainsData(chain, period);
      
      let message;
      if (chain === 'all') {
        message = formatAllChainsMessage(chainResults, period);
      } else {
        message = formatSingleChainMessage(chain, chainResults[chain]);
      }
      
      return res.status(200).json({ chain, period, data: chainResults, message });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  
  // POST: Telegram webhook
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const update = req.body;
    
    // Callback query (button press)
    if (update.callback_query) {
      const { id, data, message } = update.callback_query;
      const parts = data?.split(':');
      
      if (parts?.[0] !== 'gains') {
        await answerCallback(id);
        return res.status(200).json({ ok: true });
      }
      
      const chain = parts[1] || 'all';
      const period = parts[2] || '7d';
      const chatId = message?.chat?.id;
      const messageId = message?.message_id;
      
      if (!chatId || !messageId) {
        await answerCallback(id, 'Error');
        return res.status(200).json({ ok: true });
      }
      
      if (chain !== 'all' && !CHAIN_IDS[chain]) {
        await answerCallback(id, 'Invalid chain');
        return res.status(200).json({ ok: true });
      }
      
      const chainResults = await loadGainsData(chain, period);
      const text = chain === 'all' 
        ? formatAllChainsMessage(chainResults, period)
        : formatSingleChainMessage(chain, chainResults[chain]);
      const keyboard = buildPeriodKeyboard(period, chain);
      
      await editMessage(chatId, messageId, text, keyboard);
      await answerCallback(id, `${chain.toUpperCase()} ${PERIOD_LABELS[period] || period}`);
      
      return res.status(200).json({ ok: true });
    }
    
    // Route /pnl commands to pnl handler
    const message = update.message;
    if (message?.text?.startsWith('/pnl')) {
      return pnlHandler(req, res);
    }
    
    // /gains command
    if (!message?.text?.startsWith('/gains')) {
      return res.status(200).json({ ok: true });
    }
    
    const chatId = message.chat.id;
    const messageId = message.message_id;
    
    // Parse args
    const args = message.text.split(/\s+/).slice(1);
    let period = '7d';
    let chain = 'all';
    
    for (const arg of args) {
      const lower = arg.toLowerCase();
      if (PERIODS[lower]) period = PERIODS[lower];
      else if (lower === 'all' || CHAIN_IDS[lower]) chain = lower;
    }
    
    const chainResults = await loadGainsData(chain, period);
    const text = chain === 'all'
      ? formatAllChainsMessage(chainResults, period)
      : formatSingleChainMessage(chain, chainResults[chain]);
    const keyboard = buildPeriodKeyboard(period, chain);
    
    await sendMessage(chatId, text, keyboard, messageId);
    
    return res.status(200).json({ ok: true });
    
  } catch (err) {
    console.error('Gains error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
