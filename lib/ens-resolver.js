/**
 * ENS Resolver for Ethereum Wallets
 * 
 * Resolves Ethereum addresses to their primary ENS names.
 * Uses ensdata.net public API (returns primary/reverse record).
 * 
 * Only applies to ETH chain (chainId 1).
 */

// In-memory cache to avoid repeated lookups
// ENS names rarely change, so we cache aggressively
const ensCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Resolve an Ethereum address to its primary ENS name
 * @param {string} address - Ethereum address (0x...)
 * @returns {Promise<string|null>} - ENS name or null if not found
 */
export async function resolveENS(address) {
  if (!address || !address.startsWith('0x')) {
    return null;
  }
  
  const lowerAddr = address.toLowerCase();
  
  // Check cache first
  const cached = ensCache.get(lowerAddr);
  if (cached) {
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.ens;
    }
    // Cache expired, remove it
    ensCache.delete(lowerAddr);
  }
  
  try {
    const res = await fetch(`https://ensdata.net/${address}`, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!res.ok) {
      // Cache the "not found" result too
      ensCache.set(lowerAddr, { ens: null, timestamp: Date.now() });
      return null;
    }
    
    const data = await res.json();
    const ens = data.ens || data.name || null;
    
    // Cache the result
    ensCache.set(lowerAddr, { ens, timestamp: Date.now() });
    
    return ens;
  } catch (e) {
    console.error(`ENS resolution error for ${address.slice(0, 10)}...: ${e.message}`);
    return null;
  }
}

/**
 * Batch resolve multiple addresses to ENS names
 * @param {string[]} addresses - Array of Ethereum addresses
 * @returns {Promise<Map<string, string|null>>} - Map of address -> ENS name
 */
export async function batchResolveENS(addresses) {
  const results = new Map();
  
  // Filter to only uncached addresses
  const toFetch = addresses.filter(addr => {
    const lowerAddr = addr.toLowerCase();
    const cached = ensCache.get(lowerAddr);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      results.set(addr, cached.ens);
      return false;
    }
    return true;
  });
  
  // Fetch remaining in parallel (with limit to avoid rate limiting)
  const BATCH_SIZE = 5;
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (addr) => {
      const ens = await resolveENS(addr);
      results.set(addr, ens);
    });
    await Promise.all(promises);
  }
  
  return results;
}

/**
 * Get display name for a wallet (ENS if available, otherwise short address)
 * @param {string} address - Wallet address
 * @param {string|null} ensName - Pre-resolved ENS name (optional)
 * @returns {string} - Display name
 */
export function getDisplayName(address, ensName = null) {
  if (ensName) {
    return ensName;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Clear the ENS cache (useful for testing)
 */
export function clearENSCache() {
  ensCache.clear();
}

export default { resolveENS, batchResolveENS, getDisplayName, clearENSCache };
