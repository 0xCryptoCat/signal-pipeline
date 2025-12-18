/**
 * Cleanup Cron - /api/cleanup
 * 
 * Archives expired records and maintains database health.
 * - Signals: Archive after 7 days
 * - Tokens: Remove from index after 30 days (no signals)
 * - Performance: Clear postedPerf flags for re-alerting
 * 
 * Trigger: External cron ping (e.g., daily at 04:00 UTC)
 */

import { TelegramDBv4, Keys, RETENTION } from '../lib/telegram-db-v4.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// All chains to process
const CHAINS = [
  { id: 501, name: 'Solana', key: 'sol' },
  { id: 1, name: 'Ethereum', key: 'eth' },
  { id: 56, name: 'BSC', key: 'bsc' },
  { id: 8453, name: 'Base', key: 'base' },
];

// Retention periods
const SIGNAL_MAX_AGE = 7 * 24 * 60 * 60 * 1000;   // 7 days
const TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000;   // 30 days
const PERF_RESET_AGE = 24 * 60 * 60 * 1000;       // Reset perf flags after 24h

async function processChain(chain) {
  console.log(`\n🧹 Cleaning ${chain.name}...`);
  
  const db = new TelegramDBv4(BOT_TOKEN, chain.id);
  
  // Load index from pinned message
  await db.loadIndex();
  
  const indexKey = Keys.index();
  const index = db.get('index', indexKey);
  
  if (!index) {
    console.log(`   ℹ️ No index found for ${chain.name}`);
    return { signalsArchived: 0, tokensRemoved: 0, perfReset: 0 };
  }
  
  const now = Date.now();
  let signalsArchived = 0;
  let tokensRemoved = 0;
  let perfReset = 0;
  let indexModified = false;
  
  // 1. Clean up old signals from lastSigs (just remove from dedup list)
  if (index.lastSigs && index.lastSigs.length > 0) {
    const originalCount = index.lastSigs.length;
    // Keep only last 100 signals for dedup (already enforced, but trim old ones)
    if (index.lastSigs.length > 100) {
      index.lastSigs = index.lastSigs.slice(-100);
      signalsArchived = originalCount - index.lastSigs.length;
      indexModified = true;
    }
  }
  
  // 2. Clean up old tokens from trackedTokens
  if (index.trackedTokens && index.trackedTokens.length > 0) {
    const originalCount = index.trackedTokens.length;
    
    index.trackedTokens = index.trackedTokens.filter(token => {
      const age = now - (token.lastSig || token.firstSeen || 0);
      
      // Reset perf flags for tokens older than 24h (allow re-alerting on new pumps)
      if (token.postedPerf && age > PERF_RESET_AGE) {
        delete token.postedPerf;
        perfReset++;
        indexModified = true;
      }
      
      // Keep token if it's recent enough
      if (age < TOKEN_MAX_AGE) {
        return true;
      }
      
      // Token is too old, remove from tracking
      console.log(`   🗑️ Removing old token: ${token.sym} (${Math.floor(age / 86400000)}d old)`);
      return false;
    });
    
    tokensRemoved = originalCount - index.trackedTokens.length;
    if (tokensRemoved > 0) {
      indexModified = true;
    }
  }
  
  // 3. Update stats
  if (indexModified) {
    index.lastCleanup = now;
    index.cleanupStats = {
      signalsArchived,
      tokensRemoved,
      perfReset,
      timestamp: now,
    };
    
    await db.update('index', indexKey, index);
    await db.pinIndex();
  }
  
  console.log(`   ✅ Archived ${signalsArchived} signals, removed ${tokensRemoved} tokens, reset ${perfReset} perf flags`);
  return { signalsArchived, tokensRemoved, perfReset };
}

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🧹 [Cleanup] Starting at ${new Date().toISOString()}`);
  
  if (!BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram config' });
  }
  
  const results = {
    chains: {},
    totalSignalsArchived: 0,
    totalTokensRemoved: 0,
    totalPerfReset: 0,
  };
  
  try {
    for (const chain of CHAINS) {
      const chainResult = await processChain(chain);
      results.chains[chain.name] = chainResult;
      results.totalSignalsArchived += chainResult.signalsArchived;
      results.totalTokensRemoved += chainResult.tokensRemoved;
      results.totalPerfReset += chainResult.perfReset;
      
      // Small delay between chains
      await new Promise(r => setTimeout(r, 200));
    }
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ [Cleanup] Complete in ${duration}ms`);
    
    return res.status(200).json({
      ok: true,
      duration,
      ...results,
    });
    
  } catch (error) {
    console.error('❌ [Cleanup] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
