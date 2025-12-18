/**
 * Test Update Prices - Check ALL tracked token performance
 */

import { getTokenPrices } from './lib/price-fetcher.js';
import { TelegramDBv4, Keys } from './lib/telegram-db-v4.js';

const BOT_TOKEN = '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';

async function testAllTokenPerformance() {
  console.log('🧪 Testing All Tracked Token Performance\n');
  console.log('=' .repeat(60));
  
  const db = new TelegramDBv4(BOT_TOKEN, 501); // Solana
  await db.loadIndex();
  
  const indexKey = Keys.index();
  const index = db.get('index', indexKey);
  
  if (!index || !index.trackedTokens || index.trackedTokens.length === 0) {
    console.log('❌ No tracked tokens found');
    return;
  }
  
  console.log(`📋 Found ${index.trackedTokens.length} tracked tokens\n`);
  
  // Get all token addresses
  const addresses = index.trackedTokens.map(t => t.addr);
  
  // Batch fetch prices
  console.log('📋 Fetching current prices...\n');
  const prices = await getTokenPrices(501, addresses);
  
  console.log('📊 Performance Report:\n');
  console.log('Token'.padEnd(12) + 'Entry'.padEnd(14) + 'Now'.padEnd(14) + 'Mult'.padEnd(8) + 'Gain'.padEnd(10) + 'Score');
  console.log('-'.repeat(70));
  
  for (const token of index.trackedTokens) {
    const addr = token.addr.toLowerCase();
    const priceData = prices[addr];
    
    const sym = (token.sym || '???').slice(0, 10).padEnd(12);
    const entryPrice = token.p0 || 0;
    const entry = `$${entryPrice.toPrecision(3)}`.padEnd(14);
    
    if (priceData && priceData.priceUsd > 0 && entryPrice > 0) {
      const now = `$${priceData.priceUsd.toPrecision(3)}`.padEnd(14);
      const mult = priceData.priceUsd / entryPrice;
      const multStr = `${mult.toFixed(2)}x`.padEnd(8);
      const gain = (mult - 1) * 100;
      const gainStr = `${gain >= 0 ? '+' : ''}${gain.toFixed(0)}%`.padEnd(10);
      const score = (token.avgScr || 0).toFixed(2);
      
      const emoji = mult >= 2 ? '🚀🌙' : mult >= 1.5 ? '🚀' : mult >= 1.25 ? '📈' : mult >= 1 ? '↗️' : '📉';
      
      console.log(`${sym}${entry}${now}${multStr}${gainStr}${score} ${emoji}`);
    } else {
      console.log(`${sym}${entry}$??? (no price data)`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Performance check complete!');
}

testAllTokenPerformance().catch(console.error);
