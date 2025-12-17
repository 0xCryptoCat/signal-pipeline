/**
 * Base Signal Polling - /api/poll-base
 * Poll frequency: Every 4 minutes
 * Only posts signals with avgScore > 0
 */

import { monitorSignals } from '../index.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHAIN_ID = 8453;

const seenSignals = new Set();

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🚀 [Base] Poll at ${new Date().toISOString()}`);

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
    });

    const duration = Date.now() - startTime;
    return res.status(200).json({
      ok: true,
      chain: 'Base',
      duration,
      newSignals: result.newSignals,
      skippedByScore: result.skippedByScore,
      tracked: seenSignals.size,
    });

  } catch (error) {
    console.error('❌ [Base] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
