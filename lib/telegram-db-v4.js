/**
 * Telegram DB v4 - Production Multi-Channel System
 * 
 * Features:
 * - Separate channels per chain per data type
 * - Archive channel for deleted records
 * - Time-windowed retention with auto-cleanup
 * - Dedup via index channel
 * 
 * Channel Structure:
 * - index-{chain}:   Permanent aggregates, dedup, top performers
 * - signals-{chain}: Individual signals (7d retention)
 * - tokens-{chain}:  Token aggregates (30d retention)
 * - wallets-{chain}: Wallet aggregates (7-30d based on score)
 * - archive-all:     Archived records before deletion
 */

const SAFE_LENGTH = 3800;
const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// CHANNEL CONFIGURATION
// ============================================================

const CHANNELS = {
  archive: '-1003645445736',
  
  sol: {
    index: '-1003359608037',
    signals: '-1003683149932',
    tokens: '-1003300774874',
    wallets: '-1003664436076',
  },
  eth: {
    index: '-1003584605646',
    signals: '-1003578324311',
    tokens: '-1003359979587',
    wallets: '-1003674004589',
  },
  bsc: {
    index: '-1003672339048',
    signals: '-1003512733161',
    tokens: '-1003396432095',
    wallets: '-1003232990934',
  },
  base: {
    index: '-1003269677620',
    signals: '-1003646542784',
    tokens: '-1003510261312',
    wallets: '-1003418587058',
  },
};

const CHAIN_KEYS = {
  501: 'sol',
  1: 'eth',
  56: 'bsc',
  8453: 'base',
};

// Retention policies
const RETENTION = {
  signals: 7 * DAY_MS,
  tokens: 30 * DAY_MS,
  wallets: {
    highScore: 30 * DAY_MS,
    lowScore: 7 * DAY_MS,
    threshold: 0.5,
  },
  topWallets: 50,
  dedupWindow: 100,
};

// ============================================================
// TELEGRAM DB v4 CLASS
// ============================================================

