/**
 * Signal Pipeline Database Integration v5
 * 
 * Wrapper that integrates TelegramDB v5 (file-based) with the signal pipeline.
 * Drop-in replacement for db-integration.js with same API.
 * 
 * Handles:
 * - Signal storage and tracking
 * - Token aggregation
 * - Wallet aggregation  
 * - Dedup via file-based storage
 */

import {
  TelegramDBv5,
  calcWalletRankScore,
  calcWalletStars,
  CHAIN_IDS,
} from './telegram-db-v5.js';

// Re-export for compatibility
export { CHAIN_IDS };

/**
 * Helper to round numbers
 */
function round(num, decimals = 2) {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Calculate running average
 */
function updateAvg(prevAvg, prevCount, newValue) {
  return (prevAvg * prevCount + newValue) / (prevCount + 1);
}

/**
 * Calculate consistency from score array (0-100)
 */
function calcConsistency(scores) {
  if (!scores || scores.length < 2) return 100;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
  const maxVariance = 16; // -2 to +2 range
  return Math.round(Math.max(0, 100 - (variance / maxVariance) * 100));
}

/**
 * Store a processed signal and update all related records
 */
async function storeSignalData(db, signal, walletDetails, avgScore, security) {
  const results = { signal: false, token: false, wallets: 0, index: false };
  
  try {
    // Generate signal key for dedup
    const sigKey = `${signal.batchId}_${signal.batchIndex}`;
    
    // 1. Add to seen signals (dedup)
    db.addSeenSignal(sigKey);
    results.signal = true;
    console.log(`   💾 Stored signal: ${sigKey}`);

    // 2. Upsert token record
    const tokenAddr = signal.tokenAddress;
    let token = db.getToken(tokenAddr);
    const signalPrice = parseFloat(signal.priceAtSignal);
    
    if (token) {
      // Update existing token
      token.scnt = (token.scnt || 0) + 1;
      token.avgScr = updateAvg(token.avgScr || 0, token.scnt - 1, avgScore);
      token.lastSig = signal.eventTime;
      if (security) token.sec = security.status;
      
      // Track lowest entry price (best entry)
      if (!token.pLow || signalPrice < token.pLow) {
        token.pLow = signalPrice;
      }
      
      // Add new wallets
      if (!token.wallets) token.wallets = [];
      for (const w of walletDetails) {
        const prefix = w.walletAddress.slice(0, 8);
        if (!token.wallets.includes(prefix)) {
          token.wallets.push(prefix);
          if (token.wallets.length > 50) token.wallets.shift();
        }
      }
      
      db.updateToken(tokenAddr, token);
      console.log(`   💾 Updated token: ${signal.tokenSymbol} (signals: ${token.scnt})`);
    } else {
      // Create new token
      token = {
        sym: signal.tokenSymbol,
        p0: signalPrice,
        pNow: signalPrice,
        pPeak: signalPrice,
        pLow: signalPrice,
        mult: 1,
        peakMult: 1,
        scnt: 1,
        avgScr: avgScore,
        firstSeen: Date.now(),
        lastSig: signal.eventTime,
        lastMsgId: null,
        rugged: false,
        wallets: walletDetails.map(w => w.walletAddress.slice(0, 8)),
        sec: security ? security.status : undefined,
      };
      db.updateToken(tokenAddr, token);
      console.log(`   💾 Created token: ${signal.tokenSymbol}`);
    }
    
    results.tokenData = {
      addr: tokenAddr,
      sym: signal.tokenSymbol,
      p0: token.p0,
      pLow: token.pLow,
      pPeak: token.pPeak,
      scnt: token.scnt,
      avgScr: token.avgScr,
      lastSig: signal.eventTime,
    };
    results.token = true;

    // 3. Upsert wallet records
    for (const w of walletDetails) {
      const walletAddr = w.walletAddress;
      let wallet = db.getWallet(walletAddr);
      const entryScore = w.entryScore || 0;
      
      if (wallet) {
        // Update existing wallet
        wallet.scnt = (wallet.scnt || 0) + 1;
        wallet.lastSeen = Date.now();
        wallet.avgScr = updateAvg(wallet.avgScr || 0, wallet.scnt - 1, entryScore);
        
        // Track scores for consistency
        if (!wallet.scores) wallet.scores = [];
        wallet.scores.push(entryScore);
        if (wallet.scores.length > 10) wallet.scores.shift();
        wallet.consistency = calcConsistency(wallet.scores);
        
        // Track tokens (for win rate calculation)
        if (!wallet.tokens) wallet.tokens = {};
        wallet.tokens[tokenAddr] = {
          entry: signalPrice,
          score: entryScore,
          time: signal.eventTime,
        };
        
        db.updateWallet(walletAddr, wallet);
      } else {
        // Create new wallet
        wallet = {
          scnt: 1,
          avgScr: entryScore,
          consistency: 100,
          lastSeen: Date.now(),
          tags: w.tags || [],
          scores: [entryScore],
          tokens: {
            [tokenAddr]: {
              entry: signalPrice,
              score: entryScore,
              time: signal.eventTime,
            },
          },
        };
        db.updateWallet(walletAddr, wallet);
      }
      results.wallets++;
    }

    // 4. Add recent signal for display
    db.addRecentSignal({
      id: sigKey,
      token: tokenAddr,
      sym: signal.tokenSymbol,
      time: signal.eventTime,
      price: signalPrice,
      avgScr: avgScore,
      msgId: null, // Updated after posting
    });
    
    results.index = true;
    console.log(`   💾 Updated index: ${Object.keys(db.getAllTokens()).length} tokens`);

  } catch (err) {
    console.error(`   ⚠️ DB storage error: ${err.message}`);
  }

  return results;
}

/**
 * Update the Telegram message ID for a token after posting
 * @param {boolean} isPublic - If true, stores as publicMsgId instead of lastMsgId
 */
async function updateTokenMsgId(db, tokenAddress, msgId, isPublic = false) {
  const token = db.getToken(tokenAddress);
  if (token) {
    if (isPublic) {
      token.publicMsgId = msgId;
    } else {
      token.lastMsgId = msgId;
    }
    db.updateToken(tokenAddress, token);
    console.log(`   💾 Stored ${isPublic ? 'public' : 'private'} msgId ${msgId} for ${token.sym}`);
  }
  
  // Also update recent signal
  const signals = db.getRecentSignals();
  const recent = signals.find(s => s.token === tokenAddress && !s.msgId);
  if (recent) {
    if (isPublic) {
      recent.publicMsgId = msgId;
    } else {
      recent.msgId = msgId;
    }
    db.isDirty = true;
  }
}

/**
 * Update token security status (e.g. if it becomes SCAM later)
 */
function updateTokenSecurity(db, tokenAddress, status) {
  const token = db.getToken(tokenAddress);
  if (token) {
    token.sec = status;
    if (status === 'SCAM') token.rugged = true;
    db.updateToken(tokenAddress, token);
    console.log(`   💾 Updated security for ${token.sym}: ${status}`);
  }
}

/**
 * Get the last message ID for a token (for reply chaining)
 * @param {boolean} isPublic - If true, returns publicMsgId instead of lastMsgId
 */
function getTokenLastMsgId(db, tokenAddress, isPublic = false) {
  const token = db.getToken(tokenAddress);
  return isPublic ? (token?.publicMsgId || null) : (token?.lastMsgId || null);
}

/**
 * Check if a signal has been seen before
 */
function isSignalSeen(db, batchId, batchIndex) {
  const sigKey = `${batchId}_${batchIndex}`;
  return db.isSignalSeen(sigKey);
}

/**
 * Get token info for enhanced signal message
 */
function getTokenEnhancement(db, tokenAddress) {
  const token = db.getToken(tokenAddress);
  if (!token) return null;
  
  return {
    signalCount: token.scnt,
    firstPrice: token.p0,
    avgScore: token.avgScr,
    walletCount: token.wallets?.length || 0,
    walletPrefixes: token.wallets || [],
    security: token.sec,
  };
}

/**
 * Identify which wallets are new vs repeat buyers for a token
 */
function categorizeWallets(db, tokenAddress, walletDetails) {
  const token = db.getToken(tokenAddress);
  const existingPrefixes = new Set(token?.wallets || []);
  
  const newWallets = [];
  const repeatWallets = [];
  
  for (const w of walletDetails) {
    const prefix = w.walletAddress.slice(0, 8);
    if (existingPrefixes.has(prefix)) {
      repeatWallets.push(w);
    } else {
      newWallets.push(w);
    }
  }
  
  const totalUnique = existingPrefixes.size + newWallets.length;
  
  return { newWallets, repeatWallets, totalUnique };
}

/**
 * Get wallet info for enhanced signal message
 */
function getWalletEnhancement(db, walletAddress) {
  const wallet = db.getWallet(walletAddress);
  if (!wallet) return null;
  
  return {
    signalCount: wallet.scnt,
    avgScore: wallet.avgScr,
    consistency: wallet.consistency,
    winRate: wallet.winRate,
  };
}

/**
 * Calculate wallet reputation based on historical performance
 */
function getWalletReputation(db, walletAddress) {
  const wallet = db.getWallet(walletAddress);
  
  if (!wallet || !wallet.tokens || Object.keys(wallet.tokens).length === 0) {
    return { winRate: 0, avgPeak: 0, totalEntries: 0, wins: 0, stars: 0, isNew: true };
  }
  
  const tokenPeaks = db.getTokenPeaks();
  
  let wins = 0;
  let totalPeak = 0;
  let counted = 0;
  
  for (const [tokenAddr, entry] of Object.entries(wallet.tokens)) {
    const peakMult = tokenPeaks[tokenAddr];
    if (peakMult && peakMult > 0) {
      counted++;
      totalPeak += peakMult;
      if (peakMult >= 1.5) wins++;
    }
  }
  
  if (counted === 0) {
    return { winRate: 0, avgPeak: 0, totalEntries: Object.keys(wallet.tokens).length, wins: 0, stars: 0, isNew: true };
  }
  
  const winRate = (wins / counted) * 100;
  const avgPeak = totalPeak / counted;
  
  // Calculate star rating
  const stars = calcWalletStars(wallet, tokenPeaks);
  
  return {
    winRate: Math.round(winRate),
    avgPeak: round(avgPeak, 2),
    totalEntries: Object.keys(wallet.tokens).length,
    wins,
    stars,
    isNew: false,
  };
}

/**
 * Initialize DB and load from Telegram file
 */
async function initializeDB(botToken, chainId) {
  const db = new TelegramDBv5(botToken, chainId);
  await db.load();
  return db;
}

/**
 * Get seen signal keys from DB (for dedup)
 */
function getSeenSignalsFromDB(db) {
  if (!db) return new Set();
  return db.getSeenSignals();
}

/**
 * Save DB after updates (called at end of poll cycle)
 */
async function saveDB(db) {
  if (!db) return;
  await db.save();
}

/**
 * Pin is handled automatically by v5 on first save
 */
async function pinIndexAfterUpdate(db) {
  // No-op for v5, pinning handled in save()
}

export {
  storeSignalData,
  updateTokenMsgId,
  updateTokenSecurity,
  getTokenLastMsgId,
  isSignalSeen,
  getTokenEnhancement,
  getWalletEnhancement,
  getWalletReputation,
  categorizeWallets,
  initializeDB,
  getSeenSignalsFromDB,
  saveDB,
  pinIndexAfterUpdate,
};
