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
  MOON: 2.0,      // 2x = 100% gain
  ROCKET: 1.5,    // 50% gain
  GOOD: 1.25,     // 25% gain
};

// Only post updates for signals newer than this
const MAX_SIGNAL_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

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
 * Shows: best entry price → peak price reached (multiplier)
 * Best entry = lowest price signal for this token
 * Peak = highest price seen since that signal
 */
function formatTokenLine(performer) {
  const { token, bestEntry, peakPrice, multiplier, chainTag } = performer;
  
  const emoji = multiplier >= THRESHOLDS.MOON ? '🌙' : 
                multiplier >= THRESHOLDS.ROCKET ? '🚀' : '📈';
  
  const pctGain = ((multiplier - 1) * 100).toFixed(0);
  const signalCount = token.scnt || 1;
  const signalInfo = signalCount > 1 ? ` (${signalCount} sigs)` : '';
  
  // Format: 🚀 PEPE #solana +150% (2.5x) (3 sigs)
  return `${emoji} <b>${token.sym}</b> #${chainTag} <b>+${pctGain}%</b> (${multiplier.toFixed(2)}x)${signalInfo}`;
}

/**
 * Format aggregated performance message for all tokens
 */
function formatAggregatedMessage(performers) {
  if (performers.length === 0) return null;
  
  // Sort by multiplier descending (best performers first)
  performers.sort((a, b) => b.multiplier - a.multiplier);
  
  const moonCount = performers.filter(p => p.multiplier >= THRESHOLDS.MOON).length;
  const rocketCount = performers.filter(p => p.multiplier >= THRESHOLDS.ROCKET && p.multiplier < THRESHOLDS.MOON).length;
  
  let headerEmoji = moonCount > 0 ? '🌙' : rocketCount > 0 ? '🚀' : '📈';
  
  let msg = `${headerEmoji} <b>Signal Performance</b> (${performers.length} token${performers.length > 1 ? 's' : ''})\n\n`;
  
  for (const p of performers) {
    msg += formatTokenLine(p) + '\n';
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
    
    // Best entry = lowest price signal (p0 = first signal price, pLow = lowest signal price if tracked)
    const bestEntry = token.pLow || token.p0 || 0;
    if (bestEntry <= 0) continue;
    
    // Track peak price since first signal
    const previousPeak = token.pPeak || bestEntry;
    const peakPrice = Math.max(previousPeak, currentPrice);
    
    // Calculate multiplier: best entry → peak price (not current)
    const multiplier = peakPrice / bestEntry;
    const signalAge = Date.now() - (token.firstSeen || 0);
    
    // Update token with current price and peak in index
    token.pNow = currentPrice;
    token.pPeak = peakPrice;
    token.mult = multiplier;
    token.lastPriceUpdate = Date.now();
    indexModified = true;
    updated++;
    
    // Collect performers for aggregated message (recent signals with significant gains)
    if (signalAge <= MAX_SIGNAL_AGE_MS && !token.postedPerf) {
      if (multiplier >= THRESHOLDS.GOOD) {
        allPerformers.push({
          token,
          bestEntry,
          peakPrice,
          currentPrice,
          multiplier,
          chainTag: chain.tag,
        });
        
        // Mark as posted (will be saved after message is sent)
        token.postedPerf = multiplier >= THRESHOLDS.MOON ? 'moon' : 
                           multiplier >= THRESHOLDS.ROCKET ? 'rocket' : 'good';
        performerCount++;
        
        console.log(`   📈 Found performer: ${token.sym} +${((multiplier-1)*100).toFixed(0)}% (best: $${bestEntry.toPrecision(3)} → peak: $${peakPrice.toPrecision(3)})`);
      }
    }
  }
  
  console.log(`   ✅ Updated ${updated} tokens, ${performerCount} performers`);
  
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
