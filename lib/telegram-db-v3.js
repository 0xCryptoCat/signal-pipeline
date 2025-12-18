/**
 * Telegram DB v3 - Scalable Architecture
 * 
 * Handles thousands of records with:
 * - Time-windowed retention (7d signals, 30d tokens/wallets)
 * - Rolling aggregates in index
 * - Multiple channels per chain for load distribution
 * - Automatic cleanup of old records
 * 
 * Channel Structure (per chain):
 * - index-{chain}:   Permanent aggregates + top performers
 * - signals-{chain}: Individual signals (7d window)
 * - tokens-{chain}:  Token aggregates (30d window)
 * - wallets-{chain}: Wallet aggregates (30d window, score-based)
 */

const SAFE_LENGTH = 3800;
const DAY_MS = 24 * 60 * 60 * 1000;

// Retention policies
const RETENTION = {
  signals: 7 * DAY_MS,      // 7 days
  tokens: 30 * DAY_MS,       // 30 days
  wallets: {
    highScore: 30 * DAY_MS,  // 30 days if score >= 0.5
    lowScore: 7 * DAY_MS,    // 7 days if score < 0.5
    threshold: 0.5,
  },
  topWallets: 50,            // Keep top 50 in index
  dedupWindow: 100,          // Keep last 100 signal IDs
};

// ============================================================
// MULTI-CHANNEL DATABASE
// ============================================================

