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
  { id: 501, name: 'SOL', tag: 'solana', key: 'sol' },
  { id: 1, name: 'ETH', tag: 'ethereum', key: 'eth' },
  { id: 56, name: 'BSC', tag: 'bsc', key: 'bsc' },
  { id: 8453, name: 'BASE', tag: 'base', key: 'base' },
];

// Performance thresholds for posting updates
const THRESHOLDS = {
  // Gains (positive multipliers)
  GOD: 10.0,      // 10x = +900%
  MOON: 5.0,      // 5x = +400%
  PUMP: 2.0,      // 2x = +100%
  ROCKET: 1.5,    // +50%
  GOOD: 1.25,     // +25%
  // Losses (multipliers below 1)
  BAD: 0.75,      // -25% loss
  DUMP: 0.5,      // -50% loss
  RUG: 0.25,      // -75% loss
};

// Minimum liquidity to consider token not rugged (USD)
const MIN_LIQUIDITY_USD = 1000;

// Only post updates for signals newer than this
const MAX_SIGNAL_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
const MAX_TRACKING_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for winners

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
 */
function buildMessageLink(chatId, msgId) {
  if (!chatId || !msgId) return null;
  const cleanChatId = String(chatId).replace(/^-100/, '');
  return `https://t.me/c/${cleanChatId}/${msgId}`;
}

/**
 * Format number with K/M/B suffixes
 */
