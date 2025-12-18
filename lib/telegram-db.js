/**
 * Telegram-as-Database Module
 * 
 * Uses a private Telegram channel as a key-value store.
 * Records are stored as JSON messages with hashtag keys.
 * 
 * Limits:
 * - Max 4096 chars per message
 * - Search via bot API (getUpdates won't work for channels)
 * - We use forwardMessage + getChatHistory workarounds
 * 
 * Record Format:
 * #key:subkey
 * {"data": "here", "ts": 1234567890}
 */

const MAX_MESSAGE_LENGTH = 4000; // Leave buffer for key/formatting

/**
 * TelegramDB - Key-Value store using Telegram channel
 */
class TelegramDB {
  constructor(botToken, channelId) {
    this.botToken = botToken;
    this.channelId = channelId;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    
    // In-memory cache (per instance)
    this.cache = new Map();
    this.messageIdCache = new Map(); // key -> messageId for updates
  }

  /**
   * Make API request to Telegram
   */
  async api(method, params = {}) {
    const url = `${this.apiBase}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) {
      throw new Error(`Telegram API error: ${json.description}`);
    }
    return json.result;
  }

  /**
   * Format a key for storage (hashtag-friendly)
   */
  formatKey(key) {
    // Replace special chars with underscores for hashtag compatibility
    return key.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Store a record
   * @param {string} key - Unique key (e.g., "sig:501:12345-0")
   * @param {object} data - Data to store
   * @returns {number} - Message ID
   */
  async store(key, data) {
    const formattedKey = this.formatKey(key);
    const timestamp = Date.now();
    const record = { ...data, _ts: timestamp, _key: key };
    
    const json = JSON.stringify(record);
    if (json.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Record too large: ${json.length} chars (max ${MAX_MESSAGE_LENGTH})`);
    }
    
    // Format: #key\n{json}
    const text = `#${formattedKey}\n<code>${this.escapeHtml(json)}</code>`;
    
    const result = await this.api('sendMessage', {
      chat_id: this.channelId,
      text,
      parse_mode: 'HTML',
    });
    
    // Cache it
    this.cache.set(key, record);
    this.messageIdCache.set(key, result.message_id);
    
    return result.message_id;
  }

  /**
   * Update an existing record by message ID
   * @param {string} key - The key
   * @param {object} data - New data (merged with existing)
   */
  async update(key, data) {
    const messageId = this.messageIdCache.get(key);
    if (!messageId) {
      // No cached message ID, store as new
      return this.store(key, data);
    }
    
    const formattedKey = this.formatKey(key);
    const existing = this.cache.get(key) || {};
    const timestamp = Date.now();
    const record = { ...existing, ...data, _ts: timestamp, _key: key };
    
    const json = JSON.stringify(record);
    if (json.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Record too large: ${json.length} chars (max ${MAX_MESSAGE_LENGTH})`);
    }
    
    const text = `#${formattedKey}\n<code>${this.escapeHtml(json)}</code>`;
    
    try {
      await this.api('editMessageText', {
        chat_id: this.channelId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      });
      
      this.cache.set(key, record);
      return messageId;
    } catch (err) {
      // Message might be too old to edit, store as new
      console.log(`Could not edit message ${messageId}, storing new: ${err.message}`);
      return this.store(key, data);
    }
  }

  /**
   * Get a record from cache
   * Note: We can't easily search channel history via bot API
   * So we rely on cache + storing message IDs
   */
  get(key) {
    return this.cache.get(key) || null;
  }

  /**
   * Store or update based on whether we've seen this key
   */
  async upsert(key, data) {
    if (this.messageIdCache.has(key)) {
      return this.update(key, data);
    }
    return this.store(key, data);
  }

  /**
   * Escape HTML special chars
   */
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Get cache stats
   */
  stats() {
    return {
      cachedRecords: this.cache.size,
      cachedMessageIds: this.messageIdCache.size,
    };
  }
}

// ============================================================
// SPECIALIZED RECORD TYPES
// ============================================================

/**
 * Signal Record - Tracks a single signal
 */
function createSignalRecord(signal, walletDetails, avgScore) {
  return {
    type: 'signal',
    chainId: signal.chainId,
    batchId: signal.batchId,
    batchIndex: signal.batchIndex,
    tokenAddress: signal.tokenAddress,
    tokenSymbol: signal.tokenSymbol,
    priceAtSignal: signal.priceAtSignal,
    mcap: signal.mcapAtSignal,
    eventTime: signal.eventTime,
    avgScore,
    walletCount: walletDetails.length,
    // Compact wallet list (address + score only)
    wallets: walletDetails.slice(0, 10).map(w => ({
      addr: w.walletAddress.slice(0, 8),
      score: w.entryScore?.toFixed(2) || '?',
    })),
  };
}

/**
 * Token Record - Tracks a token across signals
 */
function createTokenRecord(chainId, tokenAddress, tokenSymbol) {
  return {
    type: 'token',
    chainId,
    tokenAddress,
    tokenSymbol,
    firstSeen: Date.now(),
    signalCount: 1,
    prices: [], // { ts, price } array
    bestEntry: null,
  };
}

/**
 * Wallet Record - Tracks a wallet's performance
 */
function createWalletRecord(chainId, walletAddress) {
  return {
    type: 'wallet',
    chainId,
    walletAddress,
    firstSeen: Date.now(),
    entryCount: 0,
    avgScore: 0,
    scores: [], // Recent scores
  };
}

/**
 * LastSeen Record - For deduplication
 */
function createLastSeenRecord(chainId, signalId) {
  return {
    type: 'lastseen',
    chainId,
    lastSignalId: signalId,
    lastUpdate: Date.now(),
  };
}

// ============================================================
// EXPORTS
// ============================================================

export {
  TelegramDB,
  createSignalRecord,
  createTokenRecord,
  createWalletRecord,
  createLastSeenRecord,
  MAX_MESSAGE_LENGTH,
};
