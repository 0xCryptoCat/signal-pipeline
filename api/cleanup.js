/**
 * Cleanup Cron - /api/cleanup
 * 
 * Prunes expired data and maintains database health using v5 file-based storage.
 * - Tokens: Remove after 30 days with no signals
 * - Wallets: Remove low-score wallets not seen in 7 days
 * - Signals: Remove from recentSignals after 7 days
 * 
 * Trigger: External cron ping (e.g., daily at 04:00 UTC)
 */

import { TelegramDBv5, CHAIN_IDS } from '../lib/telegram-db-v5.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// All chains to process
const CHAINS = ['sol', 'eth', 'bsc', 'base'];

async function processChain(chain) {
  console.log(`\n🧹 Cleaning ${chain.toUpperCase()}...`);
  
  const chainId = CHAIN_IDS[chain];
  const db = new TelegramDBv5(BOT_TOKEN, chainId);
  
  // Load database
  await db.load();
  
  if (!db.db) {
    console.log(`   ℹ️ No database found for ${chain}`);
    return { tokens: 0, wallets: 0, signals: 0 };
  }
  
  // Use v5's built-in pruning
  const result = db.pruneOldData(30);
  
  console.log(`   📊 Pruned: ${result.tokens} tokens, ${result.wallets} wallets, ${result.signals} signals`);
  
  // Save if changes were made
  if (result.tokens > 0 || result.wallets > 0 || result.signals > 0) {
    await db.save();
  }
  
  return result;
}

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log(`\n🧹 [Cleanup] Starting at ${new Date().toISOString()}`);
  
  if (!BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram config' });
  }
  
  const results = {
    chains: {},
    totalTokens: 0,
    totalWallets: 0,
    totalSignals: 0,
  };
  
  try {
    for (const chain of CHAINS) {
      const chainResult = await processChain(chain);
      results.chains[chain] = chainResult;
      results.totalTokens += chainResult.tokens || 0;
      results.totalWallets += chainResult.wallets || 0;
      results.totalSignals += chainResult.signals || 0;
      
      // Small delay between chains
      await new Promise(r => setTimeout(r, 200));
    }
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ [Cleanup] Complete in ${duration}ms`);
    
    return res.status(200).json({
      ok: true,
      duration,
      pruned: {
        tokens: results.totalTokens,
        wallets: results.totalWallets,
        signals: results.totalSignals,
      },
      chains: results.chains,
    });
    
  } catch (error) {
    console.error('❌ [Cleanup] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
