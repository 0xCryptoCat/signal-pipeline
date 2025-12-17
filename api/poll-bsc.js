/**
 * BSC Signal Polling Endpoint
 * Cron: Every minute at :30 seconds
 */

import { monitorSignals } from '../index.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const seenSignals = new Set();

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🟡 BSC poll at ${new Date().toISOString()}`);

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram config' });
  }

  try {
    const result = await monitorSignals({
      chainId: 56,
      trend: '1',
      pageSize: 10,
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      scoreWallets: true,
      minWallets: 3,
      seenSignals,
    });

    return res.status(200).json({
      ok: true,
      chain: 'bsc',
      chainId: 56,
      duration: Date.now() - startTime,
      newSignals: result.newSignals,
      tracked: seenSignals.size,
    });
  } catch (error) {
    console.error('❌ BSC poll error:', error);
    return res.status(500).json({ ok: false, chain: 'bsc', error: error.message });
  }
}
