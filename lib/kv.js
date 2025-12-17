/**
 * Vercel KV Helper for Signal Deduplication
 * 
 * Uses Vercel KV to track the last processed signal ID per chain.
 * This is extremely efficient: 1 GET + 1 SET per poll = ~5,760 requests/month for 4 chains.
 * 
 * Setup:
 * 1. Go to Vercel Dashboard → Storage → Create KV Database
 * 2. Link it to your project
 * 3. Environment variables are auto-added: KV_REST_API_URL, KV_REST_API_TOKEN
 */

// Check if KV is available
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

/**
 * Get value from Vercel KV
 */
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) {
    console.log('⚠️ KV not configured, using in-memory fallback');
    return null;
  }

  try {
    const res = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('KV GET error:', err.message);
    return null;
  }
}

/**
 * Set value in Vercel KV
 * @param {string} key 
 * @param {any} value 
 * @param {number} exSeconds - Expiration in seconds (default 7 days)
 */
async function kvSet(key, value, exSeconds = 604800) {
  if (!KV_URL || !KV_TOKEN) {
    return false;
  }

  try {
    const res = await fetch(`${KV_URL}/set/${key}/${encodeURIComponent(JSON.stringify(value))}/ex/${exSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    return data.result === 'OK';
  } catch (err) {
    console.error('KV SET error:', err.message);
    return false;
  }
}

/**
 * Get last processed signal ID for a chain
 * @param {number} chainId 
 * @returns {Promise<number|null>}
 */
async function getLastSignalId(chainId) {
  const data = await kvGet(`lastSignal:${chainId}`);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      return parsed.signalId || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Set last processed signal ID for a chain
 * @param {number} chainId 
 * @param {number} signalId 
 * @param {object} metadata - Optional metadata (tokenSymbol, etc)
 */
async function setLastSignalId(chainId, signalId, metadata = {}) {
  return kvSet(`lastSignal:${chainId}`, {
    signalId,
    timestamp: Date.now(),
    ...metadata,
  });
}

/**
 * Track token signal for "since last signal" feature
 * @param {number} chainId 
 * @param {string} tokenAddress 
 * @param {object} signalData 
 */
async function trackTokenSignal(chainId, tokenAddress, signalData) {
  const key = `token:${chainId}:${tokenAddress}`;
  const prev = await kvGet(key);
  
  let prevData = null;
  if (prev) {
    try {
      prevData = JSON.parse(prev);
    } catch {}
  }

  await kvSet(key, {
    lastSignalTime: Date.now(),
    lastPrice: signalData.price,
    lastMcap: signalData.mcap,
    signalCount: (prevData?.signalCount || 0) + 1,
  });

  return prevData;
}

/**
 * Check if KV is available
 */
function isKvAvailable() {
  return !!(KV_URL && KV_TOKEN);
}

export {
  kvGet,
  kvSet,
  getLastSignalId,
  setLastSignalId,
  trackTokenSignal,
  isKvAvailable,
};
