/**
 * Telegram-as-Database v2
 * 
 * Optimized for signal pipeline tracking with minimal char usage.
 * Uses plain text JSON (no HTML formatting) to save space.
 * 
 * Record Types:
 * - idx:{chainId}          - Index/dedup (last signal ID, counts)
 * - sig:{chainId}:{id}     - Individual signal with entry data
 * - tok:{chainId}:{addr}   - Token aggregate (signals, wallets, prices)
 * - wal:{chainId}:{addr}   - Wallet aggregate (signals, scores, trades)
 * - perf:{chainId}:{id}    - Performance snapshots over time
 * 
 * Design Principles:
 * - Compact keys (abbreviations)
 * - Arrays for time-series (capped length)
 * - Derived stats calculated on read
 * - No HTML = more data per message
 */

const MAX_MSG_LENGTH = 4096;
const SAFE_LENGTH = 3800; // Leave buffer for key + formatting

// ============================================================
// TELEGRAM DB CLASS (Plain Text Version)
// ============================================================

class TelegramDB {
  constructor(botToken, channelId) {
    this.botToken = botToken;
    this.channelId = channelId;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    this.cache = new Map();
    this.msgIds = new Map(); // key -> messageId
  }

  async api(method, params = {}) {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`TG API: ${json.description}`);
    return json.result;
  }

  // Convert key to hashtag-safe format
  hashKey(key) {
    return '#' + key.replace(/[^a-zA-Z0-9]/g, '_');
  }

  // Store new record (plain text, no HTML)
  async store(key, data) {
    const record = { ...data, _t: Date.now() };
    const json = JSON.stringify(record);
    
    if (json.length > SAFE_LENGTH) {
      throw new Error(`Too large: ${json.length}/${SAFE_LENGTH}`);
    }
    
    // Plain text format: #key\n{json}
    const text = `${this.hashKey(key)}\n${json}`;
    
    const result = await this.api('sendMessage', {
      chat_id: this.channelId,
      text,
    });
    
    this.cache.set(key, record);
    this.msgIds.set(key, result.message_id);
    return result.message_id;
  }

  // Update existing record
  async update(key, data) {
    const msgId = this.msgIds.get(key);
    if (!msgId) return this.store(key, data);
    
    const existing = this.cache.get(key) || {};
    const record = { ...existing, ...data, _t: Date.now() };
    const json = JSON.stringify(record);
    
    if (json.length > SAFE_LENGTH) {
      throw new Error(`Too large: ${json.length}/${SAFE_LENGTH}`);
    }
    
    const text = `${this.hashKey(key)}\n${json}`;
    
    try {
      await this.api('editMessageText', {
        chat_id: this.channelId,
        message_id: msgId,
        text,
      });
      this.cache.set(key, record);
      return msgId;
    } catch (err) {
      // Message too old or unchanged, store new
      return this.store(key, data);
    }
  }

  // Get from cache
  get(key) {
    return this.cache.get(key);
  }

  // Upsert
  async upsert(key, data) {
    return this.msgIds.has(key) ? this.update(key, data) : this.store(key, data);
  }

  // Append to array field (with cap)
  async appendToArray(key, field, item, maxItems = 50) {
    const existing = this.cache.get(key) || {};
    const arr = existing[field] || [];
    arr.push(item);
    if (arr.length > maxItems) arr.shift(); // Remove oldest
    return this.upsert(key, { ...existing, [field]: arr });
  }

  stats() {
    return { cached: this.cache.size, msgIds: this.msgIds.size };
  }
}

// ============================================================
// RECORD SCHEMAS (Compact)
// ============================================================

/**
 * INDEX Record - Chain-level tracking
 * Key: idx:{chainId}
 * ~150 chars
 */
function createIndex(chainId) {
  return {
    c: chainId,           // chainId
    last: null,           // lastSignalId (for dedup)
    cnt: 0,               // total signals processed
    toks: 0,              // unique tokens seen
    wals: 0,              // unique wallets seen
  };
}

