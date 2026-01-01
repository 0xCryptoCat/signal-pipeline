/**
 * Base Signal Polling - /api/poll-base
 * Poll frequency: Every 4 minutes
 * Only posts signals with avgScore > 0
 * Stores signals to Telegram DB for tracking
 * Sends qualifying signals (score >= 0.3) to Trading Simulator
 */

import { monitorSignals } from '../index.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHAIN_ID = 8453;
const USE_DB = process.env.USE_TELEGRAM_DB === 'true';
const SIMULATOR_URL = process.env.SIMULATOR_URL || null;
const SIMULATOR_MIN_SCORE = parseFloat(process.env.SIMULATOR_MIN_SCORE) || 0.3;

const seenSignals = new Set();

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🚀 [Base] Poll at ${new Date().toISOString()} (db=${USE_DB}, sim=${!!SIMULATOR_URL})`);

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
      simulatorUrl: SIMULATOR_URL,
      simulatorMinScore: SIMULATOR_MIN_SCORE,
    });

    const duration = Date.now() - startTime;
    return res.status(200).json({
      ok: true,
      chain: 'Base',
      duration,
      newSignals: result.newSignals,
      skippedByScore: result.skippedByScore,
      tracked: seenSignals.size,
      dbEnabled: USE_DB,
      simulatorEnabled: !!SIMULATOR_URL,
    });

  } catch (error) {
    console.error('❌ [Base] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