class TelegramDBv4 {
  constructor(botToken, chainId) {
    this.botToken = botToken;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    this.chainId = chainId;
    this.chainKey = CHAIN_KEYS[chainId] || 'sol';
    this.channels = CHANNELS[this.chainKey];
    this.archiveChannel = CHANNELS.archive;
    
    // Caches
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

  /**
   * Load index from Telegram channel (for cold start dedup)
   * Uses pinned message in the index channel
   */
  async loadIndex() {
    try {
      const indexKey = Keys.index();
      console.log(`   📂 Loading index from channel...`);
      
      // Get chat info which includes pinned message ID
      const chat = await this.api('getChat', { chat_id: this.channels.index });
      
      if (chat.pinned_message) {
        const pinnedText = chat.pinned_message.text || '';
        const lines = pinnedText.split('\n');
        
        // Check if this is our index message
        if (lines[0] === this.hashKey(indexKey)) {
          try {
            const jsonStr = lines.slice(1).join('\n');
            const record = JSON.parse(jsonStr);
            this.cache.index.set(indexKey, record);
            this.msgIds.index.set(indexKey, chat.pinned_message.message_id);
            console.log(`   ✅ Loaded index: ${record.lastSigs?.length || 0} seen signals`);
            return record;
          } catch (parseErr) {
            console.log(`   ⚠️ Index parse error: ${parseErr.message}`);
          }
        }
      }
      
      console.log(`   ℹ️ No pinned index found, starting fresh`);
      return null;
    } catch (err) {
      console.log(`   ⚠️ Could not load index: ${err.message}`);
      return null;
    }
  }

  /**
   * Pin the index message for easy retrieval on cold start
   */
  async pinIndex() {
    const indexKey = Keys.index();
    const msgId = this.msgIds.index.get(indexKey);
    
    if (msgId) {
      try {
        await this.api('pinChatMessage', {
          chat_id: this.channels.index,
          message_id: msgId,
          disable_notification: true,
        });
        console.log(`   📌 Pinned index message`);
      } catch (err) {
        // May fail if already pinned or no permission
        console.log(`   ⚠️ Pin failed (non-fatal): ${err.message}`);
      }
    }
  }

  /**
   * Get seen signals from index (for dedup)
   * Returns Set of signal keys that have been processed
   */
  getSeenSignals() {
    const indexKey = Keys.index();
    const index = this.cache.index.get(indexKey);
    if (!index || !index.lastSigs) return new Set();
    return new Set(index.lastSigs);
  }

  hashKey(key) {
    return '#' + key.replace(/[^a-zA-Z0-9]/g, '_');
  }

  getChannelId(type) {
    return this.channels[type];
  }

  // Calculate expiry based on type and data
  getExpiry(type, data) {
    const now = Date.now();
    switch (type) {
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

  // Store new record
  async store(type, key, data) {
    const channelId = this.getChannelId(type);
    const record = { 
      ...data, 
      _t: Date.now(), 
      _exp: this.getExpiry(type, data),
      _chain: this.chainKey,
    };
    let json = JSON.stringify(record);
    
    if (json.length > SAFE_LENGTH) {
      console.error(`   ❌ Store too large: ${json.length}/${SAFE_LENGTH}`);
      // Try to trim trackedTokens for index type
      if (type === 'index' && record.trackedTokens && record.trackedTokens.length > 10) {
        record.trackedTokens = record.trackedTokens.slice(-10);
        json = JSON.stringify(record);
        if (json.length > SAFE_LENGTH) {
          throw new Error(`Still too large after trim: ${json.length}/${SAFE_LENGTH}`);
        }
        console.log(`   ✅ Trimmed to ${record.trackedTokens.length} tokens`);
      } else {
        throw new Error(`Too large: ${json.length}/${SAFE_LENGTH}`);
      }
    }
    
    const text = `${this.hashKey(key)}\n${json}`;
    
    const result = await this.api('sendMessage', {
      chat_id: channelId,
      text,
    });
    
    this.cache[type].set(key, record);
    this.msgIds[type].set(key, result.message_id);
    return result.message_id;
  }

  // Update existing record
  async update(type, key, data) {
    const msgId = this.msgIds[type].get(key);
    if (!msgId) return this.store(type, key, data);
    
    const channelId = this.getChannelId(type);
    const existing = this.cache[type].get(key) || {};
    const record = { 
      ...existing, 
      ...data, 
      _t: Date.now(),
      _exp: this.getExpiry(type, { ...existing, ...data }),
      _chain: this.chainKey,
    };
    
    const json = JSON.stringify(record);
    if (json.length > SAFE_LENGTH) {
      console.error(`   ❌ Index too large: ${json.length}/${SAFE_LENGTH} - trimming oldest tokens`);
      // Try to trim trackedTokens if that's what's too big
      if (record.trackedTokens && record.trackedTokens.length > 10) {
        record.trackedTokens = record.trackedTokens.slice(-10);
        const trimmedJson = JSON.stringify(record);
        if (trimmedJson.length <= SAFE_LENGTH) {
          console.log(`   ✅ Trimmed to ${record.trackedTokens.length} tokens, now ${trimmedJson.length} chars`);
        } else {
          throw new Error(`Still too large after trim: ${trimmedJson.length}/${SAFE_LENGTH}`);
        }
      } else {
        throw new Error(`Too large: ${json.length}/${SAFE_LENGTH}`);
      }
    }
    
    // Warn if approaching limit
    if (json.length > SAFE_LENGTH - 200) {
      console.log(`   ⚠️ Index near limit: ${json.length}/${SAFE_LENGTH}`);
    }
    
    const text = `${this.hashKey(key)}\n${json}`;
    
    try {
      await this.api('editMessageText', {
        chat_id: channelId,
        message_id: msgId,
        text,
      });
      this.cache[type].set(key, record);
      return msgId;
    } catch {
      return this.store(type, key, data);
    }
  }

  // Get from cache
  get(type, key) {
    return this.cache[type].get(key);
  }

  // Check if key exists
  has(type, key) {
    return this.cache[type].has(key);
  }

  // Upsert
  async upsert(type, key, data) {
    return this.msgIds[type].has(key) 
      ? this.update(type, key, data) 
      : this.store(type, key, data);
  }

  // Archive and delete a record
  async archiveAndDelete(type, key, reason = 'expired') {
    const record = this.cache[type].get(key);
    const msgId = this.msgIds[type].get(key);
    
    if (record && this.archiveChannel) {
      // Archive to archive channel
      const archiveText = `#archived_${type}\n#reason_${reason}\n${JSON.stringify({
        ...record,
        _archived: Date.now(),
        _reason: reason,
        _originalType: type,
        _originalKey: key,
      })}`;
      
      try {
        await this.api('sendMessage', {
          chat_id: this.archiveChannel,
          text: archiveText,
        });
      } catch (err) {
        console.log(`   ⚠️ Archive failed: ${err.message}`);
      }
    }
    
    // Delete original
    if (msgId) {
      try {
        await this.api('deleteMessage', {
          chat_id: this.getChannelId(type),
          message_id: msgId,
        });
      } catch {
        // Already deleted
      }
    }
    
    this.cache[type].delete(key);
    this.msgIds[type].delete(key);
    return true;
  }

  // Cleanup expired records
  async cleanup(type) {
    const now = Date.now();
    let archived = 0;
    
    for (const [key, record] of this.cache[type].entries()) {
      if (record._exp && record._exp < now) {
        await this.archiveAndDelete(type, key, 'expired');
        archived++;
        await sleep(100); // Rate limit
      }
    }
    
    return archived;
  }

  // Get all keys of a type
  keys(type) {
    return Array.from(this.cache[type].keys());
  }

  // Get all records of a type
  entries(type) {
    return Array.from(this.cache[type].entries());
  }

  stats() {
    return {
      chain: this.chainKey,
      index: this.cache.index.size,
      signals: this.cache.signals.size,
      tokens: this.cache.tokens.size,
      wallets: this.cache.wallets.size,
    };
  }
}

// ============================================================
// RECORD SCHEMAS
// ============================================================

function createIndex(chainId) {
  return {
    c: chainId,
    lastSigs: [],      // Last N signal keys for dedup
    totalSigs: 0,
    totalToks: 0,
    totalWals: 0,
    topWals: [],       // [addrPrefix, avgScore, signalCount]
    bestSigs: [],      // [sigKey, tokenSym, multiplier]
    avgSigScore: 0,
    lastUpdate: Date.now(),
  };
}

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
    ws: wallets.slice(0, 5).map(w => [
      w.walletAddress.slice(0, 8),
      round(w.entryScore, 2)
    ]),
    // Performance (updated by cron)
    pxHigh: null,
    pxNow: null,
    mult: null,
    outcome: null,
  };
}

function createToken(chainId, address, symbol) {
  return {
    addr: address.slice(0, 20),
    sym: symbol,
    first: Date.now(),
    scnt: 0,
    sigs: [],          // [timestamp, entryPrice, score, outcome]
    wals: [],          // Unique wallet prefixes
    p0: null,
    pHigh: null,
    avgScr: 0,
    winRate: 0,
  };
}

function createWallet(chainId, address) {
  return {
    addr: address.slice(0, 20),
    first: Date.now(),
    last: Date.now(),
    scnt: 0,
    toks: [],          // [tokenPrefix, timestamp, entryPrice, outcome]
    avgScr: 0,
    scrs: [],
    wins: 0,
    losses: 0,
    winRate: 0,
    consistency: 0,
  };
}

// ============================================================
// HELPERS
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

function calcConsistency(scores) {
  if (scores.length < 2) return 100;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
  return round(100 - Math.sqrt(variance) * 50, 1);
}

function determineOutcome(entryPrice, highestPrice, currentPrice) {
  const multHigh = highestPrice / entryPrice;
  const multNow = currentPrice / entryPrice;
  if (multHigh >= 2) return 'win';
  if (multNow < 0.5) return 'loss';
  return 'neutral';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Key generators
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
  TelegramDBv4,
  CHANNELS,
  CHAIN_KEYS,
  RETENTION,
  Keys,
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
  sleep,
  SAFE_LENGTH,
  DAY_MS,
};
