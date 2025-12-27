
import { TelegramDBv5, LeaderboardManager, CHAIN_IDS } from '../lib/telegram-db-v5.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function resetLeaderboards() {
  console.log('🗑️ Resetting Leaderboards...');
  
  if (!BOT_TOKEN) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }

  const manager = new LeaderboardManager(BOT_TOKEN);
  
  // Load current config
  await manager.loadConfig();
  
  // Unpin old messages
  console.log('   📌 Unpinning old messages...');
  await manager.unpinOldLeaderboards();
  
  // Reset config
  console.log('   🔄 Clearing config...');
  manager.config = {
    leaderboards: {},
    summaries: { private: null, public: null },
    updatedAt: Date.now(),
  };
  
  // Save empty config
  await manager.saveConfig();
  
  console.log('   ✅ Config reset. Triggering update...');
  
  // Trigger update
  const dbs = {};
  const chains = ['sol', 'eth', 'bsc', 'base'];
  
  for (const chain of chains) {
    console.log(`   📂 Loading ${chain.toUpperCase()} database...`);
    const chainId = CHAIN_IDS[chain];
    const db = new TelegramDBv5(BOT_TOKEN, chainId);
    await db.load();
    dbs[chain] = db;
  }
  
  await manager.updateAll(dbs);
  
  console.log('   ✅ Leaderboards recreated!');
}

resetLeaderboards().catch(console.error);
