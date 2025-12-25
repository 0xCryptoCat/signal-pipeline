/**
 * Telegram DB v5 - File-Based Storage System
 * 
 * Uses Telegram file upload/download for unlimited storage.
 * Stores JSON files (up to 50MB) instead of message text (4KB limit).
 * 
 * Features:
 * - Unlimited tokens/wallets (no 3800 char limit)
 * - Auto-migration from v4
 * - File-based storage with pinned document
 * - Efficient upload/download via Telegram API
 * 
 * Channel Structure:
 * - index-{chain}: Database file storage (sol-db.json)
 * - archive: Leaderboard config + archived data
 * 
 * Signal/Leaderboard Channels:
 * - PRIVATE: -1003474351030 (signals + pinned leaderboards)
 * - PUBLIC:  -1003627230339 (weekly summary + pinned leaderboards)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// CHANNEL CONFIGURATION
// ============================================================

export const CHANNELS = {
  // Database storage (file-based)
  db: {
    sol: '-1003359608037',
    eth: '-1003584605646',
    bsc: '-1003672339048',
    base: '-1003269677620',
  },
  // Archive + leaderboard config
  archive: '-1003645445736',
  // Signal output channels
  private: '-1003474351030',
  public: '-1003627230339',
};

export const CHAIN_KEYS = {
  501: 'sol',
  1: 'eth',
  56: 'bsc',
  8453: 'base',
};

export const CHAIN_IDS = {
  sol: 501,
  eth: 1,
  bsc: 56,
  base: 8453,
};

// ============================================================
// RANKING ALGORITHMS
// ============================================================

/**
 * Calculate token trending score (0-1)
 * Used for Top 15 trending tokens leaderboard
 */
export function calcTokenTrendingScore(token, now = Date.now()) {
  const hoursSinceLastSignal = (now - (token.lastSig || 0)) / (60 * 60 * 1000);
  
  // Recency: decay over 48 hours (0-1)
  const recencyBoost = Math.max(0, 1 - (hoursSinceLastSignal / 48));
  
  // Signal momentum: cap at 5 signals (0-1)
  const signalMomentum = Math.min((token.scnt || 1) / 5, 1);
  
  // Performance: gains boost, losses penalize (0-1)
  const mult = token.peakMult || token.mult || 1;
  const perfFactor = mult >= 1 
    ? Math.min(mult / 2, 1)
    : 0.5 * mult;
  
  // Wallet interest: cap at 3 wallets (0-1)
  const walletFactor = Math.min((token.wallets?.length || 1) / 3, 1);
  
  // Entry quality: normalize -2 to +2 → 0 to 1
  const qualityFactor = ((token.avgScr || 0) + 2) / 4;
  
  // Weighted score
  let score = (
    recencyBoost * 0.30 +
    signalMomentum * 0.25 +
    perfFactor * 0.20 +
    walletFactor * 0.15 +
    qualityFactor * 0.10
  );
  
  // Heavy penalty for rugged tokens
  if (token.rugged) score *= 0.1;
  
  return Math.round(score * 100) / 100;
}

/**
 * Calculate wallet rank score (0-1)
 * Used for Top 15 wallets leaderboard
 * Based on: entry_score (40%), participation (20%), win_rate (25%), consistency (15%)
 */
export function calcWalletRankScore(wallet, tokenPeaks = {}) {
  // Entry score: -2 to +2, normalized to 0-1
  const entryScore = wallet.avgScr || 0;
  const entryScoreNorm = (entryScore + 2) / 4;
  
  // Entry count: sqrt for diminishing returns (prevents whale dominance)
  const entryCountFactor = Math.sqrt(Math.min(wallet.scnt || 0, 50)) / Math.sqrt(50);
  
  // Win rate from actual token peaks (7d performance)
  let wins = 0, total = 0;
  for (const [tokenAddr, data] of Object.entries(wallet.tokens || {})) {
    const peak = tokenPeaks[tokenAddr];
    if (peak !== undefined) {
      total++;
      if (peak >= 1.25) wins++; // 25%+ gain = win
    }
  }
  const winRate = total > 0 ? wins / total : 0.5;
  
  // Consistency factor
  const consistencyFactor = (wallet.consistency || 50) / 100;
  
  // Final score
  const score = (
    entryScoreNorm * 0.40 +
    entryCountFactor * 0.20 +
    winRate * 0.25 +
    consistencyFactor * 0.15
  );
  
  return Math.round(score * 100) / 100;
}

/**
 * Calculate wallet stars (0-3)
 */
