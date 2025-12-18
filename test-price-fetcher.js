/**
 * Test Price Fetcher and Update Prices
 */

import { getTokenPrice, getTokenPrices } from './lib/price-fetcher.js';

async function testPriceFetcher() {
  console.log('🧪 Testing Price Fetcher\n');
  
  // Test 1: Single token (Wrapped SOL)
  console.log('📋 Test 1: Single token price (WSOL)');
  const wsolPrice = await getTokenPrice(501, 'So11111111111111111111111111111111111111112');
  console.log('   Result:', wsolPrice);
  
  // Test 2: Batch prices
  console.log('\n📋 Test 2: Batch prices (WSOL, USDC)');
  const tokens = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  ];
  const batchPrices = await getTokenPrices(501, tokens);
  console.log('   Results:', batchPrices);
  
  // Test 3: Random meme token
  console.log('\n📋 Test 3: Meme token (if available in DexScreener)');
  // Use a recent token address from the signals
  const memePrice = await getTokenPrice(501, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'); // BONK
  console.log('   BONK price:', memePrice);
  
  console.log('\n✅ Price fetcher tests complete!');
}

testPriceFetcher().catch(console.error);
