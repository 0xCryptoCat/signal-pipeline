/**
 * Update Prices Cron - /api/update-prices
 * 
 * Fetches current prices for tracked tokens and updates signal performance.
 * Posts performance updates for significant gains.
 * 
 * Trigger: External cron ping (e.g., every 15 minutes)
 */

import { TelegramDBv4, Keys } from '../lib/telegram-db-v4.js';
import { getTokenPrices } from '../lib/price-fetcher.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// All chains to process
const CHAINS = [
  { id: 501, name: 'Solana', tag: 'solana' },
  { id: 1, name: 'Ethereum', tag: 'ethereum' },
  { id: 56, name: 'BSC', tag: 'bsc' },
  { id: 8453, name: 'Base', tag: 'base' },
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

// Only post updates for signals newer than this
const MAX_SIGNAL_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours (extended from 24)

async function sendTelegramMessage(text, replyToMsgId = null) {
  const body = {
    chat_id: CHAT_ID,
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
 * Format a single token line for the aggregated performance message
 * 
 * Shows: entry price → current price (multiplier)
 * Handles both gains AND losses
 */
function formatTokenLine(performer) {
  const { token, entryPrice, currentPrice, multiplier, chainTag } = performer;
  
  // Emoji based on performance
  let emoji;
  if (multiplier >= THRESHOLDS.MOON) emoji = '🌙';
  else if (multiplier >= THRESHOLDS.ROCKET) emoji = '🚀';
  else if (multiplier >= THRESHOLDS.GOOD) emoji = '📈';
  else if (multiplier >= 1.0) emoji = '➡️';  // flat/small gain
  else if (multiplier >= THRESHOLDS.BAD) emoji = '📉';
  else if (multiplier >= THRESHOLDS.DUMP) emoji = '💀';
  else emoji = '☠️';  // rugged
  
  const pctChange = ((multiplier - 1) * 100).toFixed(0);
  const sign = multiplier >= 1 ? '+' : '';
  const signalCount = token.scnt || 1;
  const signalInfo = signalCount > 1 ? ` (${signalCount} sigs)` : '';
  
  // Format: 🚀 PEPE #solana +150% (2.5x) (3 sigs)
  return `${emoji} <b>${token.sym}</b> #${chainTag} <b>${sign}${pctChange}%</b> (${multiplier.toFixed(2)}x)${signalInfo}`;
}

/**
 * Format aggregated performance message for all tokens
 * Separates gains and losses for clarity
 */
function formatAggregatedMessage(performers) {
  if (performers.length === 0) return null;
  
  // Separate gains and losses
  const gains = performers.filter(p => p.multiplier >= 1.0);
  const losses = performers.filter(p => p.multiplier < 1.0);
  
  // Sort gains by multiplier descending, losses by multiplier ascending
  gains.sort((a, b) => b.multiplier - a.multiplier);
  losses.sort((a, b) => a.multiplier - b.multiplier);
  
  const moonCount = gains.filter(p => p.multiplier >= THRESHOLDS.MOON).length;
  const rugCount = losses.filter(p => p.multiplier <= THRESHOLDS.RUG).length;
  
  // Header emoji based on overall performance
  let headerEmoji = moonCount > 0 ? '🌙' : gains.length > losses.length ? '📈' : '📊';
  
  let msg = `${headerEmoji} <b>Signal Performance</b> (${performers.length} token${performers.length > 1 ? 's' : ''})\n`;
  
  // Gains section
  if (gains.length > 0) {
    msg += `\n<b>📈 Gains (${gains.length})</b>\n`;
    for (const p of gains) {
      msg += formatTokenLine(p) + '\n';
    }
  }
  
  // Losses section  
  if (losses.length > 0) {
    msg += `\n<b>📉 Losses (${losses.length})</b>\n`;
    for (const p of losses) {
      msg += formatTokenLine(p) + '\n';
    }
  }
  
  return msg.trim();
}

async function processChain(chain, allPerformers) {
  console.log(`\n📊 Processing ${chain.name}...`);
  
  const db = new TelegramDBv4(BOT_TOKEN, chain.id);
  
  // Load index from pinned message
  await db.loadIndex();
  
  // Get tokens from index (contains essential token data)
  const indexKey = Keys.index();
  const index = db.get('index', indexKey);
  
  if (!index || !index.trackedTokens || index.trackedTokens.length === 0) {
    console.log(`   ℹ️ No tracked tokens for ${chain.name}`);
    return { updated: 0, performers: 0, db: null, index: null, indexKey: null };
  }
  
  const tokenAddresses = index.trackedTokens.map(t => t.addr);
  console.log(`   📋 ${tokenAddresses.length} tokens to check`);
  
  // Batch fetch current prices
  const prices = await getTokenPrices(chain.id, tokenAddresses);
  console.log(`   💰 Got prices for ${Object.keys(prices).length} tokens`);
  
  let updated = 0;
  let performerCount = 0;
  let indexModified = false;
  
  for (let i = 0; i < index.trackedTokens.length; i++) {
    const token = index.trackedTokens[i];
    const addr = token.addr.toLowerCase();
    const priceData = prices[addr];
    
    if (!priceData || priceData.priceUsd <= 0) continue;
    
    const currentPrice = priceData.priceUsd;
    
    // Entry price = first signal price (p0)
    const entryPrice = token.p0 || 0;
    if (entryPrice <= 0) continue;
    
    // Track peak and trough for historical context
    const previousPeak = token.pPeak || entryPrice;
    const previousTrough = token.pTrough || entryPrice;
    token.pPeak = Math.max(previousPeak, currentPrice);
    token.pTrough = Math.min(previousTrough, currentPrice);
    
    // Calculate multiplier: entry → CURRENT price (real-time performance)
    const multiplier = currentPrice / entryPrice;
    const signalAge = Date.now() - (token.firstSeen || 0);
    
    // Update token with current price in index
    token.pNow = currentPrice;
    token.mult = multiplier;
    token.lastPriceUpdate = Date.now();
    indexModified = true;
    updated++;
    
    // Determine current performance tier
    let currentTier = 'flat';
    if (multiplier >= THRESHOLDS.MOON) currentTier = 'moon';
    else if (multiplier >= THRESHOLDS.ROCKET) currentTier = 'rocket';
    else if (multiplier >= THRESHOLDS.GOOD) currentTier = 'good';
    else if (multiplier <= THRESHOLDS.RUG) currentTier = 'rug';
    else if (multiplier <= THRESHOLDS.DUMP) currentTier = 'dump';
    else if (multiplier <= THRESHOLDS.BAD) currentTier = 'bad';
    
    // Check if we should report this token
    // Report if: within age window AND tier changed from last report
    const lastReportedTier = token.lastPerfTier || null;
    const shouldReport = signalAge <= MAX_SIGNAL_AGE_MS && 
                         currentTier !== 'flat' && 
                         currentTier !== lastReportedTier;
    
    if (shouldReport) {
      allPerformers.push({
        token,
        entryPrice,
        currentPrice,
        multiplier,
        chainTag: chain.tag,
      });
      
      // Update last reported tier
      token.lastPerfTier = currentTier;
      performerCount++;
      
      const sign = multiplier >= 1 ? '+' : '';
      console.log(`   📊 Performance: ${token.sym} ${sign}${((multiplier-1)*100).toFixed(0)}% (${currentTier})`);
    }
  }
  
  console.log(`   ✅ Updated ${updated} tokens, ${performerCount} to report`);
  
  // Return db and index for saving after message is sent
  return { 
    updated, 
    performers: performerCount, 
    db: indexModified ? db : null, 
    index: indexModified ? index : null,
    indexKey: indexModified ? indexKey : null
  };
}

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🔄 [Update Prices] Starting at ${new Date().toISOString()}`);
  
  if (!BOT_TOKEN || !CHAT_ID) {
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
  // Track chain data for saving after message is sent
  const chainData = [];
  
  try {
    // Process all chains and collect performers
    for (const chain of CHAINS) {
      const chainResult = await processChain(chain, allPerformers);
      results.chains[chain.name] = { updated: chainResult.updated, performers: chainResult.performers };
      results.totalUpdated += chainResult.updated;
      results.totalPerformers += chainResult.performers;
      
      // Keep track of db/index for saving
      if (chainResult.db) {
        chainData.push(chainResult);
      }
      
      // Small delay between chains
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Send aggregated message if there are performers
    if (allPerformers.length > 0) {
      const msg = formatAggregatedMessage(allPerformers);
      if (msg) {
        const result = await sendTelegramMessage(msg);
        if (result.ok) {
          console.log(`\n📨 Sent aggregated performance update for ${allPerformers.length} tokens`);
          results.messageSent = true;
        } else {
          console.log(`\n❌ Failed to send message: ${result.description}`);
        }
      }
    }
    
    // Save all chain indexes (mark tokens as postedPerf)
    for (const { db, index, indexKey } of chainData) {
      if (db && index && indexKey) {
        index.lastPriceUpdate = Date.now();
        await db.update('index', indexKey, index);
        await db.pinIndex();
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