export function calcWalletStars(wallet, tokenPeaks = {}) {
  const score = calcWalletRankScore(wallet, tokenPeaks);
  
  // Calculate win rate
  let wins = 0, total = 0;
  for (const [tokenAddr, data] of Object.entries(wallet.tokens || {})) {
    const peak = tokenPeaks[tokenAddr];
    if (peak !== undefined) {
      total++;
      if (peak >= 1.25) wins++;
    }
  }
  const winRate = total > 0 ? wins / total : 0;
  
  // Calculate avg peak
  let peakSum = 0, peakCount = 0;
  for (const [tokenAddr] of Object.entries(wallet.tokens || {})) {
    const peak = tokenPeaks[tokenAddr];
    if (peak !== undefined) {
      peakSum += peak;
      peakCount++;
    }
  }
  const avgPeak = peakCount > 0 ? peakSum / peakCount : 1;
  
  // ⭐⭐⭐ Elite
  if (score > 0.7 && winRate > 0.6 && avgPeak > 1.5) return 3;
  // ⭐⭐ Good
  if (score > 0.5 && winRate > 0.5) return 2;
  // ⭐ Decent
  if (score > 0.3 || winRate > 0.4) return 1;
  
  return 0;
}

// ============================================================
// TELEGRAM DB v5 CLASS
// ============================================================

export class TelegramDBv5 {
  constructor(botToken, chainId) {
    this.botToken = botToken;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    this.chainId = chainId;
    this.chainKey = CHAIN_KEYS[chainId] || 'sol';
    this.dbChannel = CHANNELS.db[this.chainKey];
    this.archiveChannel = CHANNELS.archive;
    
    // In-memory database
    this.db = null;
    this.fileId = null;
    this.messageId = null;
    this.isDirty = false;
  }

  // ============================================================
  // TELEGRAM API HELPERS
  // ============================================================

