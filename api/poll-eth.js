/**
 * Ethereum Signal Polling - /api/poll-eth
 * Poll frequency: Every 2 minutes
 * Only posts signals with avgScore > 0
 * Stores signals to Telegram DB for tracking
 */

import { monitorSignals } from '../index.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHAIN_ID = 1;
const USE_DB = process.env.USE_TELEGRAM_DB === 'true';

const seenSignals = new Set();

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🚀 [Ethereum] Poll at ${new Date().toISOString()} (db=${USE_DB})`);

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
      minScore: 0,
      seenSignals,
      useDB: USE_DB,
    });

    const duration = Date.now() - startTime;
    return res.status(200).json({
      ok: true,
      chain: 'Ethereum',
      duration,
      newSignals: result.newSignals,
      skippedByScore: result.skippedByScore,
      tracked: seenSignals.size,
      dbEnabled: USE_DB,
    });

  } catch (error) {
    console.error('❌ [Ethereum] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
