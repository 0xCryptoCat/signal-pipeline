/**
 * Test Update Prices - Check signal performance
 */

import { getTokenPrice } from './lib/price-fetcher.js';
import { TelegramDBv4, Keys } from './lib/telegram-db-v4.js';

const BOT_TOKEN = '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';

// DINOSOL token from the signal
const TEST_TOKEN = {
  address: '6wCYEZEBFQC7CHndo7p7KejyM4oGgi5E1Ya1e9eQpump',
  symbol: 'DINO',
  chainId: 501,
};

async function testSignalPerformance() {
  console.log('🧪 Testing Signal Performance Check\n');
  console.log('=' .repeat(60));
  
  // 1. Get current price from DexScreener
  console.log(`\n📋 Fetching current price for ${TEST_TOKEN.symbol}...`);
  const priceData = await getTokenPrice(TEST_TOKEN.chainId, TEST_TOKEN.address);
  
  if (priceData) {
    console.log(`   Price: $${priceData.priceUsd}`);
    console.log(`   24h Change: ${priceData.priceChange24h}%`);
    console.log(`   Liquidity: $${priceData.liquidity?.toLocaleString()}`);
    console.log(`   24h Volume: $${priceData.volume24h?.toLocaleString()}`);
  } else {
    console.log('   ⚠️ Could not fetch price from DexScreener');
  }
  
  // 2. Load index and check if token is tracked
  console.log(`\n📋 Checking DB for tracked token...`);
  const db = new TelegramDBv4(BOT_TOKEN, TEST_TOKEN.chainId);
  await db.loadIndex();
  
  const indexKey = Keys.index();
  const index = db.get('index', indexKey);
  
  if (index) {
    console.log(`   Index loaded: ${index.totalSigs || 0} total signals`);
    console.log(`   Tracked tokens: ${index.trackedTokens?.length || 0}`);
    
    // Find DINO token
    const dinoToken = index.trackedTokens?.find(t => 
      t.addr.toLowerCase() === TEST_TOKEN.address.toLowerCase() ||
      t.sym === TEST_TOKEN.symbol
    );
    
    if (dinoToken) {
      console.log(`\n   ✅ Found ${dinoToken.sym} in tracked tokens:`);
      console.log(`      Entry price: $${dinoToken.p0}`);
      console.log(`      Signal count: ${dinoToken.scnt}`);
      console.log(`      Avg score: ${dinoToken.avgScr}`);
      console.log(`      First seen: ${new Date(dinoToken.firstSeen).toISOString()}`);
      
      if (priceData && dinoToken.p0) {
        const multiplier = priceData.priceUsd / dinoToken.p0;
        const pctGain = (multiplier - 1) * 100;
        console.log(`\n   📊 Performance:`);
        console.log(`      Multiplier: ${multiplier.toFixed(2)}x`);
        console.log(`      Gain: ${pctGain >= 0 ? '+' : ''}${pctGain.toFixed(1)}%`);
        
        if (multiplier >= 2) {
          console.log(`      🚀🌙 MOON! Would post performance update.`);
        } else if (multiplier >= 1.5) {
          console.log(`      🚀 Rocket! Would post performance update.`);
        } else if (multiplier >= 1.25) {
          console.log(`      📈 Good gain! Would post performance update.`);
        } else if (multiplier >= 1) {
          console.log(`      ↗️ Slight gain, not posting yet.`);
        } else {
          console.log(`      📉 Down from entry, no update.`);
        }
      }
    } else {
      console.log(`   ⚠️ Token ${TEST_TOKEN.symbol} not found in tracked tokens`);
      console.log(`   This may be a new signal that hasn't been processed yet.`);
    }
  } else {
    console.log(`   ⚠️ No index found for Solana chain`);
  }
  
  // 3. Show all tracked tokens
  if (index?.trackedTokens?.length > 0) {
    console.log(`\n📋 All tracked tokens:`);
    for (const token of index.trackedTokens.slice(0, 10)) {
      console.log(`   - ${token.sym}: p0=$${token.p0}, scnt=${token.scnt}, score=${token.avgScr?.toFixed(2)}`);
    }
    if (index.trackedTokens.length > 10) {
      console.log(`   ... and ${index.trackedTokens.length - 10} more`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Test complete!');
}

testSignalPerformance().catch(console.error);