  async api(method, params = {}) {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`TG API ${method}: ${json.description}`);
    return json.result;
  }

  async apiForm(method, formData) {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      body: formData,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`TG API ${method}: ${json.description}`);
    return json.result;
  }

  // ============================================================
  // FILE OPERATIONS
  // ============================================================

  /**
   * Upload JSON data as file to Telegram
   */
  async uploadFile(data, filename) {
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    
    const formData = new FormData();
    formData.append('chat_id', this.dbChannel);
    formData.append('document', blob, filename);
    formData.append('caption', `📦 ${this.chainKey.toUpperCase()} DB | v${data.version} | ${new Date().toISOString()}`);
    
    const result = await this.apiForm('sendDocument', formData);
    return {
      messageId: result.message_id,
      fileId: result.document.file_id,
    };
  }

  /**
   * Update existing file message
   */
  async updateFile(messageId, data, filename) {
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    
    const formData = new FormData();
    formData.append('chat_id', this.dbChannel);
    formData.append('message_id', messageId);
    formData.append('media', JSON.stringify({
      type: 'document',
      media: 'attach://document',
      caption: `📦 ${this.chainKey.toUpperCase()} DB | v${data.version} | ${new Date().toISOString()}`,
    }));
    formData.append('document', blob, filename);
    
    const result = await this.apiForm('editMessageMedia', formData);
    return {
      messageId: result.message_id,
      fileId: result.document.file_id,
    };
  }

  /**
   * Download file from Telegram
   */
  async downloadFile(fileId) {
    // Get file path
    const file = await this.api('getFile', { file_id: fileId });
    const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    
    // Download content
    const res = await fetch(fileUrl);
    const text = await res.text();
    return JSON.parse(text);
  }

  /**
   * Pin message in channel
   */
  async pinMessage(messageId) {
    try {
      await this.api('pinChatMessage', {
        chat_id: this.dbChannel,
        message_id: messageId,
        disable_notification: true,
      });
    } catch (err) {
      console.log(`   ⚠️ Pin failed (non-fatal): ${err.message}`);
    }
  }

  // ============================================================
  // DATABASE OPERATIONS
  // ============================================================

  /**
   * Get default empty database structure
   */
  getDefaultDB() {
    return {
      chain: this.chainKey,
      chainId: this.chainId,
      version: 5,
      updatedAt: Date.now(),
      lastSigs: [],
      tokens: {},
      wallets: {},
      recentSignals: [],
    };
  }

  /**
   * Load database from Telegram (or create new)
   */
  async load() {
    if (this.db) return this.db;
    
    console.log(`   📂 Loading ${this.chainKey} database...`);
    
    try {
      // Get chat info to find pinned message
      const chat = await this.api('getChat', { chat_id: this.dbChannel });
      
      if (chat.pinned_message?.document) {
        // v5 file-based database exists
        const doc = chat.pinned_message.document;
        this.messageId = chat.pinned_message.message_id;
        this.fileId = doc.file_id;
        
        console.log(`   📥 Downloading ${doc.file_name}...`);
        this.db = await this.downloadFile(this.fileId);
        console.log(`   ✅ Loaded: ${Object.keys(this.db.tokens || {}).length} tokens, ${Object.keys(this.db.wallets || {}).length} wallets`);
        return this.db;
      }
      
      // Check for v4 data to migrate
      if (chat.pinned_message?.text) {
        console.log(`   🔄 Found v4 data, migrating...`);
        this.db = await this.migrateFromV4(chat.pinned_message);
        await this.save(true); // Force save migrated data
        return this.db;
      }
      
      // Fresh start
      console.log(`   ℹ️ No existing database, starting fresh`);
      this.db = this.getDefaultDB();
      return this.db;
      
    } catch (err) {
      console.log(`   ⚠️ Load error: ${err.message}, starting fresh`);
      this.db = this.getDefaultDB();
      return this.db;
    }
  }

  /**
   * Migrate from v4 (message-based) to v5 (file-based)
   */
  async migrateFromV4(pinnedMessage) {
    const db = this.getDefaultDB();
    
    try {
      const text = pinnedMessage.text || '';
      const lines = text.split('\n');
      
      // Skip hash line
      const jsonStr = lines.slice(1).join('\n');
      const v4Data = JSON.parse(jsonStr);
      
      // Migrate lastSigs
      db.lastSigs = v4Data.lastSigs || [];
      
      // Migrate trackedTokens → tokens
      if (v4Data.trackedTokens) {
        for (const [addr, token] of Object.entries(v4Data.trackedTokens)) {
          db.tokens[addr] = {
            sym: token.sym || token.symbol || '???',
            p0: token.p0 || token.entryPrice || 0,
            pNow: token.pNow || token.currentPrice || 0,
            pPeak: token.pPeak || token.peakPrice || 0,
            pLow: token.pLow || 0,
            mult: token.mult || token.multiplier || 1,
            peakMult: token.peakMult || token.mult || 1,
            scnt: token.scnt || token.signalCount || 1,
            avgScr: token.avgScr || token.avgScore || 0,
            firstSeen: token.firstSeen || Date.now(),
            lastSig: token.lastSig || token.lastSignal || Date.now(),
            lastMsgId: token.lastMsgId || token.msgId || null,
            rugged: token.rugged || false,
            wallets: token.wallets || [],
          };
        }
      }
      
      // Migrate tokenPeaks to token data
      if (v4Data.tokenPeaks) {
        for (const [addr, peak] of Object.entries(v4Data.tokenPeaks)) {
          if (db.tokens[addr]) {
            db.tokens[addr].peakMult = Math.max(db.tokens[addr].peakMult || 1, peak);
          }
        }
      }
      
      console.log(`   ✅ Migrated ${Object.keys(db.tokens).length} tokens from v4`);
      return db;
      
    } catch (err) {
      console.log(`   ⚠️ Migration error: ${err.message}`);
      return db;
    }
  }

  /**
   * Save database to Telegram
   */
  async save(force = false) {
    if (!this.db) return;
    if (!force && !this.isDirty) return;
    
    this.db.updatedAt = Date.now();
    const filename = `${this.chainKey}-db.json`;
    
    console.log(`   💾 Saving ${this.chainKey} database...`);
    
    try {
      if (this.messageId) {
        // Update existing
        const result = await this.updateFile(this.messageId, this.db, filename);
        this.fileId = result.fileId;
        console.log(`   ✅ Updated: ${Object.keys(this.db.tokens).length} tokens`);
      } else {
        // Create new
        const result = await this.uploadFile(this.db, filename);
        this.messageId = result.messageId;
        this.fileId = result.fileId;
        await this.pinMessage(this.messageId);
        console.log(`   ✅ Created & pinned: ${Object.keys(this.db.tokens).length} tokens`);
      }
      
      this.isDirty = false;
    } catch (err) {
      console.error(`   ❌ Save error: ${err.message}`);
      throw err;
    }
  }

  // ============================================================
  // DATA ACCESS METHODS
  // ============================================================

  /**
   * Check if signal has been seen (for dedup)
   */
  isSignalSeen(signalKey) {
    if (!this.db) return false;
    return (this.db.lastSigs || []).includes(signalKey);
  }

  /**
   * Get set of seen signals
   */
  getSeenSignals() {
    if (!this.db) return new Set();
    return new Set(this.db.lastSigs || []);
  }

  /**
   * Add signal to seen list
   */
  addSeenSignal(signalKey) {
    if (!this.db) return;
    if (!this.db.lastSigs) this.db.lastSigs = [];
    
    this.db.lastSigs.unshift(signalKey);
    // Keep last 200 for dedup
    if (this.db.lastSigs.length > 200) {
      this.db.lastSigs = this.db.lastSigs.slice(0, 200);
    }
    this.isDirty = true;
  }

  /**
   * Get token data
   */
  getToken(address) {
    if (!this.db?.tokens) return null;
    return this.db.tokens[address] || null;
  }

  /**
   * Update or create token
   */
  updateToken(address, data) {
    if (!this.db) return;
    if (!this.db.tokens) this.db.tokens = {};
    
    const existing = this.db.tokens[address] || {};
    this.db.tokens[address] = { ...existing, ...data };
    this.isDirty = true;
  }

  /**
   * Get all tokens
   */
  getAllTokens() {
    if (!this.db?.tokens) return {};
    return this.db.tokens;
  }

  /**
   * Get wallet data
   */
  getWallet(address) {
    if (!this.db?.wallets) return null;
    return this.db.wallets[address] || null;
  }

  /**
   * Update or create wallet
   */
  updateWallet(address, data) {
    if (!this.db) return;
    if (!this.db.wallets) this.db.wallets = {};
    
    const existing = this.db.wallets[address] || {};
    this.db.wallets[address] = { ...existing, ...data };
    this.isDirty = true;
  }

  /**
   * Get all wallets
   */
  getAllWallets() {
    if (!this.db?.wallets) return {};
    return this.db.wallets;
  }

  /**
   * Get token peaks map (for wallet scoring)
   */
  getTokenPeaks() {
    const peaks = {};
    for (const [addr, token] of Object.entries(this.db?.tokens || {})) {
      peaks[addr] = token.peakMult || token.mult || 1;
    }
    return peaks;
  }

  /**
   * Add recent signal for display
   */
  addRecentSignal(signal) {
    if (!this.db) return;
    if (!this.db.recentSignals) this.db.recentSignals = [];
    
    this.db.recentSignals.unshift(signal);
    
    // Keep 7 days of signals
    const cutoff = Date.now() - (7 * DAY_MS);
    this.db.recentSignals = this.db.recentSignals.filter(s => s.time > cutoff);
    
    this.isDirty = true;
  }

  /**
   * Get recent signals (7d)
   */
  getRecentSignals() {
    return this.db?.recentSignals || [];
  }

  // ============================================================
  // LEADERBOARD HELPERS
  // ============================================================

  /**
   * Get top N trending tokens
   */
  getTopTokens(n = 15) {
    const tokens = Object.entries(this.db?.tokens || {})
      .map(([addr, token]) => ({
        addr,
        ...token,
        trendScore: calcTokenTrendingScore(token),
      }))
      .filter(t => !t.rugged && t.lastSig > Date.now() - 7 * DAY_MS)
      .sort((a, b) => b.trendScore - a.trendScore)
      .slice(0, n);
    
    return tokens;
  }

  /**
   * Get top N wallets (7d performance)
   */
  getTopWallets(n = 15) {
    const tokenPeaks = this.getTokenPeaks();
    const cutoff = Date.now() - 7 * DAY_MS;
    
    const wallets = Object.entries(this.db?.wallets || {})
      .map(([addr, wallet]) => ({
        addr,
        ...wallet,
        rankScore: calcWalletRankScore(wallet, tokenPeaks),
        stars: calcWalletStars(wallet, tokenPeaks),
      }))
      .filter(w => (w.lastSeen || 0) > cutoff)
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, n);
    
    // Calculate win rate for display
    return wallets.map(w => {
      let wins = 0, total = 0;
      for (const [tokenAddr] of Object.entries(w.tokens || {})) {
        const peak = tokenPeaks[tokenAddr];
        if (peak !== undefined) {
          total++;
          if (peak >= 1.25) wins++;
        }
      }
      return {
        ...w,
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
      };
    });
  }

  /**
   * Prune old data (called by cleanup cron)
   * Returns pruned counts, optionally archives data before deletion
   */
  pruneOldData(maxAgeDays = 30, shouldArchive = false) {
    if (!this.db) return { tokens: 0, wallets: 0, signals: 0, archived: null };
    
    const cutoff = Date.now() - (maxAgeDays * DAY_MS);
    let prunedTokens = 0, prunedWallets = 0, prunedSignals = 0;
    const archived = shouldArchive ? { tokens: {}, wallets: {} } : null;
    
    // Prune tokens older than maxAgeDays with no recent signals
    for (const [addr, token] of Object.entries(this.db.tokens || {})) {
      if ((token.lastSig || 0) < cutoff) {
        if (archived) archived.tokens[addr] = token;
        delete this.db.tokens[addr];
        prunedTokens++;
      }
    }
    
    // Prune wallets not seen in 7 days (unless high score)
    const walletCutoff = Date.now() - (7 * DAY_MS);
    for (const [addr, wallet] of Object.entries(this.db.wallets || {})) {
      const score = calcWalletRankScore(wallet, this.getTokenPeaks());
      if ((wallet.lastSeen || 0) < walletCutoff && score < 0.5) {
        if (archived) archived.wallets[addr] = wallet;
        delete this.db.wallets[addr];
        prunedWallets++;
      }
    }
    
    // Prune recent signals older than 7 days
    const signalCutoff = Date.now() - (7 * DAY_MS);
    const beforeCount = (this.db.recentSignals || []).length;
    this.db.recentSignals = (this.db.recentSignals || []).filter(s => s.time > signalCutoff);
    prunedSignals = beforeCount - this.db.recentSignals.length;
    
    if (prunedTokens || prunedWallets || prunedSignals) {
      this.isDirty = true;
    }
    
    return { tokens: prunedTokens, wallets: prunedWallets, signals: prunedSignals, archived };
  }

  /**
   * Archive old data to separate file (for long-term storage)
   * Call this before pruneOldData to save historical data
   */
  async archiveOldData(maxAgeDays = 30) {
    const { archived, tokens, wallets, signals } = this.pruneOldData(maxAgeDays, true);
    
    if (!archived || (Object.keys(archived.tokens).length === 0 && Object.keys(archived.wallets).length === 0)) {
      return { archivedTokens: 0, archivedWallets: 0 };
    }
    
    // Save archived data to archive channel
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const filename = `${this.chainKey}-archive-${month}.json`;
    
    const archiveData = {
      chain: this.chainKey,
      archivedAt: Date.now(),
      month,
      tokens: archived.tokens,
      wallets: archived.wallets,
    };
    
    try {
      const blob = new Blob([JSON.stringify(archiveData, null, 2)], { type: 'application/json' });
      const formData = new FormData();
      formData.append('chat_id', CHANNELS.archive);
      formData.append('document', blob, filename);
      formData.append('caption', `📦 Archive: ${this.chainKey.toUpperCase()} ${month} | ${Object.keys(archived.tokens).length} tokens, ${Object.keys(archived.wallets).length} wallets`);
      
      await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: formData });
      console.log(`   📦 Archived ${Object.keys(archived.tokens).length} tokens, ${Object.keys(archived.wallets).length} wallets to ${filename}`);
    } catch (err) {
      console.error(`   ⚠️ Archive failed: ${err.message}`);
    }
    
    return {
      archivedTokens: Object.keys(archived.tokens).length,
      archivedWallets: Object.keys(archived.wallets).length,
      prunedTokens: tokens,
      prunedWallets: wallets,
      prunedSignals: signals,
    };
  }
}

