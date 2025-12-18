/**
 * Test Script for Telegram DB v2
 * 
 * Simulates full signal pipeline workflow:
 * 1. Process a signal
 * 2. Update token aggregate
 * 3. Update wallet aggregates
 * 4. Track performance over time
 * 5. Query for insights
 * 
 * Run: node test-telegram-db-v2.js
 */

import {
  TelegramDB,
  Keys,
  createIndex,
  createSignal,
  createToken,
  createWallet,
  createPerformance,
  calcMultiplier,
  calcPctChange,
  updateAvg,
  round,
  SAFE_LENGTH,
} from './lib/telegram-db-v2.js';

// ============================================================
// CONFIG
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';
const DB_CHANNEL_ID = '-1003645445736';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// MOCK DATA
// ============================================================

const mockSignal1 = {
  chainId: 501,
  batchId: '1766000000001',
  batchIndex: 0,
  tokenAddress: 'TokenABCDEF123456789012345678901234567890',
  tokenSymbol: 'ALPHA',
  priceAtSignal: '0.00001234',
  mcapAtSignal: '50000',
  eventTime: Date.now() - 3600000, // 1 hour ago
};

const mockWallets1 = [
  { walletAddress: 'Wallet111111111111111111111111111111111111', entryScore: 1.8 },
  { walletAddress: 'Wallet222222222222222222222222222222222222', entryScore: 1.2 },
  { walletAddress: 'Wallet333333333333333333333333333333333333', entryScore: 0.5 },
];

const mockSignal2 = {
  chainId: 501,
  batchId: '1766000000002',
  batchIndex: 0,
  tokenAddress: 'TokenABCDEF123456789012345678901234567890', // Same token!
  tokenSymbol: 'ALPHA',
  priceAtSignal: '0.00002468', // 2x from first signal
  mcapAtSignal: '100000',
  eventTime: Date.now(),
};

const mockWallets2 = [
  { walletAddress: 'Wallet111111111111111111111111111111111111', entryScore: 1.5 }, // Same wallet!
  { walletAddress: 'Wallet444444444444444444444444444444444444', entryScore: 0.8 },
];

// ============================================================
// TEST SUITE
// ============================================================

