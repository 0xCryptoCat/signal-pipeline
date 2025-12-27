/**
 * Update Leaderboard Cron - /api/update-leaderboard
 * 
 * Recalculates token trending scores and wallet rankings.
 * Updates pinned leaderboard messages in both public and private channels.
 * 
 * Trigger: External cron ping (every 30 minutes)
 * 
 * Query params:
 * - reset=true: Force reset of leaderboard config (recreate all messages)
 * 
 * Flow:
 * 1. Load all chain databases (sol, eth, bsc, base)
 * 2. Calculate trending tokens (all chains combined)
 * 3. Calculate top wallets (7d performance)
 * 4. Edit pinned leaderboard messages (private: full data, public: anonymized)
 * 5. Save leaderboard config to archive channel
 */

import { TelegramDBv5, LeaderboardManager, CHAIN_IDS } from '../lib/telegram-db-v5.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req, res) {
  const forceReset = req.query.reset === 'true';
  console.log(`🏆 Starting leaderboard update...${forceReset ? ' (RESET MODE)' : ''}`);
  const startTime = Date.now();
  
  try {
    // Load all chain databases
    const dbs = {};
    const chains = ['sol', 'eth', 'bsc', 'base'];
    
    for (const chain of chains) {
      console.log(`\n📂 Loading ${chain.toUpperCase()} database...`);
      const chainId = CHAIN_IDS[chain];
      const db = new TelegramDBv5(BOT_TOKEN, chainId);
      await db.load();
      dbs[chain] = db;
    }
    
    // Update leaderboards
    const leaderboardManager = new LeaderboardManager(BOT_TOKEN);
    
    // Force reset if requested - clear config to recreate all messages
    if (forceReset) {
      console.log('   🔄 Resetting leaderboard config...');
      await leaderboardManager.loadConfig();
      await leaderboardManager.unpinOldLeaderboards();
      
      leaderboardManager.config = {
        leaderboards: {},
        summaries: { private: null, public: null },
        updatedAt: Date.now(),
      };
    }
    
    const result = await leaderboardManager.updateAll(dbs);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Leaderboard update complete in ${elapsed}s`);
    console.log(`   Top tokens: ${result.topTokens}`);
    console.log(`   Top wallets: ${result.topWallets}`);
    
    return res.status(200).json({
      success: true,
      elapsed: `${elapsed}s`,
      reset: forceReset,
      topTokens: result.topTokens,
      topWallets: result.topWallets,
    });
    
  } catch (err) {
    console.error('❌ Leaderboard update error:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
