/**
 * Test DB Integration
 * 
 * Tests the db-integration.js wrapper with mock signal data.
 * Run: node test-db-integration.js
 */

import {
  storeSignalData,
  isSignalSeen,
  getTokenEnhancement,
  getWalletEnhancement,
  initializeDB,
  Keys,
} from './lib/db-integration.js';

const BOT_TOKEN = '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';

// Mock signal data (similar to processSignal output)
function createMockSignal(index = 1) {
  const now = Date.now();
  return {
    id: 1000 + index,
    batchId: now + index,
    batchIndex: 0,
    chainId: 501,
    eventTime: now,
    eventTimeFormatted: new Date(now).toISOString(),
    trend: '1',
    signalLabel: 'smartMoney',
    tokenKey: '501!@#mock_token_' + index,
    tokenAddress: 'MockToken' + 'ABCDEFGHIJ123456'.slice(0, 10) + index,
    tokenSymbol: 'MOCK' + index,
    priceAtSignal: '0.00123',
    priceNow: '0.00125',
    priceChange: '+1.63%',
    addressNum: 3,
    avgPnl7d: '125.5%',
    avgRoi: '89.3%',
    avgWinRate: '67.5%',
    explorerUrl: 'https://solscan.io/token/MockTokenABCDEFGHIJ12345' + index,
  };
}

function createMockWalletDetails(count = 3) {
  const wallets = [];
  for (let i = 0; i < count; i++) {
    wallets.push({
      walletAddress: 'Wallet' + 'XYZABC123456789'.slice(0, 10) + i + Date.now().toString().slice(-4),
      entryScore: Math.random() * 2 - 0.5, // -0.5 to +1.5
      pnl7d: (Math.random() * 200 - 50).toFixed(1) + '%',
      roi: (Math.random() * 100).toFixed(1) + '%',
      winRate: (50 + Math.random() * 30).toFixed(1) + '%',
      totalTrades: Math.floor(Math.random() * 100) + 10,
      signalLabel: ['smartMoney', 'whales', 'kol'][Math.floor(Math.random() * 3)],
    });
  }
  return wallets;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// TESTS
// ============================================================

async function test1_initDB() {
  console.log('\n📋 TEST 1: Initialize DB for Solana chain');
  
  const db = await initializeDB(BOT_TOKEN, 501);
  console.log('   ✅ DB initialized for chain 501 (Solana)');
  
  return db;
}

async function test2_storeSignal(db) {
  console.log('\n📋 TEST 2: Store a mock signal');
  
  const signal = createMockSignal(1);
  const walletDetails = createMockWalletDetails(3);
  const avgScore = 0.75;
  
  console.log(`   📝 Signal: ${signal.tokenSymbol} @ ${signal.priceAtSignal}`);
  console.log(`   📝 Wallets: ${walletDetails.length} (avgScore: ${avgScore})`);
  
  const results = await storeSignalData(db, signal, walletDetails, avgScore);
  
  console.log(`   📊 Results: signal=${results.signal}, token=${results.token}, wallets=${results.wallets}, index=${results.index}`);
  
  if (results.signal && results.token && results.wallets > 0 && results.index) {
    console.log('   ✅ Signal stored successfully');
  } else {
    console.log('   ⚠️ Some storage operations may have failed');
  }
  
  return { signal, walletDetails };
}

async function test3_checkDedup(db, signal) {
  console.log('\n📋 TEST 3: Check deduplication');
  
  // Should be seen
  const seen1 = isSignalSeen(db, signal.batchId, signal.batchIndex);
  console.log(`   Signal ${signal.batchId}-${signal.batchIndex} seen: ${seen1}`);
  
  // Should NOT be seen
  const seen2 = isSignalSeen(db, 999999999, 0);
  console.log(`   Signal 999999999-0 seen: ${seen2}`);
  
  if (seen1 && !seen2) {
    console.log('   ✅ Deduplication working correctly');
  } else {
    console.log('   ❌ Deduplication not working');
  }
}

async function test4_getEnhancements(db, signal, walletDetails) {
  console.log('\n📋 TEST 4: Get token/wallet enhancements');
  
  // Token enhancement
  const tokenEnh = getTokenEnhancement(db, signal.tokenAddress);
  console.log(`   Token enhancement:`, tokenEnh);
  
  // Wallet enhancement (first wallet)
  const walletEnh = getWalletEnhancement(db, walletDetails[0].walletAddress);
  console.log(`   Wallet enhancement:`, walletEnh);
  
  if (tokenEnh && tokenEnh.signalCount === 1) {
    console.log('   ✅ Token enhancement working');
  } else {
    console.log('   ⚠️ Token enhancement may not be cached yet');
  }
}

async function test5_multipleSignals(db) {
  console.log('\n📋 TEST 5: Store multiple signals for same token');
  
  // Store 2 more signals for a repeated token
  for (let i = 2; i <= 3; i++) {
    const signal = createMockSignal(1); // Same token
    signal.batchId = Date.now() + i * 1000;
    signal.batchIndex = i;
    signal.eventTime = Date.now();
    
    const walletDetails = createMockWalletDetails(2);
    const avgScore = 0.5 + i * 0.1;
    
    console.log(`   📝 Signal ${i}: ${signal.tokenSymbol}`);
    await storeSignalData(db, signal, walletDetails, avgScore);
    await sleep(500);
  }
  
  // Check token has accumulated
  const tokenEnh = getTokenEnhancement(db, 'MockTokenABCDEFGHIJ1');
  console.log(`   Token after 3 signals:`, tokenEnh);
  
  if (tokenEnh && tokenEnh.signalCount >= 2) {
    console.log('   ✅ Multiple signals aggregated correctly');
  } else {
    console.log('   ⚠️ Aggregation may not be working (check cache)');
  }
}

async function test6_differentChain() {
  console.log('\n📋 TEST 6: Test different chain (Ethereum)');
  
  const db = await initializeDB(BOT_TOKEN, 1);
  console.log('   ✅ DB initialized for chain 1 (Ethereum)');
  
  const signal = createMockSignal(10);
  signal.chainId = 1;
  const walletDetails = createMockWalletDetails(2);
  
  const results = await storeSignalData(db, signal, walletDetails, 0.9);
  
  if (results.signal && results.index) {
    console.log('   ✅ Ethereum signal stored to correct channels');
  } else {
    console.log('   ⚠️ Ethereum storage may have issues');
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🧪 DB Integration Test Suite\n');
  console.log('=' .repeat(60));
  
  try {
    // Test 1: Initialize
    const db = await test1_initDB();
    await sleep(500);
    
    // Test 2: Store signal
    const { signal, walletDetails } = await test2_storeSignal(db);
    await sleep(500);
    
    // Test 3: Dedup check
    await test3_checkDedup(db, signal);
    
    // Test 4: Enhancements
    await test4_getEnhancements(db, signal, walletDetails);
    
    // Test 5: Multiple signals
    await test5_multipleSignals(db);
    await sleep(500);
    
    // Test 6: Different chain
    await test6_differentChain();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('\n⚠️ Check the private Telegram channels to verify data was stored:');
    console.log('   Solana: signals=-1003683149932, tokens=-1003300774874, wallets=-1003664436076');
    console.log('   Ethereum: signals=-1003578324311');
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
  }
}

main();
