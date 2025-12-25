/**
 * Update Prices Cron - /api/update-prices
 * 
 * Fetches current prices for tracked tokens and updates signal performance.
 * Posts performance updates for significant gains.
 * 
 * Trigger: External cron ping (e.g., every 15 minutes)
 */

import { TelegramDBv5, CHAIN_IDS } from '../lib/telegram-db-v5.js';
import { getTokenPrices } from '../lib/price-fetcher.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRIVATE_CHANNEL = '-1003474351030';
const PUBLIC_CHANNEL = '-1003627230339';

// All chains to process
const CHAINS = [
  { id: 501, name: 'Solana', tag: 'solana', key: 'sol' },
  { id: 1, name: 'Ethereum', tag: 'ethereum', key: 'eth' },
  { id: 56, name: 'BSC', tag: 'bsc', key: 'bsc' },
  { id: 8453, name: 'Base', tag: 'base', key: 'base' },
];

// Performance thresholds for posting updates
const THRESHOLDS = {
  // Gains (positive multipliers)
  MOON: 2.0,      // 2x = +100% gain
  ROCKET: 1.5,    // +50% gain  
  GOOD: 1.25,     // +25% gain
  // Losses (multipliers below 1)
  BAD: 0.75,      // -25% loss
  DUMP: 0.5,      // -50% loss
  RUG: 0.25,      // -75% loss (likely rugged)
};

// Minimum liquidity to consider token not rugged (USD)
const MIN_LIQUIDITY_USD = 1000;

// Only post updates for signals newer than this
const MAX_SIGNAL_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours (extended from 24)