function formatCompactNumber(num) {
  const absNum = Math.abs(num);
  if (absNum >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
  if (absNum >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (absNum >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toFixed(0);
}

/**
 * Pad string with spaces to right
 */
function padRight(str, len) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

/**
 * Format a single token line for the aggregated performance message
 */
function formatTokenLine(performer, chatId) {
  const { token, multiplier, chainTag, isRugged } = performer;
  
  // For rugged tokens: show 0.0x and -100%
  const displayMultiplier = isRugged ? 0 : multiplier;
  const pctVal = isRugged ? -100 : ((multiplier - 1) * 100);
  const sign = pctVal >= 0 ? '+' : '';
  
  // Format percentage: "+1.7K%" or "-97%"
  const pctStr = `${sign}${formatCompactNumber(pctVal)}%`;
  const paddedPct = padRight(pctStr, 5); // Pad to 7 chars
  
  // Format multiplier: "(18.65x)"
  const multStr = `(${displayMultiplier.toFixed(2)}x)`;
  
  // Emoji based on performance
  let emoji;
  if (isRugged) emoji = '🪦';
  else if (multiplier >= THRESHOLDS.GOD) emoji = '🦄';
  else if (multiplier >= THRESHOLDS.MOON) emoji = '🌙';
  else if (multiplier >= THRESHOLDS.PUMP) emoji = '🚀';
  else if (multiplier >= THRESHOLDS.ROCKET) emoji = '🚀';
  else if (multiplier >= THRESHOLDS.GOOD) emoji = '📈';
  else if (multiplier >= 1.0) emoji = '➡️';
  else if (multiplier <= THRESHOLDS.RUG) emoji = '🪦'; // < -75%
  else if (multiplier <= THRESHOLDS.DUMP) emoji = '💀'; // < -50%
  else emoji = '📉';
  
  const signalCount = token.scnt || 1;
  const signalInfo = signalCount > 1 ? ` 🚨x${signalCount}` : '';
  
  // Build message link for token symbol (links to last signal)
  const msgLink = buildMessageLink(chatId, token.lastMsgId);
  const tokenName = msgLink 
    ? `<a href="${msgLink}">${token.sym}</a>`
    : token.sym;
  
  // Chain tag uppercase
  const chainLabel = `#${chainTag.toUpperCase()}`;
  
  // Format: <code>🦄 +1.7K% (18.65x)</code> #SOL <a>PIMP</a> 🚨x2
  return `<code>${emoji} ${paddedPct} ${multStr}</code> ${chainLabel} <b>${tokenName}</b>${signalInfo}`;
}

/**
 * Format aggregated performance message for all tokens
 */
function formatAggregatedMessage(performers, chatId, isPublic = false) {
  if (performers.length === 0) return null;
  
  // Separate gains and losses
  const gains = performers.filter(p => p.multiplier >= 1.0 && !p.isRugged);
  const losses = performers.filter(p => p.multiplier < 1.0 || p.isRugged);
  
  // Sort gains by multiplier descending, losses by multiplier ascending (worst first)
  gains.sort((a, b) => b.multiplier - a.multiplier);
  losses.sort((a, b) => a.multiplier - b.multiplier);
  
  const totalCount = gains.length + losses.length;
  let msg = `🚨 <b>Signal Performance</b> (${totalCount} tokens)\n`;
  
  // Gains section
  if (gains.length > 0) {
    // Calculate total gains stats
    let totalPctGain = 0;
    
    for (const p of gains) {
      const pct = (p.multiplier - 1) * 100;
      totalPctGain += pct;
    }
    
    // Implied multiplier from total percentage gain
    // e.g. +821% -> 9.2x
    const impliedMultiplier = (totalPctGain / 100) + 1;
    
    const totalPctStr = `+${formatCompactNumber(totalPctGain)}%`;
    const avgMultStr = `(${impliedMultiplier.toFixed(1)}x)`;
    
    msg += `\n📈 <b>Gains</b> (${gains.length}) ${totalPctStr} ${avgMultStr}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const p of gains) {
      msg += formatTokenLine(p, chatId) + '\n';
    }
  }
  
  // Losses section
  if (losses.length > 0) {
    msg += `\n📉 <b>Losses</b> (${losses.length})\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
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
    // Skip archived tokens
    if (token.archived) continue;

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
      token.archived = true; // Archive rugged tokens immediately after reporting
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
    
    // Archive Logic
    // 1. Hard Dump: 50% drop from ATH
    const peakPrice = token.pPeak || entryPrice;
    const dropFromPeak = (peakPrice - currentPrice) / peakPrice;
    if (dropFromPeak >= 0.5) {
      token.archived = true;
    }
    
    // 2. Time Limit: 
    // - Winners (> entry): Track for 7 days
    // - Losers (< entry): Track for 48 hours
    const isWinner = currentMultiplier >= 1.0;
    const maxAge = isWinner ? MAX_TRACKING_AGE_MS : MAX_SIGNAL_AGE_MS;
    
    if (signalAge > maxAge) {
      token.archived = true;
    }
    
    db.updateToken(addr, token);
    updated++;
    
    // Reporting Logic
    let shouldReport = false;
    let reportType = null;
    
    // Check if token has ever "mooned" (pumped > 5% initially)
    // If it has, we treat it as a winner and ignore subsequent drops
    const peakMult = (token.pPeak || entryPrice) / entryPrice;
    const hasMooned = peakMult > 1.05; 
    
    if (signalAge <= MAX_SIGNAL_AGE_MS) {
      if (newlyRugged) {
        // RUGGED: Token just got rugged
        shouldReport = true;
        reportType = 'rugged';
      } else if (!isRugged) {
        if (currentMultiplier >= 1.0 && isNewATH) {
          // GAIN: New all-time high
          shouldReport = true;
          reportType = 'gain';
        } else if (currentMultiplier < 1.0) {
          // LOSS: Only report if it NEVER pumped and hit new ATL
          // Also report if it's the final "dump" archive message (< 0.5)
          if (!hasMooned && isNewATL) {
             shouldReport = true;
             reportType = 'loss';
          } else if (currentMultiplier <= 0.5 && !token.lastDumpReported) {
             // Ensure we report the dump at least once before archiving
             shouldReport = true;
             reportType = 'loss';
             token.lastDumpReported = true;
          }
        }
      }
    }
    
    if (shouldReport) {
      allPerformers.push({
        token,
        entryPrice,
        currentPrice,
        multiplier: currentMultiplier,
        chainTag: chain.name,
        isNewHigh: isNewATH,
        isNewLow: isNewATL,
        reportType,
        isRugged: reportType === 'rugged',
        liquidity,
      });
      
      performerCount++;
      
      const sign = currentMultiplier >= 1 ? '+' : '';
      let typeLog;
      if (reportType === 'rugged') typeLog = '🪦 RUG';
      else if (reportType === 'gain') typeLog = '📈 ATH';
      else typeLog = '📉 ATL';
      console.log(`   ${typeLog}: ${token.sym} ${sign}${((currentMultiplier-1)*100).toFixed(0)}% (${currentMultiplier.toFixed(2)}x) liq:$${liquidity.toFixed(0)}`);
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