class TelegramDBv3 {
  constructor(botToken, channels) {
    this.botToken = botToken;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    
    // Channels: { index, signals, tokens, wallets }
    this.channels = channels;
    
    // Caches per channel type
    this.cache = {
      index: new Map(),
      signals: new Map(),
      tokens: new Map(),
      wallets: new Map(),
    };
    this.msgIds = {
      index: new Map(),
      signals: new Map(),
      tokens: new Map(),
      wallets: new Map(),
    };
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

  hashKey(key) {
    return '#' + key.replace(/[^a-zA-Z0-9]/g, '_');
  }

  // Store to specific channel type
  async store(channelType, key, data) {
    const channelId = this.channels[channelType];
    if (!channelId) throw new Error(`Unknown channel type: ${channelType}`);
    
    const record = { ...data, _t: Date.now(), _exp: this.getExpiry(channelType, data) };
    const json = JSON.stringify(record);
    
    if (json.length > SAFE_LENGTH) {
      throw new Error(`Too large: ${json.length}/${SAFE_LENGTH}`);
    }
    
    const text = `${this.hashKey(key)}\n${json}`;
    
    const result = await this.api('sendMessage', {
      chat_id: channelId,
      text,
    });
    
    this.cache[channelType].set(key, record);
    this.msgIds[channelType].set(key, result.message_id);
    return result.message_id;
  }

  // Calculate expiry timestamp based on channel type and data
  getExpiry(channelType, data) {
    const now = Date.now();
    switch (channelType) {
      case 'signals':
        return now + RETENTION.signals;
      case 'tokens':
        return now + RETENTION.tokens;
      case 'wallets':
        const score = data.avgScr || 0;
        return now + (score >= RETENTION.wallets.threshold 
          ? RETENTION.wallets.highScore 
          : RETENTION.wallets.lowScore);
      case 'index':
        return null; // Never expires
      default:
        return now + RETENTION.signals;
    }
  }

  // Update existing record
  async update(channelType, key, data) {
    const msgId = this.msgIds[channelType].get(key);
    if (!msgId) return this.store(channelType, key, data);
    
    const channelId = this.channels[channelType];
    const existing = this.cache[channelType].get(key) || {};
    const record = { ...existing, ...data, _t: Date.now() };
    
    // Refresh expiry on update
    record._exp = this.getExpiry(channelType, record);
    
    const json = JSON.stringify(record);
    if (json.length > SAFE_LENGTH) {
      throw new Error(`Too large: ${json.length}/${SAFE_LENGTH}`);
    }
    
    const text = `${this.hashKey(key)}\n${json}`;
    
    try {
      await this.api('editMessageText', {
        chat_id: channelId,
        message_id: msgId,
        text,
      });
      this.cache[channelType].set(key, record);
      return msgId;
    } catch {
      return this.store(channelType, key, data);
    }
  }

  // Get from cache
  get(channelType, key) {
    return this.cache[channelType].get(key);
  }

  // Upsert
  async upsert(channelType, key, data) {
    return this.msgIds[channelType].has(key) 
      ? this.update(channelType, key, data) 
      : this.store(channelType, key, data);
  }

  // Delete expired records (call periodically)
  async cleanup(channelType) {
    const now = Date.now();
    const channelId = this.channels[channelType];
    let deleted = 0;
    
    for (const [key, record] of this.cache[channelType].entries()) {
      if (record._exp && record._exp < now) {
        const msgId = this.msgIds[channelType].get(key);
        if (msgId) {
          try {
            await this.api('deleteMessage', {
              chat_id: channelId,
              message_id: msgId,
            });
            deleted++;
          } catch {
            // Message might already be deleted
          }
        }
        this.cache[channelType].delete(key);
        this.msgIds[channelType].delete(key);
      }
    }
    
    return deleted;
  }

  stats() {
    return {
      index: { cached: this.cache.index.size, msgIds: this.msgIds.index.size },
      signals: { cached: this.cache.signals.size, msgIds: this.msgIds.signals.size },
      tokens: { cached: this.cache.tokens.size, msgIds: this.msgIds.tokens.size },
      wallets: { cached: this.cache.wallets.size, msgIds: this.msgIds.wallets.size },
    };
  }
}

// ============================================================
// RECORD SCHEMAS v3 (with expiry support)
// ============================================================

/**
 * INDEX Record - Permanent chain aggregates
 * Key: main (one per channel)
 */
function createIndex(chainId) {
  return {
    c: chainId,
    // Dedup: last N signal IDs
    lastSigs: [],
    // Counts
    totalSigs: 0,
    totalToks: 0,
    totalWals: 0,
    // Top performers: [addrPrefix, avgScore, signalCount]
    topWals: [],
    // Best signals: [sigId, tokenSym, multiplier]
    bestSigs: [],
    // Stats
    avgSigScore: 0,
  };
}

/**
 * SIGNAL Record - Individual signal (7d retention)
 * Key: {batchId}_{batchIndex}
 */
function createSignal(signal, wallets, avgScore) {
  return {
    bid: signal.batchId,
    bix: signal.batchIndex,
    tok: signal.tokenAddress.slice(0, 16),
    sym: signal.tokenSymbol,
    p0: parseFloat(signal.priceAtSignal),
    mc0: parseFloat(signal.mcapAtSignal),
    t0: signal.eventTime,
    scr: round(avgScore, 2),
    wcnt: wallets.length,
    // Wallet scores for correlation analysis
    ws: wallets.slice(0, 5).map(w => [
      w.walletAddress.slice(0, 8),
      round(w.entryScore, 2)
    ]),
    // Performance tracking (updated by cron)
    pxHigh: null,    // Highest price seen
    pxNow: null,     // Current price
    mult: null,      // Current multiplier
    outcome: null,   // 'win' | 'loss' | 'neutral' (set after 24h)
  };
}

/**
 * TOKEN Record - Token aggregate (30d retention)
 * Key: {addressPrefix}
 */
function createToken(chainId, address, symbol) {
  return {
    addr: address.slice(0, 20),
    sym: symbol,
    first: Date.now(),
    // Signal history
    scnt: 0,
    sigs: [],        // [timestamp, entryPrice, score, outcome]
    // Wallet diversity
    wals: [],        // Unique wallet prefixes
    // Performance
    p0: null,        // First signal price
    pHigh: null,     // All-time high since first signal
    avgScr: 0,       // Average signal score
    winRate: 0,      // % of signals that were wins
  };
}

/**
 * WALLET Record - Wallet aggregate (7-30d retention based on score)
 * Key: {addressPrefix}
 */
function createWallet(chainId, address) {
  return {
    addr: address.slice(0, 20),
    first: Date.now(),
    last: Date.now(),
    // Activity
    scnt: 0,          // Signal appearances
    toks: [],         // [tokenPrefix, timestamp, entryPrice, outcome]
    // Scoring
    avgScr: 0,
    scrs: [],         // Recent scores for trend
    // Performance correlation
    wins: 0,
    losses: 0,
    // Calculated fields
    winRate: 0,
    consistency: 0,   // How consistent are their scores
  };
}

/**
 * Check if signal was a win (for outcome tracking)
 */
function determineOutcome(entryPrice, highestPrice, currentPrice) {
  const multHigh = highestPrice / entryPrice;
  const multNow = currentPrice / entryPrice;
  
  if (multHigh >= 2) return 'win';      // 2x at any point = win
  if (multNow < 0.5) return 'loss';     // Down 50% now = loss
  return 'neutral';
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function round(num, decimals = 2) {
  if (num === null || num === undefined) return null;
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function calcMultiplier(entry, current) {
  if (!entry || entry === 0) return 0;
  return round(current / entry, 2);
}

function updateAvg(currentAvg, count, newValue) {
  return round((currentAvg * count + newValue) / (count + 1), 2);
}

function updateWinRate(wins, losses) {
  const total = wins + losses;
  return total > 0 ? round((wins / total) * 100, 1) : 0;
}

// Calculate score consistency (lower = more consistent)
function calcConsistency(scores) {
  if (scores.length < 2) return 100;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
  return round(100 - Math.sqrt(variance) * 50, 1); // Higher = more consistent
}

// ============================================================
// KEY GENERATORS
// ============================================================

const Keys = {
  index: () => 'main',
  signal: (batchId, batchIndex) => `${batchId}_${batchIndex}`,
  token: (address) => address.slice(0, 16),
  wallet: (address) => address.slice(0, 16),
};

// ============================================================
// EXPORTS
// ============================================================

export {
  TelegramDBv3,
  Keys,
  RETENTION,
  createIndex,
  createSignal,
  createToken,
  createWallet,
  determineOutcome,
  calcMultiplier,
  updateAvg,
  updateWinRate,
  calcConsistency,
  round,
  SAFE_LENGTH,
  DAY_MS,
};
