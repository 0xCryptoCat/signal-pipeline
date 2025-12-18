/**
 * Signal Pipeline Database Integration
 * 
 * Wrapper that integrates TelegramDB v4 with the signal pipeline.
 * Handles:
 * - Signal storage and tracking
 * - Token aggregation
 * - Wallet aggregation  
 * - Index updates for dedup
 */

import {
  TelegramDBv4,
  Keys,
  createIndex,
  createSignal,
  createToken,
  createWallet,
  updateAvg,
  updateWinRate,
  calcConsistency,
  round,
  sleep,
} from './telegram-db-v4.js';

/**
 * Store a processed signal and update all related records
 */
async function storeSignalData(db, signal, walletDetails, avgScore) {
  const results = { signal: false, token: false, wallets: 0, index: false };
  
  try {
    // 1. Store signal record
    const sigKey = Keys.signal(signal.batchId, signal.batchIndex);
    const sigRecord = createSignal(signal, walletDetails, avgScore);
    await db.store('signals', sigKey, sigRecord);
    results.signal = true;
    console.log(`   💾 Stored signal: ${sigKey}`);
    await sleep(100);

    // 2. Upsert token record
    const tokKey = Keys.token(signal.tokenAddress);
    let tokRecord = db.get('tokens', tokKey);
    
    if (tokRecord) {
      // Update existing token
      tokRecord.scnt += 1;
      tokRecord.sigs.push([signal.eventTime, parseFloat(signal.priceAtSignal), avgScore, null]);
      if (tokRecord.sigs.length > 20) tokRecord.sigs.shift();
      
      // Add new wallets
      for (const w of walletDetails) {
        const prefix = w.walletAddress.slice(0, 8);
        if (!tokRecord.wals.includes(prefix)) {
          tokRecord.wals.push(prefix);
          if (tokRecord.wals.length > 50) tokRecord.wals.shift();
        }
      }
      
      tokRecord.avgScr = updateAvg(tokRecord.avgScr, tokRecord.scnt - 1, avgScore);
      await db.update('tokens', tokKey, tokRecord);
      console.log(`   💾 Updated token: ${signal.tokenSymbol} (signals: ${tokRecord.scnt})`);
    } else {
      // Create new token
      tokRecord = createToken(signal.chainId, signal.tokenAddress, signal.tokenSymbol);
      tokRecord.scnt = 1;
      tokRecord.p0 = parseFloat(signal.priceAtSignal);
      tokRecord.sigs.push([signal.eventTime, parseFloat(signal.priceAtSignal), avgScore, null]);
      tokRecord.wals = walletDetails.map(w => w.walletAddress.slice(0, 8));
      tokRecord.avgScr = avgScore;
      await db.store('tokens', tokKey, tokRecord);
      console.log(`   💾 Created token: ${signal.tokenSymbol}`);
    }
    results.token = true;
    await sleep(100);

    // 3. Upsert wallet records
    for (const w of walletDetails) {
      const walKey = Keys.wallet(w.walletAddress);
      let walRecord = db.get('wallets', walKey);
      
      if (walRecord) {
        // Update existing wallet
        walRecord.scnt += 1;
        walRecord.last = Date.now();
        walRecord.avgScr = updateAvg(walRecord.avgScr, walRecord.scnt - 1, w.entryScore || 0);
        walRecord.scrs.push(w.entryScore || 0);
        if (walRecord.scrs.length > 10) walRecord.scrs.shift();
        walRecord.toks.push([
          signal.tokenAddress.slice(0, 8),
          signal.eventTime,
          parseFloat(signal.priceAtSignal),
          null
        ]);
        if (walRecord.toks.length > 20) walRecord.toks.shift();
        walRecord.consistency = calcConsistency(walRecord.scrs);
        await db.update('wallets', walKey, walRecord);
      } else {
        // Create new wallet
        walRecord = createWallet(signal.chainId, w.walletAddress);
        walRecord.scnt = 1;
        walRecord.avgScr = w.entryScore || 0;
        walRecord.scrs.push(w.entryScore || 0);
        walRecord.toks.push([
          signal.tokenAddress.slice(0, 8),
          signal.eventTime,
          parseFloat(signal.priceAtSignal),
          null
        ]);
        walRecord.consistency = 100;
        await db.store('wallets', walKey, walRecord);
      }
      results.wallets++;
      await sleep(50);
    }

    // 4. Update index
    const indexKey = Keys.index();
    let indexRecord = db.get('index', indexKey);
    
    if (!indexRecord) {
      indexRecord = createIndex(signal.chainId);
      await db.store('index', indexKey, indexRecord);
    }
    
    // Add signal to dedup list
    indexRecord.lastSigs.push(sigKey);
    if (indexRecord.lastSigs.length > 100) indexRecord.lastSigs.shift();
    
    // Update counts
    indexRecord.totalSigs = (indexRecord.totalSigs || 0) + 1;
    indexRecord.lastUpdate = Date.now();
    
    await db.update('index', indexKey, indexRecord);
    results.index = true;
    console.log(`   💾 Updated index: ${indexRecord.totalSigs} total signals`);

  } catch (err) {
    console.error(`   ⚠️ DB storage error: ${err.message}`);
  }

  return results;
}

/**
 * Check if a signal has been seen before (via index)
 */
function isSignalSeen(db, batchId, batchIndex) {
  const sigKey = Keys.signal(batchId, batchIndex);
  const index = db.get('index', Keys.index());
  
  if (!index) return false;
  return index.lastSigs?.includes(sigKey) || false;
}

/**
 * Get token info for enhanced signal message
 */
function getTokenEnhancement(db, tokenAddress) {
  const tokKey = Keys.token(tokenAddress);
  const tokRecord = db.get('tokens', tokKey);
  
  if (!tokRecord) return null;
  
  return {
    signalCount: tokRecord.scnt,
    firstPrice: tokRecord.p0,
    avgScore: tokRecord.avgScr,
    walletCount: tokRecord.wals?.length || 0,
  };
}

/**
 * Get wallet info for enhanced signal message
 */
function getWalletEnhancement(db, walletAddress) {
  const walKey = Keys.wallet(walletAddress);
  const walRecord = db.get('wallets', walKey);
  
  if (!walRecord) return null;
  
  return {
    signalCount: walRecord.scnt,
    avgScore: walRecord.avgScr,
    consistency: walRecord.consistency,
    winRate: walRecord.winRate,
  };
}

/**
 * Initialize DB and load index for dedup
 */
async function initializeDB(botToken, chainId) {
  const db = new TelegramDBv4(botToken, chainId);
  
  // Try to load index (won't work on cold start, but that's ok)
  // The index will be created on first signal
  
  return db;
}

export {
  storeSignalData,
  isSignalSeen,
  getTokenEnhancement,
  getWalletEnhancement,
  initializeDB,
  Keys,
};