/**
 * SIGNAL Record - Individual signal snapshot
 * Key: sig:{chainId}:{batchId}_{batchIndex}
 * ~400 chars with 5 wallets
 */
function createSignal(signal, wallets, avgScore) {
  return {
    c: signal.chainId,
    bid: signal.batchId,
    bix: signal.batchIndex,
    tok: signal.tokenAddress.slice(0, 12),  // First 12 chars
    sym: signal.tokenSymbol,
    p0: parseFloat(signal.priceAtSignal),   // Entry price
    mc: signal.mcapAtSignal,
    t: signal.eventTime,
    scr: round(avgScore, 2),
    wcnt: wallets.length,
    // Top 5 wallets: [addr_prefix, score]
    ws: wallets.slice(0, 5).map(w => [
      w.walletAddress.slice(0, 8),
      round(w.entryScore, 2)
    ]),
  };
}

/**
 * TOKEN Record - Token aggregate across signals
 * Key: tok:{chainId}:{addressPrefix}
 * ~800 chars with history
 */
function createToken(chainId, address, symbol) {
  return {
    c: chainId,
    addr: address,
    sym: symbol,
    first: Date.now(),        // First seen
    scnt: 0,                  // Signal count
    wcnt: 0,                  // Unique wallet count
    // Recent signals: [timestamp, price, score]
    sigs: [],
    // Unique wallet prefixes
    wals: [],
    // Price snapshots: [timestamp, price]
    px: [],
  };
}

/**
 * WALLET Record - Wallet aggregate across signals
 * Key: wal:{chainId}:{addressPrefix}
 * ~600 chars with history
 */
function createWallet(chainId, address) {
  return {
    c: chainId,
    addr: address,
    first: Date.now(),
    scnt: 0,                  // Signal appearances
    avgScr: 0,                // Running avg score
    // Recent entries: [timestamp, tokenPrefix, price, score]
    ents: [],
    // Score history for trend
    scrs: [],
  };
}

/**
 * PERFORMANCE Record - Signal performance over time
 * Key: perf:{chainId}:{batchId}_{batchIndex}
 * ~500 chars with snapshots
 */
function createPerformance(signal) {
  return {
    c: signal.chainId,
    bid: signal.batchId,
    bix: signal.batchIndex,
    tok: signal.tokenAddress,
    p0: parseFloat(signal.priceAtSignal),
    t0: signal.eventTime,
    // Snapshots: [timestamp, price, multiplier]
    snaps: [],
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function round(num, decimals = 2) {
  if (num === null || num === undefined) return null;
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Calculate multiplier from entry
function calcMultiplier(entryPrice, currentPrice) {
  if (!entryPrice || entryPrice === 0) return 0;
  return round(currentPrice / entryPrice, 2);
}

// Calculate % change
function calcPctChange(entryPrice, currentPrice) {
  if (!entryPrice || entryPrice === 0) return 0;
  return round(((currentPrice - entryPrice) / entryPrice) * 100, 1);
}

// Running average
function updateAvg(currentAvg, count, newValue) {
  return round((currentAvg * count + newValue) / (count + 1), 2);
}

// ============================================================
// KEY GENERATORS
// ============================================================

const Keys = {
  index: (chainId) => `idx:${chainId}`,
  signal: (chainId, batchId, batchIndex) => `sig:${chainId}:${batchId}_${batchIndex}`,
  token: (chainId, address) => `tok:${chainId}:${address.slice(0, 12)}`,
  wallet: (chainId, address) => `wal:${chainId}:${address.slice(0, 12)}`,
  perf: (chainId, batchId, batchIndex) => `perf:${chainId}:${batchId}_${batchIndex}`,
};

// ============================================================
// EXPORTS
// ============================================================

export {
  TelegramDB,
  Keys,
  createIndex,
  createSignal,
  createToken,
  createWallet,
  createPerformance,
  calcMultiplier,
  calcPctChange,
  updateAvg,
  round,
  SAFE_LENGTH,
};
