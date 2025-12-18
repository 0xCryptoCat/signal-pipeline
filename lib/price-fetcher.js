/**
 * Price Fetcher Utility
 * 
 * Fetches current token prices from DexScreener API (free, no auth required)
 */

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens/';

const CHAIN_MAP = {
  501: 'solana',
  1: 'ethereum',
  56: 'bsc',
  8453: 'base',
};

/**
 * Get current price for a token from DexScreener
 * Returns { priceUsd, priceChange24h, liquidity, volume24h } or null
 */
async function getTokenPrice(chainId, tokenAddress) {
  try {
    const res = await fetch(`${DEXSCREENER_API}${tokenAddress}`);
    if (!res.ok) return null;
    
    const data = await res.json();
    
    if (!data.pairs || data.pairs.length === 0) return null;
    
    // Find the pair with highest liquidity on the correct chain
    const chainName = CHAIN_MAP[chainId];
    const chainPairs = data.pairs.filter(p => p.chainId === chainName);
    
    if (chainPairs.length === 0) return null;
    
    // Sort by liquidity, take the best one
    const bestPair = chainPairs.sort((a, b) => 
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];
    
    return {
      priceUsd: parseFloat(bestPair.priceUsd) || 0,
      priceChange24h: parseFloat(bestPair.priceChange?.h24) || 0,
      liquidity: bestPair.liquidity?.usd || 0,
      volume24h: bestPair.volume?.h24 || 0,
      pairAddress: bestPair.pairAddress,
      dexId: bestPair.dexId,
    };
  } catch (err) {
    console.log(`   ⚠️ Price fetch failed for ${tokenAddress}: ${err.message}`);
    return null;
  }
}

/**
 * Batch fetch prices for multiple tokens
 * DexScreener allows comma-separated addresses (up to ~30)
 */
async function getTokenPrices(chainId, tokenAddresses) {
  if (tokenAddresses.length === 0) return {};
  
  const results = {};
  
  // DexScreener supports batch requests
  // Split into chunks of 20 to be safe
  const chunks = [];
  for (let i = 0; i < tokenAddresses.length; i += 20) {
    chunks.push(tokenAddresses.slice(i, i + 20));
  }
  
  for (const chunk of chunks) {
    try {
      const addresses = chunk.join(',');
      const res = await fetch(`${DEXSCREENER_API}${addresses}`);
      if (!res.ok) continue;
      
      const data = await res.json();
      if (!data.pairs) continue;
      
      const chainName = CHAIN_MAP[chainId];
      
      // Group pairs by token address
      for (const pair of data.pairs) {
        if (pair.chainId !== chainName) continue;
        
        const tokenAddr = pair.baseToken?.address?.toLowerCase();
        if (!tokenAddr) continue;
        
        // Keep the pair with highest liquidity for each token
        if (!results[tokenAddr] || 
            (pair.liquidity?.usd || 0) > (results[tokenAddr].liquidity || 0)) {
          results[tokenAddr] = {
            priceUsd: parseFloat(pair.priceUsd) || 0,
            priceChange24h: parseFloat(pair.priceChange?.h24) || 0,
            liquidity: pair.liquidity?.usd || 0,
            volume24h: pair.volume?.h24 || 0,
          };
        }
      }
      
      // Small delay between chunks
      if (chunks.length > 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.log(`   ⚠️ Batch price fetch failed: ${err.message}`);
    }
  }
  
  return results;
}

export { getTokenPrice, getTokenPrices, CHAIN_MAP };