// ============================================================
// LEADERBOARD MANAGER
// ============================================================

// Chain emoji/hashtag mapping
const CHAIN_TAGS = {
  sol: { emoji: '☀️', tag: '#solana', name: 'Solana' },
  eth: { emoji: '💎', tag: '#ethereum', name: 'Ethereum' },
  bsc: { emoji: '🔶', tag: '#bsc', name: 'BSC' },
  base: { emoji: '🔵', tag: '#base', name: 'Base' },
};

/**
 * Get score emoji based on avg score (-2 to +2)
 */
function scoreEmoji(score) {
  if (score >= 1.5) return '🔵';
  if (score >= 0.5) return '🟢';
  if (score >= -0.5) return '⚪️';
  if (score >= -1.5) return '🟠';
  return '🔴';
}

/**
 * Build Telegram message link
 */
function buildMsgLink(channelId, msgId) {
  if (!channelId || !msgId) return null;
  const cleanId = String(channelId).replace(/^-100/, '');
  return `https://t.me/c/${cleanId}/${msgId}`;
}

export class LeaderboardManager {
  constructor(botToken) {
    this.botToken = botToken;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    this.archiveChannel = CHANNELS.archive;
    this.privateChannel = CHANNELS.private;
    this.publicChannel = CHANNELS.public;
    
    // Message IDs for leaderboards and summary
    this.config = null;
  }

