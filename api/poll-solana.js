/**
 * Solana Signal Polling Endpoint
 * 
 * Uses Vercel KV to track last processed signal ID.
 * Fallback: in-memory Set (resets on cold start)
 */

import { monitorSignals } from '../index.js';
import { getLastSignalId, setLastSignalId, isKvAvailable } from '../lib/kv.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHAIN_ID = 501;

// In-memory fallback
const seenSignals = new Set();

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🟣 Solana poll at ${new Date().toISOString()}`);

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram config' });
  }

  try {
    // Get last signal ID from KV (if available)
    const lastSignalId = await getLastSignalId(CHAIN_ID);
    
    const result = await monitorSignals({
      chainId: CHAIN_ID,
      trend: '1',
      pageSize: 10,
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      scoreWallets: true,
      minWallets: 3,
      seenSignals,
      lastSignalId,
    });

    // Update last signal ID in KV
    if (result.highestSignalId && result.highestSignalId > (lastSignalId || 0)) {
      await setLastSignalId(CHAIN_ID, result.highestSignalId);
      console.log(`   📌 Updated lastSignalId to ${result.highestSignalId}`);
    }

    return res.status(200).json({
      ok: true,
      chain: 'solana',
      chainId: CHAIN_ID,
      duration: Date.now() - startTime,
      newSignals: result.newSignals,
      lastSignalId: result.highestSignalId,
      kvEnabled: isKvAvailable(),
    });
  } catch (error) {
    console.error('❌ Solana poll error:', error);
    return res.status(500).json({ ok: false, chain: 'solana', error: error.message });
  }
}
