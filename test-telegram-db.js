/**
 * Test Script for Telegram-as-Database
 * 
 * Run: node test-telegram-db.js
 * 
 * Tests:
 * 1. Store a signal record
 * 2. Store a token record
 * 3. Store a wallet record
 * 4. Store a lastseen record
 * 5. Update a record
 * 6. Check size limits
 */

import {
  TelegramDB,
  createSignalRecord,
  createTokenRecord,
  createWalletRecord,
  createLastSeenRecord,
  MAX_MESSAGE_LENGTH,
} from './lib/telegram-db.js';

// ============================================================
// CONFIG
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';
const DB_CHANNEL_ID = '-1003645445736'; // Private DB channel

// ============================================================
// TEST HELPERS
// ============================================================

function log(test, result, details = '') {
  const icon = result ? '✅' : '❌';
  console.log(`${icon} ${test}${details ? `: ${details}` : ''}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// TESTS
// ============================================================

async function runTests() {
  console.log('🧪 Telegram-as-Database Test Suite\n');
  console.log(`📡 DB Channel: ${DB_CHANNEL_ID}`);
  console.log(`🔑 Bot Token: ${BOT_TOKEN.slice(0, 10)}...`);
  console.log('');

  const db = new TelegramDB(BOT_TOKEN, DB_CHANNEL_ID);
  
  try {
    // Test 1: Store a signal record
    console.log('--- Test 1: Signal Record ---');
    const mockSignal = {
      chainId: 501,
      batchId: '1765998826232',
      batchIndex: 1,
      tokenAddress: 'So11111111111111111111111111111111111111112',
      tokenSymbol: 'SOL',
      priceAtSignal: '234.56',
      mcapAtSignal: '100000000',
      eventTime: Date.now(),
    };
    const mockWallets = [
      { walletAddress: '0x1234567890abcdef1234567890abcdef12345678', entryScore: 1.5 },
      { walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12', entryScore: 0.8 },
    ];
    const signalRecord = createSignalRecord(mockSignal, mockWallets, 1.15);
    const signalKey = `sig:${mockSignal.chainId}:${mockSignal.batchId}-${mockSignal.batchIndex}`;
    
    const msgId1 = await db.store(signalKey, signalRecord);
    log('Store signal', msgId1 > 0, `messageId=${msgId1}`);
    console.log(`   Size: ${JSON.stringify(signalRecord).length} chars`);
    await sleep(500);

    // Test 2: Store a token record
    console.log('\n--- Test 2: Token Record ---');
    const tokenRecord = createTokenRecord(
      501,
      'So11111111111111111111111111111111111111112',
      'SOL'
    );
    const tokenKey = `tok:501:So11111111111111111111111111111111111111112`;
    
    const msgId2 = await db.store(tokenKey, tokenRecord);
    log('Store token', msgId2 > 0, `messageId=${msgId2}`);
    console.log(`   Size: ${JSON.stringify(tokenRecord).length} chars`);
    await sleep(500);

    // Test 3: Store a wallet record
    console.log('\n--- Test 3: Wallet Record ---');
    const walletRecord = createWalletRecord(
      501,
      '0x1234567890abcdef1234567890abcdef12345678'
    );
    const walletKey = `wal:501:0x1234567890abcdef`;
    
    const msgId3 = await db.store(walletKey, walletRecord);
    log('Store wallet', msgId3 > 0, `messageId=${msgId3}`);
    console.log(`   Size: ${JSON.stringify(walletRecord).length} chars`);
    await sleep(500);

    // Test 4: Store a lastseen record
    console.log('\n--- Test 4: LastSeen Record ---');
    const lastSeenRecord = createLastSeenRecord(501, '1765998826232');
    const lastSeenKey = `last:501`;
    
    const msgId4 = await db.store(lastSeenKey, lastSeenRecord);
    log('Store lastseen', msgId4 > 0, `messageId=${msgId4}`);
    console.log(`   Size: ${JSON.stringify(lastSeenRecord).length} chars`);
    await sleep(500);

    // Test 5: Update a record
    console.log('\n--- Test 5: Update Record ---');
    const updatedLastSeen = createLastSeenRecord(501, '1765998826233');
    const msgId5 = await db.update(lastSeenKey, updatedLastSeen);
    log('Update lastseen', msgId5 === msgId4, `same messageId=${msgId5}`);
    await sleep(500);

    // Test 6: Upsert (new record)
    console.log('\n--- Test 6: Upsert New ---');
    const newLastSeen = createLastSeenRecord(56, '9999999');
    const bscKey = `last:56`;
    const msgId6 = await db.upsert(bscKey, newLastSeen);
    log('Upsert new', msgId6 > 0, `messageId=${msgId6}`);
    await sleep(500);

    // Test 7: Upsert (existing record)
    console.log('\n--- Test 7: Upsert Existing ---');
    const updatedBsc = createLastSeenRecord(56, '9999998');
    const msgId7 = await db.upsert(bscKey, updatedBsc);
    log('Upsert existing', msgId7 === msgId6, `same messageId=${msgId7}`);
    await sleep(500);

    // Test 8: Cache retrieval
    console.log('\n--- Test 8: Cache Get ---');
    const cached = db.get(lastSeenKey);
    log('Get from cache', cached !== null, `lastSignalId=${cached?.lastSignalId}`);

    // Test 9: Size limit check
    console.log('\n--- Test 9: Size Limits ---');
    const bigData = { data: 'x'.repeat(3500) };
    try {
      await db.store('test:big', bigData);
      log('Store big record', true, `${JSON.stringify(bigData).length} chars`);
    } catch (err) {
      log('Store big record', false, err.message);
    }
    await sleep(500);

    // Test 10: Too big record
    console.log('\n--- Test 10: Too Big Record ---');
    const tooBig = { data: 'x'.repeat(5000) };
    try {
      await db.store('test:toobig', tooBig);
      log('Reject too big', false, 'Should have thrown');
    } catch (err) {
      log('Reject too big', true, err.message);
    }

    // Stats
    console.log('\n--- Stats ---');
    const stats = db.stats();
    console.log(`   Cached records: ${stats.cachedRecords}`);
    console.log(`   Cached message IDs: ${stats.cachedMessageIds}`);

    console.log('\n✅ All tests complete! Check your Telegram DB channel.');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
  }
}

// Run tests
runTests();
