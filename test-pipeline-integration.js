/**
 * Integration Test - Signal Pipeline with DB
 * 
 * Tests the full pipeline: fetch signals → score → post → store to DB
 * Run: node test-pipeline-integration.js
 */

import { monitorSignals } from './index.js';

const BOT_TOKEN = '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';
const CHAT_ID = '-1003474351030'; // Public channel

async function testSolanaWithDB() {
  console.log('🧪 Integration Test: Solana Pipeline with DB\n');
  console.log('=' .repeat(60));
  
  console.log('\n📋 Configuration:');
  console.log('   Chain: Solana (501)');
  console.log('   DB: Enabled');
  console.log('   minScore: -999 (accept all for testing)');
  console.log('   pageSize: 3');
  
  try {
    const result = await monitorSignals({
      chainId: 501,
      trend: '1',
      pageSize: 3,
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      scoreWallets: true,
      minWallets: 1,
      minScore: -999,  // Accept all signals for testing
      seenSignals: new Set(),
      useDB: true,     // Enable DB storage
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Results:');
    console.log(`   New signals: ${result.newSignals}`);
    console.log(`   Skipped by score: ${result.skippedByScore}`);
    console.log(`   Total tracked: ${result.seenSignals.size}`);
    
    console.log('\n✅ Integration test complete!');
    console.log('\n⚠️ Check the private Telegram channels to verify data:');
    console.log('   Solana signals: -1003683149932');
    console.log('   Solana tokens: -1003300774874');
    console.log('   Solana wallets: -1003664436076');
    console.log('   Solana index: -1003359608037');
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
  }
}

testSolanaWithDB();