async function runTests() {
  console.log('🧪 Telegram DB v2 - Full Workflow Test\n');
  console.log(`📡 Channel: ${DB_CHANNEL_ID}`);
  console.log(`📏 Safe message length: ${SAFE_LENGTH} chars\n`);

  const db = new TelegramDB(BOT_TOKEN, DB_CHANNEL_ID);
  
  try {
    // ========================================
    // STEP 1: Initialize chain index
    // ========================================
    console.log('━━━ Step 1: Initialize Index ━━━');
    const indexKey = Keys.index(501);
    const index = createIndex(501);
    await db.store(indexKey, index);
    console.log(`✅ Created index: ${indexKey}`);
    console.log(`   Size: ${JSON.stringify(index).length} chars`);
    await sleep(300);

    // ========================================
    // STEP 2: Process Signal 1
    // ========================================
    console.log('\n━━━ Step 2: Process Signal 1 ━━━');
    
    // 2a. Store signal record
    const sig1Key = Keys.signal(501, mockSignal1.batchId, mockSignal1.batchIndex);
    const sig1Avg = round(mockWallets1.reduce((s, w) => s + w.entryScore, 0) / mockWallets1.length, 2);
    const sig1Record = createSignal(mockSignal1, mockWallets1, sig1Avg);
    await db.store(sig1Key, sig1Record);
    console.log(`✅ Stored signal: ${sig1Key}`);
    console.log(`   Size: ${JSON.stringify(sig1Record).length} chars`);
    console.log(`   Avg score: ${sig1Avg}`);
    await sleep(300);

    // 2b. Create/update token record
    const tokKey = Keys.token(501, mockSignal1.tokenAddress);
    const tokRecord = createToken(501, mockSignal1.tokenAddress, mockSignal1.tokenSymbol);
    tokRecord.scnt = 1;
    tokRecord.wcnt = mockWallets1.length;
    tokRecord.sigs.push([mockSignal1.eventTime, parseFloat(mockSignal1.priceAtSignal), sig1Avg]);
    tokRecord.wals = mockWallets1.map(w => w.walletAddress.slice(0, 8));
    tokRecord.px.push([Date.now(), parseFloat(mockSignal1.priceAtSignal)]);
    await db.store(tokKey, tokRecord);
    console.log(`✅ Stored token: ${tokKey}`);
    console.log(`   Size: ${JSON.stringify(tokRecord).length} chars`);
    await sleep(300);

    // 2c. Update wallet records
    for (const w of mockWallets1) {
      const walKey = Keys.wallet(501, w.walletAddress);
      const walRecord = createWallet(501, w.walletAddress);
      walRecord.scnt = 1;
      walRecord.avgScr = w.entryScore;
      walRecord.ents.push([mockSignal1.eventTime, mockSignal1.tokenAddress.slice(0, 8), parseFloat(mockSignal1.priceAtSignal), w.entryScore]);
      walRecord.scrs.push(w.entryScore);
      await db.store(walKey, walRecord);
      console.log(`✅ Stored wallet: ${walKey} (score: ${w.entryScore})`);
      await sleep(200);
    }

    // 2d. Update index
    const updatedIndex = db.get(indexKey);
    updatedIndex.last = mockSignal1.batchId + '_' + mockSignal1.batchIndex;
    updatedIndex.cnt = 1;
    updatedIndex.toks = 1;
    updatedIndex.wals = 3;
    await db.update(indexKey, updatedIndex);
    console.log(`✅ Updated index: cnt=${updatedIndex.cnt}, toks=${updatedIndex.toks}, wals=${updatedIndex.wals}`);
    await sleep(300);

    // ========================================
    // STEP 3: Process Signal 2 (same token, overlapping wallet)
    // ========================================
    console.log('\n━━━ Step 3: Process Signal 2 (repeat token) ━━━');

    // 3a. Store signal record
    const sig2Key = Keys.signal(501, mockSignal2.batchId, mockSignal2.batchIndex);
    const sig2Avg = round(mockWallets2.reduce((s, w) => s + w.entryScore, 0) / mockWallets2.length, 2);
    const sig2Record = createSignal(mockSignal2, mockWallets2, sig2Avg);
    await db.store(sig2Key, sig2Record);
    console.log(`✅ Stored signal: ${sig2Key}`);
    await sleep(300);

    // 3b. UPDATE token record (not create new)
    const existingTok = db.get(tokKey);
    existingTok.scnt = 2;
    existingTok.sigs.push([mockSignal2.eventTime, parseFloat(mockSignal2.priceAtSignal), sig2Avg]);
    // Add new wallet if not seen
    const newWals = mockWallets2
      .map(w => w.walletAddress.slice(0, 8))
      .filter(w => !existingTok.wals.includes(w));
    existingTok.wals.push(...newWals);
    existingTok.wcnt = existingTok.wals.length;
    existingTok.px.push([Date.now(), parseFloat(mockSignal2.priceAtSignal)]);
    await db.update(tokKey, existingTok);
    console.log(`✅ Updated token: signals=${existingTok.scnt}, wallets=${existingTok.wcnt}`);
    await sleep(300);

    // 3c. Update wallet records
    for (const w of mockWallets2) {
      const walKey = Keys.wallet(501, w.walletAddress);
      let walRecord = db.get(walKey);
      
      if (walRecord) {
        // Existing wallet - update
        walRecord.scnt += 1;
        walRecord.avgScr = updateAvg(walRecord.avgScr, walRecord.scnt - 1, w.entryScore);
        walRecord.ents.push([mockSignal2.eventTime, mockSignal2.tokenAddress.slice(0, 8), parseFloat(mockSignal2.priceAtSignal), w.entryScore]);
        walRecord.scrs.push(w.entryScore);
        await db.update(walKey, walRecord);
        console.log(`✅ Updated wallet: ${walKey} (signals: ${walRecord.scnt}, avgScore: ${walRecord.avgScr})`);
      } else {
        // New wallet
        walRecord = createWallet(501, w.walletAddress);
        walRecord.scnt = 1;
        walRecord.avgScr = w.entryScore;
        walRecord.ents.push([mockSignal2.eventTime, mockSignal2.tokenAddress.slice(0, 8), parseFloat(mockSignal2.priceAtSignal), w.entryScore]);
        walRecord.scrs.push(w.entryScore);
        await db.store(walKey, walRecord);
        console.log(`✅ Stored new wallet: ${walKey}`);
      }
      await sleep(200);
    }

    // ========================================
    // STEP 4: Performance tracking simulation
    // ========================================
    console.log('\n━━━ Step 4: Performance Tracking ━━━');
    
    const perfKey = Keys.perf(501, mockSignal1.batchId, mockSignal1.batchIndex);
    const perfRecord = createPerformance(mockSignal1);
    
    // Simulate price snapshots over time
    const prices = [0.00001234, 0.00001500, 0.00002000, 0.00002468];
    const times = [0, 900000, 1800000, 3600000]; // 0, 15min, 30min, 1hr
    
    for (let i = 0; i < prices.length; i++) {
      const mult = calcMultiplier(perfRecord.p0, prices[i]);
      perfRecord.snaps.push([perfRecord.t0 + times[i], prices[i], mult]);
    }
    
    await db.store(perfKey, perfRecord);
    console.log(`✅ Stored performance: ${perfKey}`);
    console.log(`   Entry: $${perfRecord.p0}`);
    console.log(`   Latest: $${prices[prices.length-1]} (${calcMultiplier(perfRecord.p0, prices[prices.length-1])}x)`);
    await sleep(300);

    // ========================================
    // STEP 5: Query insights
    // ========================================
    console.log('\n━━━ Step 5: Query Insights ━━━');
    
    // Token insights
    const tok = db.get(tokKey);
    console.log(`\n📊 Token ${tok.sym}:`);
    console.log(`   Signals: ${tok.scnt}`);
    console.log(`   Unique wallets: ${tok.wcnt}`);
    console.log(`   First signal price: $${tok.sigs[0][1]}`);
    console.log(`   Latest signal price: $${tok.sigs[tok.sigs.length-1][1]}`);
    console.log(`   Change: ${calcMultiplier(tok.sigs[0][1], tok.sigs[tok.sigs.length-1][1])}x`);

    // Wallet insights (Wallet111 appeared twice)
    const wal1Key = Keys.wallet(501, 'Wallet111111111111111111111111111111111111');
    const wal1 = db.get(wal1Key);
    console.log(`\n👛 Wallet ${wal1.addr.slice(0, 12)}:`);
    console.log(`   Signal appearances: ${wal1.scnt}`);
    console.log(`   Average score: ${wal1.avgScr}`);
    console.log(`   Score trend: ${wal1.scrs.join(' → ')}`);

    // Performance insights
    const perf = db.get(perfKey);
    console.log(`\n📈 Signal Performance:`);
    console.log(`   Entry: $${perf.p0}`);
    for (const snap of perf.snaps) {
      const ago = Math.round((snap[0] - perf.t0) / 60000);
      console.log(`   +${ago}min: $${snap[1]} (${snap[2]}x)`);
    }

    // ========================================
    // STATS
    // ========================================
    console.log('\n━━━ Final Stats ━━━');
    const stats = db.stats();
    console.log(`   Cached records: ${stats.cached}`);
    console.log(`   Message IDs tracked: ${stats.msgIds}`);

    // Size analysis
    console.log('\n━━━ Record Size Analysis ━━━');
    const sizes = {
      'Index': JSON.stringify(db.get(indexKey)).length,
      'Signal': JSON.stringify(sig1Record).length,
      'Token': JSON.stringify(db.get(tokKey)).length,
      'Wallet': JSON.stringify(db.get(wal1Key)).length,
      'Performance': JSON.stringify(db.get(perfKey)).length,
    };
    for (const [type, size] of Object.entries(sizes)) {
      const pct = Math.round((size / SAFE_LENGTH) * 100);
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      console.log(`   ${type.padEnd(12)} ${size.toString().padStart(4)} chars [${bar}] ${pct}%`);
    }

    console.log('\n✅ All tests complete! Check Telegram DB channel.');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
  }
}

runTests();