async function sendTelegramMessage(text, chatId = PRIVATE_CHANNEL, replyToMsgId = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  
  // Reply to original signal message if provided
  if (replyToMsgId) {
    body.reply_to_message_id = replyToMsgId;
  }
  
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Build Telegram message link from chat ID and message ID
 * Format: https://t.me/c/{chat_id_without_-100}/{message_id}
 */
function buildMessageLink(chatId, msgId) {
  if (!chatId || !msgId) return null;
  // Remove -100 prefix from chat ID for link format
  const cleanChatId = String(chatId).replace(/^-100/, '');
  return `https://t.me/c/${cleanChatId}/${msgId}`;
}

/**
 * Format a single token line for the aggregated performance message
 * 
 * For GAINS: Shows NEW HIGH marker + multiplier
 * For LOSSES: Shows new ATL marker
 * For RUGGED: Shows skull marker (liquidity dried up)
 * Token symbol links to last signal message if available
 */
function formatTokenLine(performer, chatId) {
  const { token, multiplier, chainTag, isNewHigh, isNewLow, reportType, isRugged } = performer;
  
  // For rugged tokens: show 0.0x and -100%
  const displayMultiplier = isRugged ? 0 : multiplier;
  const pctChange = isRugged ? -100 : ((multiplier - 1) * 100).toFixed(0);
  const sign = displayMultiplier >= 1 ? '+' : '';
  
  // Emoji based on performance
  let emoji;
  if (isRugged) emoji = '🪦';  // Rugged (tombstone)
  else if (multiplier >= THRESHOLDS.MOON) emoji = '🌙';
  else if (multiplier >= THRESHOLDS.ROCKET) emoji = '🚀';
  else if (multiplier >= THRESHOLDS.GOOD) emoji = '📈';
  else if (multiplier >= 1.0) emoji = '➡️';  // flat/small gain
  else if (multiplier >= THRESHOLDS.BAD) emoji = '📉';
  else if (multiplier >= THRESHOLDS.DUMP) emoji = '💀';
  else emoji = '🪦';  // severe loss
  
  const signalCount = token.scnt || 1;
  const signalInfo = signalCount > 1 ? ` (${signalCount} 🚨)` : '';
  
  // Show ATH/ATL/RUGGED marker based on report type
  let statusMarker = '';
  if (isRugged) statusMarker = ' 🪦';
  else if (reportType === 'gain') statusMarker = ' 🆕';
  else if (reportType === 'loss') statusMarker = ' 🆕';
  
  // Build message link for token symbol (links to last signal)
  const msgLink = buildMessageLink(chatId, token.lastMsgId);
  const tokenName = msgLink 
    ? `<a href="${msgLink}">${token.sym}</a>`
    : token.sym;
  
  // Format: 🚀 PEPE #solana +150% (2.5x) 🆕 (3 sigs)
  return `${emoji} <b>${tokenName}</b> #${chainTag} <b>${sign}${pctChange}%</b> (${displayMultiplier.toFixed(2)}x)${statusMarker}${signalInfo}`;
}

/**
 * Format aggregated performance message for all tokens
 * Separates gains, losses, and rugged tokens for clarity
 * @param {Array} performers - Array of performer objects
 * @param {string} chatId - Telegram chat ID for message links
 */
function formatAggregatedMessage(performers, chatId, isPublic = false) {
  if (performers.length === 0) return null;
  
  // Separate gains and losses (rugged tokens go in losses)
  const gains = performers.filter(p => p.multiplier >= 1.0 && !p.isRugged);
  const losses = performers.filter(p => p.multiplier < 1.0 || p.isRugged);
  
  // Sort gains by multiplier descending, losses by multiplier ascending
  gains.sort((a, b) => b.multiplier - a.multiplier);
  losses.sort((a, b) => a.multiplier - b.multiplier);
  
  const moonCount = gains.filter(p => p.multiplier >= THRESHOLDS.MOON).length;
  
  // Header emoji based on overall performance
  let headerEmoji = moonCount > 0 ? '🌙' : gains.length > losses.length ? '📈' : '📊';
  
  const totalCount = gains.length + losses.length;
  let msg = `${headerEmoji} <b>Signal Performance</b> (${totalCount} token${totalCount !== 1 ? 's' : ''})\n`;
  
  // Gains section
  if (gains.length > 0) {
    msg += `\n<b>📈 Gains (${gains.length})</b>\n`;
    for (const p of gains) {
      msg += formatTokenLine(p, chatId) + '\n';
    }
  }
  
  // Losses section (includes rugged tokens)
  if (losses.length > 0) {
    msg += `\n<b>📉 Losses (${losses.length})</b>\n`;
    for (const p of losses) {
      msg += formatTokenLine(p, chatId) + '\n';
    }
  }
  
  if (isPublic) {
    msg += `\n🔓 <i>Full details in private channel</i>`;
  }
  
  return msg.trim();
}

async function processChain(chain, allPerformers) {
  console.log(`\n📊 Processing ${chain.name}...`);
  
  const db = new TelegramDBv5(BOT_TOKEN, chain.id);
  await db.load();
  
  // Get all tokens from v5 database
  const tokens = db.getAllTokens();
  const tokenAddresses = Object.keys(tokens);
  
  if (tokenAddresses.length === 0) {
    console.log(`   ℹ️ No tracked tokens for ${chain.name}`);
    return { updated: 0, performers: 0, db: null };
  }
  
  console.log(`   📋 ${tokenAddresses.length} tokens to check`);
  
  // Batch fetch current prices
  const prices = await getTokenPrices(chain.id, tokenAddresses);
  console.log(`   💰 Got prices for ${Object.keys(prices).length} tokens`);
  
  let updated = 0;
  let performerCount = 0;
  
  for (const [addr, token] of Object.entries(tokens)) {
    const priceData = prices[addr.toLowerCase()];
    
    if (!priceData || priceData.priceUsd <= 0) continue;
    
    const currentPrice = priceData.priceUsd;
    const liquidity = priceData.liquidity || 0;
    
    // Detect rugged tokens (liquidity dried up)
    const isRugged = liquidity < MIN_LIQUIDITY_USD;
    const wasRugged = token.rugged || false;
    const newlyRugged = isRugged && !wasRugged;
    
    // Update rugged status in token
    if (isRugged) {
      token.rugged = true;
      token.ruggedAt = token.ruggedAt || Date.now();
    }
    
    // Entry price = first signal price (p0)
    const entryPrice = token.p0 || 0;
    if (entryPrice <= 0) continue;
    
    // Track ATH (all-time high) and ATL (all-time low) since signal
    const previousATH = token.pPeak || entryPrice;
    const previousATL = token.pLow || entryPrice;
    
    const isNewATH = currentPrice > previousATH;
    const isNewATL = currentPrice < previousATL;
    
    // Update ATH/ATL if new extremes
    if (isNewATH) {
      token.pPeak = currentPrice;
    }
    if (isNewATL) {
      token.pLow = currentPrice;
    }
    
    // Calculate current multiplier (current price vs entry)
    const currentMultiplier = currentPrice / entryPrice;
    const signalAge = Date.now() - (token.firstSeen || 0);
    
    // Update token with current price
    token.pNow = currentPrice;
    token.mult = currentMultiplier;
    
    // Update peak multiplier
    if (isNewATH) {
      token.peakMult = currentPrice / entryPrice;
    }
    
    db.updateToken(addr, token);
    updated++;
    
    // Determine tier based on CURRENT performance
    let currentTier = 'flat';
    if (currentMultiplier >= THRESHOLDS.MOON) currentTier = 'moon';
    else if (currentMultiplier >= THRESHOLDS.ROCKET) currentTier = 'rocket';
    else if (currentMultiplier >= THRESHOLDS.GOOD) currentTier = 'good';
    else if (currentMultiplier <= THRESHOLDS.RUG) currentTier = 'rug';
    else if (currentMultiplier <= THRESHOLDS.DUMP) currentTier = 'dump';
    else if (currentMultiplier <= THRESHOLDS.BAD) currentTier = 'bad';
    
    // Simple reporting logic:
    // - RUGGED: Report once when token becomes rugged (liquidity dries up)
    // - GAIN: Report only if NEW ATH (price went higher than ever before) AND not rugged
    // - LOSS: Report only if NEW ATL (price went lower than ever before) AND not rugged
    // - Must be in a significant tier (not flat)
    // - Must be within age window
    
    let shouldReport = false;
    let reportType = null;
    
    if (signalAge <= MAX_SIGNAL_AGE_MS) {
      if (newlyRugged) {
        // RUGGED: Token just got rugged (first time detecting low liquidity)
        shouldReport = true;
        reportType = 'rugged';
      } else if (!isRugged && currentTier !== 'flat') {
        // Only report ATH/ATL for non-rugged tokens
        if (currentMultiplier >= 1.0 && isNewATH) {
          // GAIN: New all-time high since signal
          shouldReport = true;
          reportType = 'gain';
        } else if (currentMultiplier < 1.0 && isNewATL) {
          // LOSS: New all-time low since signal
          shouldReport = true;
          reportType = 'loss';
        }
      }
    }
    
    if (shouldReport) {
      allPerformers.push({
        token,
        entryPrice,
        currentPrice,
        multiplier: currentMultiplier,
        chainTag: chain.tag,
        isNewHigh: isNewATH,
        isNewLow: isNewATL,
        reportType,
        isRugged: reportType === 'rugged',
        liquidity,
      });
      
      // Update tracking fields
      token.lastPerfTier = currentTier;
      token.lastReportedPrice = currentPrice;
      performerCount++;
      
      const sign = currentMultiplier >= 1 ? '+' : '';
      let typeLog;
      if (reportType === 'rugged') typeLog = '🪦 RUG';
      else if (reportType === 'gain') typeLog = '📈 ATH';
      else typeLog = '📉 ATL';
      console.log(`   ${typeLog}: ${token.sym} ${sign}${((currentMultiplier-1)*100).toFixed(0)}% (${currentTier}) liq:$${liquidity.toFixed(0)}`);
    }
  }
  
  console.log(`   ✅ Updated ${updated} tokens, ${performerCount} to report`);
  
  // Save database with updated tokens
  await db.save();
  
  return { 
    updated, 
    performers: performerCount
  };
}

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🔄 [Update Prices] Starting at ${new Date().toISOString()}`);
  
  if (!BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram config' });
  }
  
  const results = {
    chains: {},
    totalUpdated: 0,
    totalPerformers: 0,
    messageSent: false,
  };
  
  // Collect all performers across chains
  const allPerformers = [];
  
  try {
    // Process all chains and collect performers
    for (const chain of CHAINS) {
      const chainResult = await processChain(chain, allPerformers);
      results.chains[chain.name] = { updated: chainResult.updated, performers: chainResult.performers };
      results.totalUpdated += chainResult.updated;
      results.totalPerformers += chainResult.performers;
      
      // Small delay between chains
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Send aggregated message if there are performers
    if (allPerformers.length > 0) {
      // Send to PRIVATE channel (full details)
      const privateMsg = formatAggregatedMessage(allPerformers, PRIVATE_CHANNEL, false);
      if (privateMsg) {
        const result = await sendTelegramMessage(privateMsg, PRIVATE_CHANNEL);
        if (result.ok) {
          console.log(`\n📨 Sent performance update to PRIVATE channel (${allPerformers.length} tokens)`);
          results.messageSent = true;
        } else {
          console.log(`\n❌ Failed to send to PRIVATE: ${result.description}`);
        }
      }
      
      // Send to PUBLIC channel (redacted wallets)
      const publicMsg = formatAggregatedMessage(allPerformers, PUBLIC_CHANNEL, true);
      if (publicMsg) {
        const result = await sendTelegramMessage(publicMsg, PUBLIC_CHANNEL);
        if (result.ok) {
          console.log(`📨 Sent performance update to PUBLIC channel`);
        } else {
          console.log(`❌ Failed to send to PUBLIC: ${result.description}`);
        }
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ [Update Prices] Complete in ${duration}ms`);
    
    return res.status(200).json({
      ok: true,
      duration,
      ...results,
    });
    
  } catch (error) {
    console.error('❌ [Update Prices] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
