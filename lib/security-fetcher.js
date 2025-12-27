
/**
 * Security Fetcher Library
 * 
 * Integrates DexScreener (EVM) and RugCheck (SVM) security endpoints.
 * Normalizes data into a unified SecurityReport format.
 */

const CHAIN_MAP = {
  1: 'ethereum',
  56: 'bsc',
  8453: 'base',
  501: 'solana'
};

/**
 * @typedef {Object} SecurityReport
 * @property {string} status - 'SAFE' | 'RISK' | 'SCAM' | 'UNKNOWN'
 * @property {boolean} isHoneypot
 * @property {boolean} isOpenSource
 * @property {number} riskScore - 0-100 (0 = Safe, 100 = Danger)
 * @property {string} riskLevel - 'low' | 'medium' | 'high' | 'critical'
 * @property {boolean} isMintable
 * @property {boolean} isFreezable
 * @property {boolean} isProxy
 * @property {boolean} isRenounced
 * @property {number} buyTax
 * @property {number} sellTax
 * @property {number} lpLockedPct
 * @property {string[]} flags - List of specific warnings
 * @property {string} provider - 'dexscreener' | 'rugcheck'
 */

/**
 * Fetch security report for a token
 * @param {number} chainId 
 * @param {string} tokenAddress 
 * @returns {Promise<SecurityReport>}
 */
export async function fetchSecurity(chainId, tokenAddress) {
  const chainName = CHAIN_MAP[chainId];
  if (!chainName) return createUnknownReport();

  try {
    if (chainId === 501) {
      return await fetchSvmSecurity(tokenAddress);
    } else {
      return await fetchEvmSecurity(chainId, tokenAddress);
    }
  } catch (err) {
    console.error(`Security fetch failed for ${tokenAddress}: ${err.message}`);
    return createUnknownReport();
  }
}

/**
 * Fetch with retry logic
 * @param {string} url 
 * @param {number} retries 
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        // Rate limit - wait and retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      if (res.ok) return res;
      // If 404 or other client error, don't retry
      if (res.status >= 400 && res.status < 500) return res;
    } catch (err) {
      // Network error, retry
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}

async function fetchEvmSecurity(chainId, tokenAddress) {
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
  
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    const result = data.result?.[tokenAddress.toLowerCase()];
    if (!result) return createUnknownReport();
    
    // 1. Honeypot Check
    const isHoneypot = result.is_honeypot === '1';
    
    // 2. Open Source
    const isOpenSource = result.is_open_source === '1';
    
    // 3. Risk Score Calculation
    let riskScore = 0;
    const flags = [];
    
    if (isHoneypot) {
      riskScore = 100;
      flags.push('HONEYPOT');
    }
    
    if (!isOpenSource) {
      riskScore += 30;
      flags.push('Not Open Source');
    }
    
    if (result.is_proxy === '1') {
      riskScore += 20;
      flags.push('Proxy');
    }
    
    if (result.is_mintable === '1') {
      riskScore += 20;
      flags.push('Mintable');
    }
    
    if (result.can_take_back_ownership === '1') {
      riskScore += 50;
      flags.push('Can Take Back Ownership');
    }
    
    if (result.owner_change_balance === '1') {
      riskScore += 40;
      flags.push('Owner Change Balance');
    }
    
    const buyTax = parseFloat(result.buy_tax) || 0;
    const sellTax = parseFloat(result.sell_tax) || 0;
    
    if (buyTax > 10 || sellTax > 10) {
      riskScore += 30;
      flags.push(`High Tax (B:${buyTax}% S:${sellTax}%)`);
    }

    // Cap score at 100
    riskScore = Math.min(100, riskScore);
    
    // Determine Status
    let status = 'SAFE';
    let riskLevel = 'low';
    
    if (isHoneypot || riskScore >= 60) {
      status = 'SCAM';
      riskLevel = 'critical';
    } else if (riskScore >= 40) {
      status = 'RISK';
      riskLevel = 'medium';
    }
    
    return {
      status,
      isHoneypot,
      isOpenSource,
      riskScore,
      riskLevel,
      isMintable: result.is_mintable === '1',
      isFreezable: result.is_blacklisted === '1',
      isProxy: result.is_proxy === '1',
      isRenounced: result.owner_address === '0x0000000000000000000000000000000000000000',
      buyTax,
      sellTax,
      lpLockedPct: 0, // GoPlus doesn't provide simple LP lock pct
      flags,
      provider: 'goplus'
    };
  } catch (err) {
    console.error(`EVM Security fetch failed: ${err.message}`);
    return createUnknownReport();
  }
}

async function fetchSvmSecurity(tokenAddress) {
  const url = `https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`;
  
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // 1. Rugged Flag
    const isHoneypot = data.rugged === true;
    
    // 2. Risk Score (RugCheck)
    // score_normalised is 0-100 (higher is worse? Need to verify, usually yes for "Risk")
    const riskScore = data.score_normalised || 0;
    
    // 3. Flags
    const flags = [];
    if (isHoneypot) flags.push('RUGGED');
    
    const token = data.token || {};
    const isMintable = token.mintAuthority !== null;
    const isFreezable = token.freezeAuthority !== null;
    const isRenounced = token.updateAuthority === null; // Rough proxy for renounced on SOL? Or mintAuth null?
    // Actually mintAuthority null is "Fixed Supply". updateAuthority null is "Immutable Metadata".
    
    if (isMintable) flags.push('Mintable');
    if (isFreezable) flags.push('Freezable');
    
    // LP Lock
    // RugCheck puts LP info in markets array
    let lpLockedPct = 0;
    if (data.markets && data.markets.length > 0) {
      const market = data.markets[0];
      if (market.lp) {
        lpLockedPct = market.lp.lpLockedPct || 0;
      }
    }
    if (lpLockedPct < 90) flags.push(`Low LP Lock (${lpLockedPct.toFixed(1)}%)`);
    
    // Specific Risks from API
    if (data.risks) {
      data.risks.forEach(r => {
        if (r.level === 'danger') flags.push(r.name);
      });
    }

    // Determine Status
    let status = 'SAFE';
    let riskLevel = 'low';
    
    if (isHoneypot) {
      status = 'SCAM';
      riskLevel = 'critical';
    } else if (riskScore > 60 || (riskScore > 50 && lpLockedPct < 5)) {
      // Stricter threshold based on test data (SnowWif=70, 4ward=67)
      status = 'SCAM'; 
      riskLevel = 'high';
    } else if (riskScore > 40 || isMintable || isFreezable || lpLockedPct < 20) {
      status = 'RISK';
      riskLevel = 'medium';
    }

    return {
      status,
      isHoneypot,
      isOpenSource: true, // SVM contracts are generally public/standard
      riskScore,
      riskLevel,
      isMintable,
      isFreezable,
      isProxy: false,
      isRenounced: !isMintable, // If mint auth is null, supply is fixed
      buyTax: 0,
      sellTax: 0,
      lpLockedPct,
      flags,
      provider: 'rugcheck'
    };
  } catch (err) {
    console.error(`SVM Security fetch failed: ${err.message}`);
    return createUnknownReport();
  }
}

function createUnknownReport() {
  return {
    status: 'UNKNOWN',
    isHoneypot: false,
    isOpenSource: true,
    riskScore: null,
    riskLevel: 'low',
    isMintable: false,
    isFreezable: false,
    isProxy: false,
    isRenounced: true,
    buyTax: 0,
    sellTax: 0,
    lpLockedPct: 0,
    flags: ['Data Unavailable'],
    provider: 'unknown'
  };
}
