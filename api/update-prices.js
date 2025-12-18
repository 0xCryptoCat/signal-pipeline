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
  { id: 501, name: 'Solana', key: 'sol' },
  { id: 1, name: 'Ethereum', key: 'eth' },
  { id: 56, name: 'BSC', key: 'bsc' },
  { id: 8453, name: 'Base', key: 'base' },
];

// Performance thresholds for posting updates
const THRESHOLDS = {
  MOON: 2.0,      // 2x = 100% gain
  ROCKET: 1.5,    // 50% gain
  GOOD: 1.25,     // 25% gain
};

// Only post updates for signals newer than this
const MAX_SIGNAL_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function sendTelegramMessage(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  return res.json();
}

function formatPerformanceMessage(token, currentPrice, multiplier, chainKey) {
  const emoji = multiplier >= THRESHOLDS.MOON ? '🚀🌙' : 
                multiplier >= THRESHOLDS.ROCKET ? '🚀' : '📈';
  
  const pctGain = ((multiplier - 1) * 100).toFixed(0);
  const entryPrice = token.p0 || 0;
  const signalAge = token.firstSeen ? Math.floor((Date.now() - token.firstSeen) / 3600000) : 0;
  const avgScore = token.avgScr?.toFixed(2) || '0.00';
  
  let msg = `${emoji} <b>Performance Update</b>\n\n`;
  msg += `🪙 <b>${token.sym}</b> #${chainKey}\n`;
  msg += `Entry: $${entryPrice.toPrecision(4)} → Now: $${currentPrice.toPrecision(4)}\n`;
  msg += `<b>+${pctGain}% (${multiplier.toFixed(2)}x)</b>\n\n`;
  msg += `📊 ${token.scnt} signal${token.scnt > 1 ? 's' : ''} | Avg score: ${avgScore}\n`;
  msg += `⏱️ First signal: ${signalAge}h ago`;
  
  return msg;
}

async function processChain(chain) {
  console.log(`\n📊 Processing ${chain.name}...`);
  
  const db = new TelegramDBv4(BOT_TOKEN, chain.id);
  
  // Load index from pinned message
  await db.loadIndex();
  
  // Get tokens from index (contains essential token data)
  const indexKey = Keys.index();
  const index = db.get('index', indexKey);
  
  if (!index || !index.trackedTokens || index.trackedTokens.length === 0) {
    console.log(`   ℹ️ No tracked tokens for ${chain.name}`);
    return { updated: 0, posted: 0 };
  }
  
  const tokenAddresses = index.trackedTokens.map(t => t.addr);
  console.log(`   📋 ${tokenAddresses.length} tokens to check`);
  
  // Batch fetch current prices
  const prices = await getTokenPrices(chain.id, tokenAddresses);
  console.log(`   💰 Got prices for ${Object.keys(prices).length} tokens`);
  
  let updated = 0;
  let posted = 0;
  let indexModified = false;
  
  for (let i = 0; i < index.trackedTokens.length; i++) {
    const token = index.trackedTokens[i];
    const addr = token.addr.toLowerCase();
    const priceData = prices[addr];
    
    if (!priceData || priceData.priceUsd <= 0) continue;
    
    const entryPrice = token.p0 || 0;
    if (entryPrice <= 0) continue;
    
    const multiplier = priceData.priceUsd / entryPrice;
    const signalAge = Date.now() - (token.firstSeen || 0);
    
    // Update token with current price in index
    token.pNow = priceData.priceUsd;
    token.mult = multiplier;
    token.lastPriceUpdate = Date.now();
    indexModified = true;
    updated++;
    
    // Post performance update for significant gains on recent signals
    if (signalAge <= MAX_SIGNAL_AGE_MS && !token.postedPerf) {
      if (multiplier >= THRESHOLDS.GOOD) {
        const msg = formatPerformanceMessage(token, priceData.priceUsd, multiplier, chain.key);
        const result = await sendTelegramMessage(msg);
        
        if (result.ok) {
          console.log(`   🚀 Posted performance update: ${token.sym} +${((multiplier-1)*100).toFixed(0)}%`);
          token.postedPerf = multiplier >= THRESHOLDS.MOON ? 'moon' : 
                             multiplier >= THRESHOLDS.ROCKET ? 'rocket' : 'good';
          posted++;
        }
        
        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  
  // Save updated index with new prices
  if (indexModified) {
    index.lastPriceUpdate = Date.now();
    await db.update('index', indexKey, index);
    await db.pinIndex();
  }
  
  console.log(`   ✅ Updated ${updated} tokens, posted ${posted} updates`);
  return { updated, posted };
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
    totalPosted: 0,
  };
  
  try {
    for (const chain of CHAINS) {
      const chainResult = await processChain(chain);
      results.chains[chain.name] = chainResult;
      results.totalUpdated += chainResult.updated;
      results.totalPosted += chainResult.posted;
      
      // Small delay between chains
      await new Promise(r => setTimeout(r, 200));
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
