/**
 * Test Telegram DB v3 - Multi-Channel Architecture
 * 
 * Tests:
 * 1. Multi-channel setup (index, signals, tokens, wallets)
 * 2. Signal processing with outcome tracking
 * 3. Token aggregation across signals
 * 4. Wallet performance correlation
 * 5. Expiry/retention logic
 * 6. Index updates with top performers
 * 
 * Before running: Create 4 private channels and update IDs below!
 * Or use the same channel for testing (works but less organized)
 */

import {
  TelegramDBv3,
  Keys,
  RETENTION,
  createIndex,
  createSignal,
  createToken,
  createWallet,
  determineOutcome,
  calcMultiplier,
  updateAvg,
  updateWinRate,
  calcConsistency,
  round,
  DAY_MS,
} from './lib/telegram-db-v3.js';

// ============================================================
// CONFIG - Update with your channel IDs!
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';

// For testing, we'll use the same channel with different prefixes
// In production, use separate channels per type
const DB_CHANNEL = '-1003645445736';

const CHANNELS_SOL = {
  index: DB_CHANNEL,
  signals: DB_CHANNEL,
  tokens: DB_CHANNEL,
  wallets: DB_CHANNEL,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// MOCK DATA - Simulating 3 signals over time
// ============================================================

const NOW = Date.now();

// Signal 1: Token A, 3 wallets, happened 2 hours ago
const signal1 = {
  chainId: 501,
  batchId: '1766100000001',
  batchIndex: 0,
  tokenAddress: 'ALPHAtoken11111111111111111111111111111111',
  tokenSymbol: 'ALPHA',
  priceAtSignal: '0.00001000',
  mcapAtSignal: '50000',
  eventTime: NOW - 2 * 3600000,
};
const wallets1 = [
  { walletAddress: 'SmartWallet1111111111111111111111111111111', entryScore: 1.8 },
  { walletAddress: 'SmartWallet2222222222222222222222222222222', entryScore: 1.2 },
  { walletAddress: 'WeakWallet33333333333333333333333333333333', entryScore: -0.5 },
];

// Signal 2: Same Token A (repeat!), 2 wallets including 1 from before
const signal2 = {
  chainId: 501,
  batchId: '1766100000002',
  batchIndex: 0,
  tokenAddress: 'ALPHAtoken11111111111111111111111111111111',
  tokenSymbol: 'ALPHA',
  priceAtSignal: '0.00002500', // 2.5x from signal 1!
  mcapAtSignal: '125000',
  eventTime: NOW - 1 * 3600000,
};
const wallets2 = [
  { walletAddress: 'SmartWallet1111111111111111111111111111111', entryScore: 1.5 }, // Repeat!
  { walletAddress: 'NewWallet444444444444444444444444444444444', entryScore: 0.8 },
];

// Signal 3: Different Token B, 2 wallets
const signal3 = {
  chainId: 501,
  batchId: '1766100000003',
  batchIndex: 0,
  tokenAddress: 'BETAtoken2222222222222222222222222222222222',
  tokenSymbol: 'BETA',
  priceAtSignal: '0.00005000',
  mcapAtSignal: '200000',
  eventTime: NOW,
};
const wallets3 = [
  { walletAddress: 'SmartWallet2222222222222222222222222222222', entryScore: 2.0 }, // Repeat!
  { walletAddress: 'SmartWallet1111111111111111111111111111111', entryScore: 1.0 }, // 3rd appearance!
];

// ============================================================
// TEST SUITE
// ============================================================

async function runTests() {
  console.log('🧪 Telegram DB v3 - Multi-Channel Test\n');
  console.log(`📡 Using channel: ${DB_CHANNEL}`);
  console.log(`⏰ Retention: Signals ${RETENTION.signals/DAY_MS}d, Tokens ${RETENTION.tokens/DAY_MS}d`);
  console.log(`👛 Wallet retention: Score≥${RETENTION.wallets.threshold} → ${RETENTION.wallets.highScore/DAY_MS}d, else ${RETENTION.wallets.lowScore/DAY_MS}d\n`);

  const db = new TelegramDBv3(BOT_TOKEN, CHANNELS_SOL);

  try {
    // ========================================
    // STEP 1: Initialize Index
    // ========================================
    console.log('━━━ Step 1: Initialize Index ━━━');
    const indexKey = Keys.index();
    const index = createIndex(501);
    await db.store('index', `sol_${indexKey}`, index);
    console.log(`✅ Created index`);
    await sleep(300);

    // ========================================
    // STEP 2: Process Signal 1
    // ========================================
    console.log('\n━━━ Step 2: Process Signal 1 (ALPHA, 3 wallets) ━━━');
    await processSignal(db, signal1, wallets1);
    await sleep(300);

    // ========================================
    // STEP 3: Process Signal 2 (same token!)
    // ========================================
    console.log('\n━━━ Step 3: Process Signal 2 (ALPHA repeat, 2.5x from sig1) ━━━');
    await processSignal(db, signal2, wallets2);
    await sleep(300);

    // ========================================
    // STEP 4: Process Signal 3 (different token)
    // ========================================
    console.log('\n━━━ Step 4: Process Signal 3 (BETA, new token) ━━━');
    await processSignal(db, signal3, wallets3);
    await sleep(300);

    // ========================================
    // STEP 5: Simulate price updates (as if from cron)
    // ========================================
    console.log('\n━━━ Step 5: Price Update Simulation ━━━');
    await simulatePriceUpdates(db);
    await sleep(300);

    // ========================================
    // STEP 6: Update Index with aggregates
    // ========================================
    console.log('\n━━━ Step 6: Update Index Aggregates ━━━');
    await updateIndexAggregates(db);
    await sleep(300);

    // ========================================
    // STEP 7: Query Insights
    // ========================================
    console.log('\n━━━ Step 7: Query Insights ━━━');
    await queryInsights(db);

    // ========================================
    // STATS
    // ========================================
    console.log('\n━━━ Final Stats ━━━');
    const stats = db.stats();
    console.log(`   Index:   ${stats.index.cached} records`);
    console.log(`   Signals: ${stats.signals.cached} records`);
    console.log(`   Tokens:  ${stats.tokens.cached} records`);
    console.log(`   Wallets: ${stats.wallets.cached} records`);

    console.log('\n✅ All tests complete! Check Telegram channels.');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
  }
}

// ============================================================
// HELPER: Process a signal (updates all related records)
// ============================================================

async function processSignal(db, signal, wallets) {
  const avgScore = round(wallets.reduce((s, w) => s + w.entryScore, 0) / wallets.length, 2);
  
  // 1. Store signal record
  const sigKey = `sol_${Keys.signal(signal.batchId, signal.batchIndex)}`;
  const sigRecord = createSignal(signal, wallets, avgScore);
  await db.store('signals', sigKey, sigRecord);
  console.log(`   ✅ Signal: ${signal.tokenSymbol} | Score: ${avgScore} | Wallets: ${wallets.length}`);
  await sleep(200);

  // 2. Upsert token record
  const tokKey = `sol_${Keys.token(signal.tokenAddress)}`;
  let tokRecord = db.get('tokens', tokKey);
  
  if (tokRecord) {
    // Update existing token
    tokRecord.scnt += 1;
    tokRecord.sigs.push([signal.eventTime, parseFloat(signal.priceAtSignal), avgScore, null]);
    if (tokRecord.sigs.length > 20) tokRecord.sigs.shift(); // Keep last 20
    
    // Add new wallets
    for (const w of wallets) {
      const prefix = w.walletAddress.slice(0, 8);
      if (!tokRecord.wals.includes(prefix)) {
        tokRecord.wals.push(prefix);
        if (tokRecord.wals.length > 50) tokRecord.wals.shift();
      }
    }
    
    tokRecord.avgScr = updateAvg(tokRecord.avgScr, tokRecord.scnt - 1, avgScore);
    await db.update('tokens', tokKey, tokRecord);
    console.log(`   ✅ Token updated: ${signal.tokenSymbol} | Signals: ${tokRecord.scnt}`);
  } else {
    // Create new token
    tokRecord = createToken(signal.chainId, signal.tokenAddress, signal.tokenSymbol);
    tokRecord.scnt = 1;
    tokRecord.p0 = parseFloat(signal.priceAtSignal);
    tokRecord.sigs.push([signal.eventTime, parseFloat(signal.priceAtSignal), avgScore, null]);
    tokRecord.wals = wallets.map(w => w.walletAddress.slice(0, 8));
    tokRecord.avgScr = avgScore;
    await db.store('tokens', tokKey, tokRecord);
    console.log(`   ✅ Token created: ${signal.tokenSymbol}`);
  }
  await sleep(200);

  // 3. Upsert wallet records
  for (const w of wallets) {
    const walKey = `sol_${Keys.wallet(w.walletAddress)}`;
    let walRecord = db.get('wallets', walKey);
    
    if (walRecord) {
      // Update existing wallet
      walRecord.scnt += 1;
      walRecord.last = Date.now();
      walRecord.avgScr = updateAvg(walRecord.avgScr, walRecord.scnt - 1, w.entryScore);
      walRecord.scrs.push(w.entryScore);
      if (walRecord.scrs.length > 10) walRecord.scrs.shift();
      walRecord.toks.push([signal.tokenAddress.slice(0, 8), signal.eventTime, parseFloat(signal.priceAtSignal), null]);
      if (walRecord.toks.length > 20) walRecord.toks.shift();
      walRecord.consistency = calcConsistency(walRecord.scrs);
      await db.update('wallets', walKey, walRecord);
      console.log(`   ✅ Wallet updated: ${w.walletAddress.slice(0, 8)}... | Signals: ${walRecord.scnt} | AvgScore: ${walRecord.avgScr}`);
    } else {
      // Create new wallet
      walRecord = createWallet(signal.chainId, w.walletAddress);
      walRecord.scnt = 1;
      walRecord.avgScr = w.entryScore;
      walRecord.scrs.push(w.entryScore);
      walRecord.toks.push([signal.tokenAddress.slice(0, 8), signal.eventTime, parseFloat(signal.priceAtSignal), null]);
      walRecord.consistency = 100;
      await db.store('wallets', walKey, walRecord);
      console.log(`   ✅ Wallet created: ${w.walletAddress.slice(0, 8)}... | Score: ${w.entryScore}`);
    }
    await sleep(150);
  }
}

// ============================================================
// HELPER: Simulate price updates (cron job would do this)
// ============================================================

async function simulatePriceUpdates(db) {
  // Simulate: ALPHA went 3x, BETA went 0.8x
  const priceUpdates = {
    'ALPHA': { current: 0.00003000, high: 0.00003500 }, // 3x from first signal
    'BETA': { current: 0.00004000, high: 0.00005500 },  // 0.8x (down 20%)
  };

  for (const [key, record] of db.cache.signals.entries()) {
    const prices = priceUpdates[record.sym];
    if (prices) {
      record.pxNow = prices.current;
      record.pxHigh = prices.high;
      record.mult = calcMultiplier(record.p0, prices.current);
      record.outcome = determineOutcome(record.p0, prices.high, prices.current);
      await db.update('signals', key, record);
      console.log(`   📈 ${record.sym}: Entry $${record.p0} → Now $${record.pxNow} (${record.mult}x) [${record.outcome}]`);
    }
    await sleep(200);
  }

  // Update token records with outcomes
  for (const [key, record] of db.cache.tokens.entries()) {
    const prices = priceUpdates[record.sym];
    if (prices) {
      record.pHigh = prices.high;
      // Update win rate based on signal outcomes
      let wins = 0, losses = 0;
      for (const sig of record.sigs) {
        const entryPrice = sig[1];
        const outcome = determineOutcome(entryPrice, prices.high, prices.current);
        sig[3] = outcome; // Update outcome in array
        if (outcome === 'win') wins++;
        if (outcome === 'loss') losses++;
      }
      record.winRate = updateWinRate(wins, losses);
      await db.update('tokens', key, record);
      console.log(`   📊 Token ${record.sym}: WinRate ${record.winRate}%`);
    }
    await sleep(200);
  }
}

// ============================================================
// HELPER: Update index with top performers
// ============================================================

async function updateIndexAggregates(db) {
  const indexKey = `sol_${Keys.index()}`;
  const index = db.get('index', indexKey) || createIndex(501);

  // Collect wallet stats
  const walletStats = [];
  for (const [key, record] of db.cache.wallets.entries()) {
    walletStats.push({
      addr: record.addr.slice(0, 12),
      avgScr: record.avgScr,
      scnt: record.scnt,
      consistency: record.consistency,
    });
  }

  // Sort by avgScore and take top N
  walletStats.sort((a, b) => b.avgScr - a.avgScr);
  index.topWals = walletStats.slice(0, RETENTION.topWallets).map(w => [w.addr, w.avgScr, w.scnt]);

  // Collect signal stats for dedup and best performers
  index.lastSigs = [];
  index.bestSigs = [];
  for (const [key, record] of db.cache.signals.entries()) {
    index.lastSigs.push(key);
    if (record.mult && record.mult >= 2) {
      index.bestSigs.push([key.split('_')[1], record.sym, record.mult]);
    }
  }
  index.lastSigs = index.lastSigs.slice(-RETENTION.dedupWindow);
  index.bestSigs.sort((a, b) => b[2] - a[2]);
  index.bestSigs = index.bestSigs.slice(0, 10);

  // Update counts
  index.totalSigs = db.cache.signals.size;
  index.totalToks = db.cache.tokens.size;
  index.totalWals = db.cache.wallets.size;

  // Calculate avg signal score
  let totalScore = 0;
  for (const [, record] of db.cache.signals.entries()) {
    totalScore += record.scr;
  }
  index.avgSigScore = round(totalScore / Math.max(1, index.totalSigs), 2);

  await db.update('index', indexKey, index);
  console.log(`   ✅ Index updated:`);
  console.log(`      Signals: ${index.totalSigs}, Tokens: ${index.totalToks}, Wallets: ${index.totalWals}`);
  console.log(`      Top wallet: ${index.topWals[0]?.[0]} (score: ${index.topWals[0]?.[1]})`);
  console.log(`      Best signal: ${index.bestSigs[0]?.[1]} (${index.bestSigs[0]?.[2]}x)`);
}

// ============================================================
// HELPER: Query insights
// ============================================================

async function queryInsights(db) {
  // Token insights
  console.log('\n📊 TOKEN INSIGHTS:');
  for (const [key, record] of db.cache.tokens.entries()) {
    const firstPrice = record.p0;
    const signalCount = record.scnt;
    const walletCount = record.wals.length;
    
    // Calculate price change from first signal
    const currentMult = record.pHigh ? calcMultiplier(firstPrice, record.pHigh) : 'N/A';
    
    console.log(`   ${record.sym}:`);
    console.log(`      First signal: $${firstPrice}`);
    console.log(`      Signal count: ${signalCount}`);
    console.log(`      Unique wallets: ${walletCount}`);
    console.log(`      High multiplier: ${currentMult}x`);
    console.log(`      Avg signal score: ${record.avgScr}`);
    console.log(`      Win rate: ${record.winRate}%`);
  }

  // Wallet insights
  console.log('\n👛 WALLET INSIGHTS (Smart Money):');
  const topWallets = [...db.cache.wallets.entries()]
    .sort((a, b) => b[1].avgScr - a[1].avgScr)
    .slice(0, 3);
  
  for (const [key, record] of topWallets) {
    console.log(`   ${record.addr.slice(0, 12)}...:`);
    console.log(`      Signal appearances: ${record.scnt}`);
    console.log(`      Average score: ${record.avgScr}`);
    console.log(`      Score trend: ${record.scrs.join(' → ')}`);
    console.log(`      Consistency: ${record.consistency}%`);
  }

  // Correlation analysis
  console.log('\n🔗 CORRELATION ANALYSIS:');
  let highScoreWins = 0, highScoreTotal = 0;
  let lowScoreWins = 0, lowScoreTotal = 0;
  
  for (const [, sig] of db.cache.signals.entries()) {
    if (sig.outcome) {
      if (sig.scr >= 1.0) {
        highScoreTotal++;
        if (sig.outcome === 'win') highScoreWins++;
      } else {
        lowScoreTotal++;
        if (sig.outcome === 'win') lowScoreWins++;
      }
    }
  }
  
  const highScoreWinRate = highScoreTotal > 0 ? round((highScoreWins / highScoreTotal) * 100, 1) : 'N/A';
  const lowScoreWinRate = lowScoreTotal > 0 ? round((lowScoreWins / lowScoreTotal) * 100, 1) : 'N/A';
  
  console.log(`   High score signals (≥1.0): ${highScoreWinRate}% win rate (${highScoreWins}/${highScoreTotal})`);
  console.log(`   Lower score signals (<1.0): ${lowScoreWinRate}% win rate (${lowScoreWins}/${lowScoreTotal})`);
}

// ============================================================
// RUN
// ============================================================

runTests();
