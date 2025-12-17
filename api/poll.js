/**
 * Vercel API Handler for Signal Polling
 * 
 * Triggered by external cron (cron-job.org) every 1 minute.
 * Polls OKX signals, scores wallets, posts to Telegram.
 * 
 * Environment Variables:
 * - TELEGRAM_BOT_TOKEN: Bot token from @BotFather
 * - TELEGRAM_CHAT_ID: Channel/group ID to post to
 */

import {
  monitorSignals,
} from '../index.js';

// ============================================================
// CONFIG - From environment variables
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// In-memory signal tracking (resets on cold start, but that's fine for 1-min polling)
// Signals are tracked by batchId-batchIndex to prevent duplicates
const seenSignals = new Set();

/**
 * Main polling handler
 */
export default async function handler(req, res) {
  const startTime = Date.now();
  
  console.log(`\n🚀 Signal poll triggered at ${new Date().toISOString()}`);

  // Check config
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return res.status(500).json({
      ok: false,
      error: 'Missing Telegram configuration',
    });
  }

  try {
    // Run the monitor
    const result = await monitorSignals({
      chainId: 501,           // Solana only for now
      trend: '1',             // BUY signals only
      pageSize: 10,           // Check last 10 signals
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      scoreWallets: true,     // Score entry quality
      minWallets: 1,          // Minimum 1 wallet to post
      seenSignals,            // Track seen signals to avoid duplicates
    });

    const duration = Date.now() - startTime;
    
    console.log(`✅ Poll complete in ${duration}ms - ${result.newSignals} new signal(s)`);

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration,
      newSignals: result.newSignals,
      trackedSignals: seenSignals.size,
    });

  } catch (error) {
    console.error('❌ Poll error:', error);
    
    return res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