  async api(method, params = {}) {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`TG API ${method}: ${json.description}`);
    return json.result;
  }

  /**
   * Load leaderboard config from archive channel
   */
  async loadConfig() {
    if (this.config) return this.config;
    
    try {
      const chat = await this.api('getChat', { chat_id: this.archiveChannel });
      
      if (chat.pinned_message?.document) {
        const file = await this.api('getFile', { file_id: chat.pinned_message.document.file_id });
        const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const data = await res.json();
        
        this.config = data;
        return this.config;
      }
    } catch (err) {
      console.log(`   ⚠️ Could not load config: ${err.message}`);
    }
    
    // Initialize default config
    this.config = {
      leaderboards: {},  // { sol: { private: { wallets: msgId, tokens: msgId }, public: {...} } }
      summaries: { private: null, public: null },  // Pinned summary message IDs
      updatedAt: Date.now(),
    };
    return this.config;
  }

  /**
   * Save config to archive channel
   */
  async saveConfig() {
    if (!this.config) return;
    
    this.config.updatedAt = Date.now();
    
    const blob = new Blob([JSON.stringify(this.config, null, 2)], { type: 'application/json' });
    const formData = new FormData();
    formData.append('chat_id', this.archiveChannel);
    formData.append('document', blob, 'leaderboard-config.json');
    formData.append('caption', `🏆 Leaderboard Config | ${new Date().toISOString()}`);
    
    try {
      const chat = await this.api('getChat', { chat_id: this.archiveChannel });
      
      if (chat.pinned_message?.document?.file_name === 'leaderboard-config.json') {
        const updateForm = new FormData();
        updateForm.append('chat_id', this.archiveChannel);
        updateForm.append('message_id', chat.pinned_message.message_id);
        updateForm.append('media', JSON.stringify({
          type: 'document',
          media: 'attach://document',
          caption: `🏆 Leaderboard Config | ${new Date().toISOString()}`,
        }));
        updateForm.append('document', blob, 'leaderboard-config.json');
        
        await fetch(`${this.apiBase}/editMessageMedia`, { method: 'POST', body: updateForm });
      } else {
        const res = await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: formData });
        const result = await res.json();
        
        if (result.ok) {
          await this.api('pinChatMessage', {
            chat_id: this.archiveChannel,
            message_id: result.result.message_id,
            disable_notification: true,
          });
        }
      }
    } catch (err) {
      console.error(`   ❌ Failed to save config: ${err.message}`);
    }
  }

  /**
   * Shorten wallet address
   */
  shortenAddress(addr) {
    if (!addr || addr.length < 10) return addr || '???';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  }

  /**
   * Format per-chain wallet leaderboard
   * Format: <code>1. │ +46% │ 100% │ 🔵 +2.00 (1) │ </code>WALLET
   */
  formatChainWalletLeaderboard(chain, wallets, channelId, isPublic = false) {
    const chainInfo = CHAIN_TAGS[chain] || { emoji: '🔗', tag: `#${chain}`, name: chain };
    
    let msg = `${chainInfo.emoji} <b>${chainInfo.name} 7D Wallet Leaderboard</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    if (wallets.length === 0) {
      msg += `<i>No wallets tracked yet</i>\n`;
      return msg;
    }
    
    wallets.slice(0, 10).forEach((w, i) => {
      const rank = i + 1;
      const shortAddr = this.shortenAddress(w.addr);
      
      // ROI, Win rate, Score
      const roi = w.avgPeak ? ((w.avgPeak - 1) * 100).toFixed(0) : '0';
      const roiSign = w.avgPeak >= 1 ? '+' : '';
      const winRate = w.winRate || 0;
      const avgScore = w.avgScr || 0;
      const emoji = scoreEmoji(avgScore);
      const scoreStr = avgScore >= 0 ? `+${avgScore.toFixed(2)}` : avgScore.toFixed(2);
      const entries = w.scnt || 0;
      
      // Build wallet display at the end
      let walletDisplay;
      if (isPublic) {
        walletDisplay = shortAddr;
      } else {
        const explorerUrl = chain === 'sol' 
          ? `https://solscan.io/account/${w.addr}`
          : chain === 'eth' ? `https://etherscan.io/address/${w.addr}`
          : chain === 'bsc' ? `https://bscscan.com/address/${w.addr}`
          : chain === 'base' ? `https://basescan.org/address/${w.addr}`
          : null;
        
        walletDisplay = explorerUrl 
          ? `<a href="${explorerUrl}">${shortAddr}</a>`
          : shortAddr;
      }
      
      // Format: <code>stats</code> WALLET (link at end)
      msg += `<code>${rank}. │ ${roiSign}${roi}% │ ${winRate}% │ ${emoji} ${scoreStr} (${entries}) │ </code>${walletDisplay}\n`;
    });
    
    if (!isPublic) {
      msg += `\n<i>🔗 Tap wallet to view on explorer</i>`;
    }
    
    return msg;
  }

  /**
   * Format per-chain token leaderboard
   * Format: <code>1. │ 1.0x │ 🚨 2 │ 🟢 0.00 │ </code>TOKEN
   */
  formatChainTokenLeaderboard(chain, tokens, channelId, isPublic = false) {
    const chainInfo = CHAIN_TAGS[chain] || { emoji: '🔗', tag: `#${chain}`, name: chain };
    
    let msg = `${chainInfo.emoji} <b>${chainInfo.name} Trending Tokens</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    if (tokens.length === 0) {
      msg += `<i>No tokens tracked yet</i>\n`;
      return msg;
    }
    
    tokens.slice(0, 10).forEach((t, i) => {
      const rank = i + 1;
      const sym = t.sym || '???';
      
      // Multiplier, signal count, trend score
      const peakMult = t.peakMult || t.mult || 1;
      const multStr = peakMult.toFixed(1) + 'x';
      const sigs = t.scnt || 1;
      const trendScore = t.trendScore || 0;
      const trendEmoji = scoreEmoji(trendScore * 2); // Scale 0-1 to 0-2 range
      const scoreStr = trendScore >= 0 ? `+${trendScore.toFixed(2)}` : trendScore.toFixed(2);
      
      // Token display with message link at the end
      const msgId = isPublic ? t.publicMsgId : t.lastMsgId;
      const msgLink = buildMsgLink(channelId, msgId);
      const tokenDisplay = msgLink 
        ? `<a href="${msgLink}">${sym}</a>`
        : `<b>${sym}</b>`;
      
      // Format: <code>stats</code> TOKEN (link at end)
      msg += `<code>${rank}. │ ${multStr} │ 🚨 ${sigs} │ ${trendEmoji} ${scoreStr} │ </code>${tokenDisplay}\n`;
    });
    
    return msg;
  }

  /**
   * Format summary message with links to all leaderboards
   */
  formatSummaryMessage(channelId, isPublic = false) {
    const leaderboards = this.config?.leaderboards || {};
    const chains = ['sol', 'eth', 'bsc', 'base'];
    
    let msg = `📊 <b>Stats & Info</b>\n\n`;
    
    if (isPublic) {
      msg += `<i>Track smart money signals across multiple chains. See which wallets and tokens are trending based on our scoring system.</i>\n\n`;
    } else {
      msg += `<i>Private smart money signal feed across 4 chains. See wallet addresses, explorer links, detailed analytics and more!</i>\n\n`;
    }
    
    msg += `<b>📈 Leaderboards:</b>\n`;
    
    for (const chain of chains) {
      const chainInfo = CHAIN_TAGS[chain];
      const chainLeaderboards = leaderboards[chain]?.[isPublic ? 'public' : 'private'] || {};
      
      const tokensLink = buildMsgLink(channelId, chainLeaderboards.tokens);
      const walletsLink = buildMsgLink(channelId, chainLeaderboards.wallets);
      
      const tokensDisplay = tokensLink ? `<a href="${tokensLink}">Tokens</a>` : '<i>Tokens</i>';
      const walletsDisplay = walletsLink ? `<a href="${walletsLink}">Wallets</a>` : '<i>Wallets</i>';
      
      msg += `${chainInfo.emoji} <b>${chainInfo.name}:</b> ${tokensDisplay} • ${walletsDisplay}\n`;
    }
    
    msg += `\n<b>🎯 Signal Scoring:</b>\n`;
    msg += `🔵 Excellent\n`;
    msg += `🟢 Good\n`;
    msg += `⚪️ Neutral\n`;
    msg += `🟠 Weak\n`;
    msg += `🔴 Poor\n`;
    
    if (isPublic) {
      msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `🔓 <b>Want to see the wallet addresses more info?</b>\n`;
      msg += `Join our private channel! Opening soon!\n`;
    } else {
      msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `<i>Leaderboards update live</i>`;
    }
    
    return msg;
  }

  /**
   * Send or edit a message (without pinning)
   */
  async updateMessage(channelId, messageId, text) {
    if (messageId) {
      try {
        await this.api('editMessageText', {
          chat_id: channelId,
          message_id: messageId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        return messageId;
      } catch (err) {
        // Message may have been deleted, send new
        console.log(`   ⚠️ Edit failed (${err.message}), sending new...`);
      }
    }
    
    // Send new message (no pinning for leaderboards)
    const result = await this.api('sendMessage', {
      chat_id: channelId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    
    return result.message_id;
  }

  /**
   * Update or create pinned summary message
   */
  async updateSummaryMessage(channelId, isPublic = false) {
    const key = isPublic ? 'public' : 'private';
    const messageId = this.config?.summaries?.[key];
    const text = this.formatSummaryMessage(channelId, isPublic);
    
    if (messageId) {
      try {
        await this.api('editMessageText', {
          chat_id: channelId,
          message_id: messageId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        return messageId;
      } catch (err) {
        console.log(`   ⚠️ Summary edit failed: ${err.message}`);
      }
    }
    
    // Send and pin new summary
    const result = await this.api('sendMessage', {
      chat_id: channelId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    
    try {
      await this.api('pinChatMessage', {
        chat_id: channelId,
        message_id: result.message_id,
        disable_notification: true,
      });
    } catch (err) {
      console.log(`   ⚠️ Pin failed: ${err.message}`);
    }
    
    return result.message_id;
  }

  /**
   * Unpin all old leaderboard messages (one-time cleanup)
   */
  async unpinOldLeaderboards() {
    const leaderboards = this.config?.leaderboards || {};
    const channels = [
      { id: this.privateChannel, key: 'private' },
      { id: this.publicChannel, key: 'public' },
    ];
    
    for (const { id: channelId, key } of channels) {
      for (const chain of Object.keys(leaderboards)) {
        const chainLeaderboards = leaderboards[chain]?.[key] || {};
        for (const msgId of [chainLeaderboards.tokens, chainLeaderboards.wallets]) {
          if (msgId) {
            try {
              await this.api('unpinChatMessage', {
                chat_id: channelId,
                message_id: msgId,
              });
            } catch (err) {
              // Ignore - may already be unpinned
            }
          }
        }
      }
    }
    console.log('   📌 Unpinned old leaderboard messages');
  }

  /**
   * Update all leaderboards (called by cron)
   */
  async updateAll(allChainDBs) {
    console.log('🏆 Updating leaderboards...');
    
    // Load config
    await this.loadConfig();
    
    // Ensure structure exists
    if (!this.config.leaderboards) this.config.leaderboards = {};
    if (!this.config.summaries) this.config.summaries = { private: null, public: null };
    
    const chains = ['sol', 'eth', 'bsc', 'base'];
    const results = { tokens: 0, wallets: 0 };
    
    // Update each chain's leaderboards
    for (const chain of chains) {
      const db = allChainDBs[chain];
      if (!db) continue;
      
      console.log(`   📊 ${chain.toUpperCase()}...`);
      
      const wallets = db.getTopWallets(10);
      const tokens = db.getTopTokens(10);
      
      // Calculate avgPeak for wallets
      const tokenPeaks = db.getTokenPeaks();
      wallets.forEach(w => {
        let peakSum = 0, peakCount = 0;
        for (const tokenAddr of Object.keys(w.tokens || {})) {
          const peak = tokenPeaks[tokenAddr];
          if (peak !== undefined) {
            peakSum += peak;
            peakCount++;
          }
        }
        w.avgPeak = peakCount > 0 ? peakSum / peakCount : 1;
      });
      
      // Ensure chain structure
      if (!this.config.leaderboards[chain]) {
        this.config.leaderboards[chain] = {
          private: { wallets: null, tokens: null },
          public: { wallets: null, tokens: null },
        };
      }
      
      // Update private channel leaderboards
      try {
        this.config.leaderboards[chain].private.wallets = await this.updateMessage(
          this.privateChannel,
          this.config.leaderboards[chain].private.wallets,
          this.formatChainWalletLeaderboard(chain, wallets, this.privateChannel, false)
        );
        results.wallets++;
        
        this.config.leaderboards[chain].private.tokens = await this.updateMessage(
          this.privateChannel,
          this.config.leaderboards[chain].private.tokens,
          this.formatChainTokenLeaderboard(chain, tokens, this.privateChannel, false)
        );
        results.tokens++;
      } catch (err) {
        console.log(`   ⚠️ Private ${chain}: ${err.message}`);
      }
      
      // Update public channel leaderboards
      try {
        this.config.leaderboards[chain].public.wallets = await this.updateMessage(
          this.publicChannel,
          this.config.leaderboards[chain].public.wallets,
          this.formatChainWalletLeaderboard(chain, wallets, this.publicChannel, true)
        );
        
        this.config.leaderboards[chain].public.tokens = await this.updateMessage(
          this.publicChannel,
          this.config.leaderboards[chain].public.tokens,
          this.formatChainTokenLeaderboard(chain, tokens, this.publicChannel, true)
        );
      } catch (err) {
        console.log(`   ⚠️ Public ${chain}: ${err.message}`);
      }
    }
    
    // Update pinned summary messages with links to all leaderboards
    try {
      this.config.summaries.private = await this.updateSummaryMessage(this.privateChannel, false);
      this.config.summaries.public = await this.updateSummaryMessage(this.publicChannel, true);
      console.log('   📌 Updated summary messages');
    } catch (err) {
      console.log(`   ⚠️ Summary update failed: ${err.message}`);
    }
    
    // Save config
    await this.saveConfig();
    
    console.log(`   ✅ Updated ${results.tokens} token + ${results.wallets} wallet leaderboards`);
    return { topTokens: results.tokens, topWallets: results.wallets };
  }
}

// ============================================================
// EXPORTS
// ============================================================

export default TelegramDBv5;
