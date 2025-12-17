/**
 * Vercel API Handler for Signal Polling
 * 
 * Triggered by external cron (cron-job.org) every 1 minute.
 * Polls OKX signals, scores wallets, posts to Telegram.
 * 
 * Environment Variables:
 * - TELEGRAM_BOT_TOKEN: Bot token from @BotFather
 * - TELEGRAM_CHAT_ID: Channel/group ID to post to
 * - KV_REST_API_URL: Vercel KV REST API URL
 * - KV_REST_API_TOKEN: Vercel KV REST API token
 */

import {
  monitorSignals,
} from '../index.js';
import { getLastSignalId, setLastSignalId } from '../lib/kv.js';

// ============================================================
// CONFIG - From environment variables
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHAIN_ID = 501; // Solana - default chain for main poll endpoint

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
    // Get last processed signal ID from KV
    const lastSignalId = await getLastSignalId(CHAIN_ID);
    console.log(`📍 Last signal ID for chain ${CHAIN_ID}: ${lastSignalId || 'none'}`);
    
    // Run the monitor
    const result = await monitorSignals({
      chainId: CHAIN_ID,      // Solana
      trend: '1',             // BUY signals only
      pageSize: 10,           // Check last 10 signals
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      scoreWallets: true,     // Score entry quality
      minWallets: 1,          // Minimum 1 wallet to post
      lastSignalId,           // KV-based deduplication
    });

    // Store highest signal ID for next poll
    if (result.highestSignalId) {
      await setLastSignalId(CHAIN_ID, result.highestSignalId);
      console.log(`💾 Stored new highest signal ID: ${result.highestSignalId}`);
    }

    const duration = Date.now() - startTime;
    
    console.log(`✅ Poll complete in ${duration}ms - ${result.newSignals} new signal(s)`);

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration,
      newSignals: result.newSignals,
      skippedSignals: result.seenSignals,
      lastSignalId: result.highestSignalId,
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
