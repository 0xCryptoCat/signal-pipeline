/**
 * Test Telegram DB v4 - Multi-Chain Channel System
 * 
 * Tests each chain's 4 channels:
 * 1. Store test records
 * 2. Update records
 * 3. Archive and delete
 * 4. Verify cleanup
 * 
 * Run: node test-telegram-db-v4.js [chain]
 * Examples:
 *   node test-telegram-db-v4.js sol
 *   node test-telegram-db-v4.js all
 */

import {
  TelegramDBv4,
  CHANNELS,
  CHAIN_KEYS,
  Keys,
  createIndex,
  createSignal,
  createToken,
  createWallet,
  round,
  sleep,
} from './lib/telegram-db-v4.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';

// Chain to test (from args or default)
const CHAIN_ARG = process.argv[2] || 'sol';
const TEST_CHAINS = CHAIN_ARG === 'all' 
  ? ['sol', 'eth', 'bsc', 'base'] 
  : [CHAIN_ARG];

const CHAIN_IDS = { sol: 501, eth: 1, bsc: 56, base: 8453 };

// ============================================================
// TEST FUNCTIONS
// ============================================================

async function testChain(chainKey) {
  const chainId = CHAIN_IDS[chainKey];
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔗 Testing Chain: ${chainKey.toUpperCase()} (ID: ${chainId})`);
  console.log(`${'═'.repeat(60)}`);
  
  const db = new TelegramDBv4(BOT_TOKEN, chainId);
  
  console.log(`\n📡 Channels:`);
  console.log(`   Index:   ${CHANNELS[chainKey].index}`);
  console.log(`   Signals: ${CHANNELS[chainKey].signals}`);
  console.log(`   Tokens:  ${CHANNELS[chainKey].tokens}`);
  console.log(`   Wallets: ${CHANNELS[chainKey].wallets}`);
  console.log(`   Archive: ${CHANNELS.archive}`);

  const testResults = { passed: 0, failed: 0 };

  try {
    // Test 1: Index channel
    console.log(`\n━━━ Test 1: Index Channel ━━━`);
    const indexKey = Keys.index();
    const indexRecord = createIndex(chainId);
    indexRecord.totalSigs = 1;
    indexRecord.lastSigs = ['test_signal_1'];
    const indexMsgId = await db.store('index', indexKey, indexRecord);
    console.log(`   ✅ Stored index (msgId: ${indexMsgId})`);
    testResults.passed++;
    await sleep(300);

    // Test 2: Signals channel
    console.log(`\n━━━ Test 2: Signals Channel ━━━`);
    const mockSignal = {
      batchId: 'TEST001',
      batchIndex: 0,
      tokenAddress: 'TestToken123456789012345678901234567890',
      tokenSymbol: 'TEST',
      priceAtSignal: '0.001',
      mcapAtSignal: '100000',
      eventTime: Date.now(),
    };
    const mockWallets = [
      { walletAddress: 'TestWallet111111111111111111111111111111', entryScore: 1.5 },
    ];
    const sigKey = Keys.signal(mockSignal.batchId, mockSignal.batchIndex);
    const sigRecord = createSignal(mockSignal, mockWallets, 1.5);
    const sigMsgId = await db.store('signals', sigKey, sigRecord);
    console.log(`   ✅ Stored signal (msgId: ${sigMsgId})`);
    testResults.passed++;
    await sleep(300);

    // Test 3: Tokens channel
    console.log(`\n━━━ Test 3: Tokens Channel ━━━`);
    const tokKey = Keys.token(mockSignal.tokenAddress);
    const tokRecord = createToken(chainId, mockSignal.tokenAddress, 'TEST');
    tokRecord.scnt = 1;
    tokRecord.p0 = 0.001;
    const tokMsgId = await db.store('tokens', tokKey, tokRecord);
    console.log(`   ✅ Stored token (msgId: ${tokMsgId})`);
    testResults.passed++;
    await sleep(300);

    // Test 4: Wallets channel
    console.log(`\n━━━ Test 4: Wallets Channel ━━━`);
    const walKey = Keys.wallet(mockWallets[0].walletAddress);
    const walRecord = createWallet(chainId, mockWallets[0].walletAddress);
    walRecord.scnt = 1;
    walRecord.avgScr = 1.5;
    const walMsgId = await db.store('wallets', walKey, walRecord);
    console.log(`   ✅ Stored wallet (msgId: ${walMsgId})`);
    testResults.passed++;
    await sleep(300);

    // Test 5: Update record
    console.log(`\n━━━ Test 5: Update Record ━━━`);
    const updatedIndex = db.get('index', indexKey);
    updatedIndex.totalSigs = 2;
    updatedIndex.lastSigs.push('test_signal_2');
    await db.update('index', indexKey, updatedIndex);
    console.log(`   ✅ Updated index (same msgId: ${indexMsgId})`);
    testResults.passed++;
    await sleep(300);

    // Test 6: Archive and delete
    console.log(`\n━━━ Test 6: Archive & Delete ━━━`);
    await db.archiveAndDelete('signals', sigKey, 'test_cleanup');
    console.log(`   ✅ Signal archived to archive channel and deleted`);
    testResults.passed++;
    await sleep(300);

    // Test 7: Verify deletion
    console.log(`\n━━━ Test 7: Verify Deletion ━━━`);
    const deletedSig = db.get('signals', sigKey);
    if (!deletedSig) {
      console.log(`   ✅ Signal correctly removed from cache`);
      testResults.passed++;
    } else {
      console.log(`   ❌ Signal still in cache!`);
      testResults.failed++;
    }

    // Cleanup remaining test records
    console.log(`\n━━━ Cleanup: Removing Test Records ━━━`);
    await db.archiveAndDelete('index', indexKey, 'test_cleanup');
    console.log(`   ✅ Archived index`);
    await sleep(200);
    
    await db.archiveAndDelete('tokens', tokKey, 'test_cleanup');
    console.log(`   ✅ Archived token`);
    await sleep(200);
    
    await db.archiveAndDelete('wallets', walKey, 'test_cleanup');
    console.log(`   ✅ Archived wallet`);
    await sleep(200);

    // Final stats
    console.log(`\n━━━ Final Stats ━━━`);
    const stats = db.stats();
    console.log(`   Chain: ${stats.chain}`);
    console.log(`   Index:   ${stats.index} records (should be 0)`);
    console.log(`   Signals: ${stats.signals} records (should be 0)`);
    console.log(`   Tokens:  ${stats.tokens} records (should be 0)`);
    console.log(`   Wallets: ${stats.wallets} records (should be 0)`);

  } catch (err) {
    console.error(`\n   ❌ Test failed: ${err.message}`);
    testResults.failed++;
  }

  return testResults;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🧪 Telegram DB v4 - Multi-Chain Test Suite');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🔑 Bot: ${BOT_TOKEN.slice(0, 10)}...`);
  console.log(`🎯 Testing: ${TEST_CHAINS.join(', ')}`);

  const allResults = { passed: 0, failed: 0 };

  for (const chain of TEST_CHAINS) {
    const results = await testChain(chain);
    allResults.passed += results.passed;
    allResults.failed += results.failed;
    await sleep(1000); // Pause between chains
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 OVERALL RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   ✅ Passed: ${allResults.passed}`);
  console.log(`   ❌ Failed: ${allResults.failed}`);
  console.log(`\n${allResults.failed === 0 ? '🎉 All tests passed!' : '⚠️ Some tests failed!'}`);
  console.log(`\n📌 Check your Telegram channels to verify:`);
  console.log(`   1. Test records appeared in chain-specific channels`);
  console.log(`   2. Archived records appeared in archive-all channel`);
  console.log(`   3. Original records were deleted from chain channels`);
}

main().catch(console.error);
