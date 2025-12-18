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

    // 2. Upsert token record (stored in tokens channel)
    const tokKey = Keys.token(signal.tokenAddress);
    let tokRecord = db.get('tokens', tokKey);
    
    if (tokRecord) {
      // Update existing token
      tokRecord.scnt += 1;
      const signalPrice = parseFloat(signal.priceAtSignal);
      tokRecord.sigs.push([signal.eventTime, signalPrice, avgScore, null]);
      if (tokRecord.sigs.length > 20) tokRecord.sigs.shift();
      
      // Track lowest entry price (best entry for performance calculation)
      if (!tokRecord.pLow || signalPrice < tokRecord.pLow) {
        tokRecord.pLow = signalPrice;
      }
      
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
      const signalPrice = parseFloat(signal.priceAtSignal);
      tokRecord.p0 = signalPrice;
      tokRecord.pLow = signalPrice; // First signal = lowest so far
      tokRecord.sigs.push([signal.eventTime, signalPrice, avgScore, null]);
      tokRecord.wals = walletDetails.map(w => w.walletAddress.slice(0, 8));
      tokRecord.avgScr = avgScore;
      await db.store('tokens', tokKey, tokRecord);
      console.log(`   💾 Created token: ${signal.tokenSymbol}`);
    }
    
    // Store minimal token data for index (needed for price updates without channel scan)
    results.tokenData = {
      addr: signal.tokenAddress,
      sym: signal.tokenSymbol,
      p0: tokRecord.p0,
      pLow: tokRecord.pLow, // Best entry price (lowest signal)
      scnt: tokRecord.scnt,
      avgScr: tokRecord.avgScr,
      lastSig: signal.eventTime,
    };
    
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
      indexRecord.trackedTokens = [];
      await db.store('index', indexKey, indexRecord);
    }
    
    // Add signal to dedup list
    indexRecord.lastSigs.push(sigKey);
    if (indexRecord.lastSigs.length > 100) indexRecord.lastSigs.shift();
    
    // Track token for price updates (with essential data for perf tracking)
    if (!indexRecord.trackedTokens) indexRecord.trackedTokens = [];
    const existingIdx = indexRecord.trackedTokens.findIndex(t => t.addr === signal.tokenAddress);
    
    if (existingIdx >= 0) {
      // Update existing token entry (keep previous msgId for reply chaining)
      const existing = indexRecord.trackedTokens[existingIdx];
      existing.prevMsgId = existing.lastMsgId; // Chain to previous signal
      existing.scnt = results.tokenData?.scnt || (existing.scnt + 1);
      existing.avgScr = results.tokenData?.avgScr || existing.avgScr;
      existing.lastSig = Date.now();
      // Return previous msgId for reply
      results.replyToMsgId = existing.prevMsgId;
    } else {
      // Add new token
      indexRecord.trackedTokens.push({
        addr: signal.tokenAddress,
        sym: signal.tokenSymbol,
        p0: parseFloat(signal.priceAtSignal),
        scnt: 1,
        avgScr: avgScore,
        firstSeen: Date.now(),
        lastSig: Date.now(),
        lastMsgId: null, // Will be set after posting
      });
      // Keep last 50 tokens
      if (indexRecord.trackedTokens.length > 50) {
        indexRecord.trackedTokens.shift();
      }
    }
    
    // Update counts
    indexRecord.totalSigs = (indexRecord.totalSigs || 0) + 1;
    indexRecord.lastUpdate = Date.now();
    
    await db.update('index', indexKey, indexRecord);
    results.index = true;
    console.log(`   💾 Updated index: ${indexRecord.totalSigs} total signals, ${indexRecord.trackedTokens.length} tokens`);

  } catch (err) {
    console.error(`   ⚠️ DB storage error: ${err.message}`);
  }

  return results;
}

/**
 * Update the Telegram message ID for a token after posting
 * This enables reply chaining and performance update replies
 */
async function updateTokenMsgId(db, tokenAddress, msgId) {
  const indexKey = Keys.index();
  const index = db.get('index', indexKey);
  
  if (!index || !index.trackedTokens) return;
  
  const token = index.trackedTokens.find(t => t.addr === tokenAddress);
  if (token) {
    token.lastMsgId = msgId;
    await db.update('index', indexKey, index);
    console.log(`   💾 Stored msgId ${msgId} for ${token.sym}`);
  }
}

/**
 * Get the last message ID for a token (for reply chaining)
 */
function getTokenLastMsgId(db, tokenAddress) {
  const index = db.get('index', Keys.index());
  if (!index || !index.trackedTokens) return null;
  
  const token = index.trackedTokens.find(t => t.addr === tokenAddress);
  return token?.lastMsgId || null;
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
  
  // Load index from pinned message (survives cold starts!)
  await db.loadIndex();
  
  return db;
}

/**
 * Get seen signal keys from DB index (for dedup on cold start)
 */
function getSeenSignalsFromDB(db) {
  if (!db) return new Set();
  return db.getSeenSignals();
}

/**
 * Pin the index after updating (for cold start recovery)
 */
async function pinIndexAfterUpdate(db) {
  if (!db) return;
  await db.pinIndex();
}

export {
  storeSignalData,
  updateTokenMsgId,
  getTokenLastMsgId,
  isSignalSeen,
  getTokenEnhancement,
  getWalletEnhancement,
  initializeDB,
  getSeenSignalsFromDB,
  pinIndexAfterUpdate,
  Keys,
};
