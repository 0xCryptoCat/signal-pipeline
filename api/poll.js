/**
 * Vercel API Handler for Signal Polling (Solana - Default)
 * 
 * Triggered by external cron (cron-job.org).
 * Polls OKX signals, scores wallets, posts to Telegram.
 * Only posts signals with avgScore > 0 (quality filter).
 * 
 * No KV required - uses in-memory dedup + score filtering.
 */

import { monitorSignals } from '../index.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHAIN_ID = 501; // Solana

// In-memory dedup (per instance, resets on cold start - acceptable)
const seenSignals = new Set();

export default async function handler(req, res) {
  const startTime = Date.now();
  
  console.log(`\n🚀 [Solana] Poll triggered at ${new Date().toISOString()}`);

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram config' });
  }

  try {
    const result = await monitorSignals({
      chainId: CHAIN_ID,
      trend: '1',
      pageSize: 10,
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      scoreWallets: true,
      minWallets: 1,
      minScore: 0,           // Only post signals with avgScore > 0
      seenSignals,           // In-memory dedup
    });

    const duration = Date.now() - startTime;
    console.log(`✅ [Solana] Complete in ${duration}ms - ${result.newSignals} posted, ${result.skippedByScore} filtered`);

    return res.status(200).json({
      ok: true,
      chain: 'Solana',
      duration,
      newSignals: result.newSignals,
      skippedByScore: result.skippedByScore,
      tracked: seenSignals.size,
    });

  } catch (error) {
    console.error('❌ [Solana] Poll error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
