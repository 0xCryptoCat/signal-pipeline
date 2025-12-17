/**
 * Test script for signal-pipeline
 * 
 * Tests the full flow: poll signals → score wallets → format message → send to Telegram
 */

import { monitorSignals } from './index.js';

// Load .env if present
import { readFileSync } from 'fs';
try {
  const env = readFileSync('.env', 'utf-8');
  env.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch {}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function test() {
  console.log('🧪 Signal Pipeline Test\n');
  console.log(`Bot Token: ${BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`Chat ID: ${CHAT_ID ? '✅ Set' : '❌ Missing'}\n`);

  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('⚠️  Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to send to Telegram');
    console.log('   Running in dry-run mode (no Telegram)\n');
  }

  const result = await monitorSignals({
    chainId: 501,
    trend: '1',
    pageSize: 3,
    botToken: BOT_TOKEN,
    chatId: CHAT_ID,
    scoreWallets: true,
    minWallets: 3,
    seenSignals: new Set(),
  });

  console.log('\n✅ Test complete');
  console.log(`   New signals: ${result.newSignals}`);
  console.log(`   Tracked: ${result.seenSignals.size}`);
}

test().catch(console.error);
