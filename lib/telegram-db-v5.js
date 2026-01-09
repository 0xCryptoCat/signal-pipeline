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
  public: null, // Disabled: '-1003627230339'
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
 * Calculate wallet rank score (0-100 normalizedScore)
 * Used for Top 15 wallets leaderboard
 * 
 * Original Plan Formula:
 * WalletScore = (WeightedEntryScore * 0.6) + (Consistency * 0.2) + (Recency * 0.2)
 * 
 * Entry Weight = confidence * recency * magnitude
 * - Confidence: Based on wallet's total entry count (more entries = more confidence)
 * - Recency: Newer entries weighted more (decay factor 0.95^age)
 * - Magnitude: Based on price movement after entry
 */
export function calcWalletRankScore(wallet, tokenPeaks = {}) {
  const scores = wallet.scores || [];
  const entryCount = wallet.scnt || scores.length || 0;
  
  if (entryCount === 0) return 0;
  
  // 1. Weighted Entry Score (60%)
  // Weight each score by recency (newest = highest weight)
  const RECENCY_DECAY = 0.95;
  let weightedSum = 0;
  let totalWeight = 0;
  
  // Use last 10 scores (already stored in wallet.scores)
  const recentScores = scores.slice(-10);
  for (let i = 0; i < recentScores.length; i++) {
    const score = recentScores[i];
    const recencyWeight = Math.pow(RECENCY_DECAY, recentScores.length - i - 1);
    // Confidence boost for wallets with more entries (sqrt diminishing returns)
    const confidenceWeight = Math.min(Math.sqrt(entryCount) / Math.sqrt(50), 1);
    const weight = recencyWeight * confidenceWeight;
    
    weightedSum += score * weight;
    totalWeight += weight;
  }
  
  // If no recent scores, fall back to avgScr
  const weightedAvg = totalWeight > 0 
    ? weightedSum / totalWeight 
    : (wallet.avgScr || 0);
  
  // Normalize from -2..+2 to 0..1
  const qualityScore = (weightedAvg + 2) / 4;
  
  // 2. Consistency (20%)
  // Already stored as 0-100
  const consistencyFactor = (wallet.consistency || 50) / 100;
  
  // 3. Recency (20%)
  // How recently has this wallet been active? (within 7 days = full score)
  const lastSeen = wallet.lastSeen || 0;
  const daysSinceActive = (Date.now() - lastSeen) / (24 * 60 * 60 * 1000);
  const recencyFactor = Math.max(0, 1 - (daysSinceActive / 7)); // 0 after 7 days
  
  // Final score (0-1) then scale to 0-100
  const rawScore = (
    qualityScore * 0.60 +
    consistencyFactor * 0.20 +
    recencyFactor * 0.20
  );
  
  // Return 0-100 integer
  return Math.round(rawScore * 100);
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
            // Use Math.max to ensure we keep the highest peak
            const currentPeak = db.tokens[addr].peakMult || 1;
            db.tokens[addr].peakMult = Math.max(currentPeak, peak);
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
  // STATS TRACKING
  // ============================================================

  /**
   * Initialize stats object if missing
   */
  initStats() {
    if (!this.db) return;
    if (this.db.stats) return; // Already exists
    
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = this.getWeekStart();
    const month = today.slice(0, 7);
    
    this.db.stats = {
      lifetime: {
        totalSignals: 0,
        totalTokens: 0,
        totalPeakGainsPct: 0,
        totalLossesPct: 0,
        wins: 0,
        losses: 0,
        rugs: 0,
        peaked1_5x: 0,
        peaked2x: 0,
        peaked5x: 0,
        peaked10x: 0,
      },
      daily: {
        date: today,
        signals: 0,
        tokens: 0,
        peakGainsPct: 0,
        lossesPct: 0,
        wins: 0,
        losses: 0,
        rugs: 0,
        peaked1_5x: 0,
        peaked2x: 0,
        peaked5x: 0,
        peaked10x: 0,
      },
      weekly: {
        weekStart: weekStart,
        signals: 0,
        tokens: 0,
        peakGainsPct: 0,
        lossesPct: 0,
        wins: 0,
        losses: 0,
        rugs: 0,
        peaked1_5x: 0,
        peaked2x: 0,
        peaked5x: 0,
        peaked10x: 0,
      },
      monthly: {
        month: month,
        signals: 0,
        tokens: 0,
        peakGainsPct: 0,
        lossesPct: 0,
        wins: 0,
        losses: 0,
        rugs: 0,
        peaked1_5x: 0,
        peaked2x: 0,
        peaked5x: 0,
        peaked10x: 0,
      },
      history: {
        daily: [],   // Last 7 days
        weekly: [],  // Last 4 weeks
        monthly: [], // Last 12 months
      },
      lastUpdated: Date.now(),
    };
    this.isDirty = true;
  }

  /**
   * Get Monday of current week (ISO week)
   */
  getWeekStart() {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setUTCDate(diff));
    return monday.toISOString().slice(0, 10);
  }

  /**
   * Get current stats
   */
  getStats() {
    this.initStats();
    return this.db.stats;
  }

  /**
   * Record a new signal (call when signal is stored)
   */
  recordSignal(isNewToken = false) {
    this.initStats();
    const stats = this.db.stats;
    
    stats.lifetime.totalSignals++;
    stats.daily.signals++;
    stats.weekly.signals++;
    stats.monthly.signals++;
    
    if (isNewToken) {
      stats.lifetime.totalTokens++;
      stats.daily.tokens++;
      stats.weekly.tokens++;
      stats.monthly.tokens++;
    }
    
    stats.lastUpdated = Date.now();
    this.isDirty = true;
  }

  /**
   * Finalize a token when archived (record final performance)
   * @param {Object} token - The token object being archived
   */
  finalizeToken(token) {
    this.initStats();
    const stats = this.db.stats;
    
    const peakMult = token.peakMult || 1;
    const isWin = peakMult >= 1.0;
    const isRug = token.rugged || false;
    
    // Calculate gains/losses
    const STOP_LOSS_PCT = -35;
    
    if (isWin) {
      const peakGain = (peakMult - 1) * 100;
      stats.lifetime.totalPeakGainsPct += peakGain;
      stats.lifetime.wins++;
      stats.daily.peakGainsPct += peakGain;
      stats.daily.wins++;
      stats.weekly.peakGainsPct += peakGain;
      stats.weekly.wins++;
      stats.monthly.peakGainsPct += peakGain;
      stats.monthly.wins++;
      
      // Peak tier tracking
      if (peakMult >= 10.0) {
        stats.lifetime.peaked10x++;
        stats.daily.peaked10x++;
        stats.weekly.peaked10x++;
        stats.monthly.peaked10x++;
      } else if (peakMult >= 5.0) {
        stats.lifetime.peaked5x++;
        stats.daily.peaked5x++;
        stats.weekly.peaked5x++;
        stats.monthly.peaked5x++;
      } else if (peakMult >= 2.0) {
        stats.lifetime.peaked2x++;
        stats.daily.peaked2x++;
        stats.weekly.peaked2x++;
        stats.monthly.peaked2x++;
      } else if (peakMult >= 1.5) {
        stats.lifetime.peaked1_5x++;
        stats.daily.peaked1_5x++;
        stats.weekly.peaked1_5x++;
        stats.monthly.peaked1_5x++;
      }
    } else {
      // Loss - apply stop loss cap
      stats.lifetime.totalLossesPct += STOP_LOSS_PCT;
      stats.lifetime.losses++;
      stats.daily.lossesPct += STOP_LOSS_PCT;
      stats.daily.losses++;
      stats.weekly.lossesPct += STOP_LOSS_PCT;
      stats.weekly.losses++;
      stats.monthly.lossesPct += STOP_LOSS_PCT;
      stats.monthly.losses++;
    }
    
    if (isRug) {
      stats.lifetime.rugs++;
      stats.daily.rugs++;
      stats.weekly.rugs++;
      stats.monthly.rugs++;
    }
    
    stats.lastUpdated = Date.now();
    this.isDirty = true;
  }

  /**
   * Check and perform rollovers (call at start of update-prices)
   */
  checkRollovers() {
    this.initStats();
    const stats = this.db.stats;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekStart = this.getWeekStart();
    const month = today.slice(0, 7);
    
    // Daily rollover
    if (stats.daily.date !== today) {
      // Save to history
      stats.history.daily.unshift({ ...stats.daily });
      if (stats.history.daily.length > 7) stats.history.daily.pop();
      
      // Reset daily
      stats.daily = {
        date: today,
        signals: 0, tokens: 0,
        peakGainsPct: 0, lossesPct: 0,
        wins: 0, losses: 0, rugs: 0,
        peaked1_5x: 0, peaked2x: 0, peaked5x: 0, peaked10x: 0,
      };
      console.log(`   📅 Daily stats rolled over (${stats.history.daily[0]?.date})`);
    }
    
    // Weekly rollover
    if (stats.weekly.weekStart !== weekStart) {
      stats.history.weekly.unshift({ ...stats.weekly });
      if (stats.history.weekly.length > 4) stats.history.weekly.pop();
      
      stats.weekly = {
        weekStart: weekStart,
        signals: 0, tokens: 0,
        peakGainsPct: 0, lossesPct: 0,
        wins: 0, losses: 0, rugs: 0,
        peaked1_5x: 0, peaked2x: 0, peaked5x: 0, peaked10x: 0,
      };
      console.log(`   📅 Weekly stats rolled over (week of ${stats.history.weekly[0]?.weekStart})`);
    }
    
    // Monthly rollover
    if (stats.monthly.month !== month) {
      stats.history.monthly.unshift({ ...stats.monthly });
      if (stats.history.monthly.length > 12) stats.history.monthly.pop();
      
      stats.monthly = {
        month: month,
        signals: 0, tokens: 0,
        peakGainsPct: 0, lossesPct: 0,
        wins: 0, losses: 0, rugs: 0,
        peaked1_5x: 0, peaked2x: 0, peaked5x: 0, peaked10x: 0,
      };
      console.log(`   📅 Monthly stats rolled over (${stats.history.monthly[0]?.month})`);
    }
    
    this.isDirty = true;
  }

  // ============================================================
  // LEADERBOARD HELPERS
  // ============================================================

  /**
   * Get top N trending tokens by PEAK multiplier
   * Sorted by entry-to-peak gains (peakMult), NOT current price
   * @param {number} n - Max tokens to return (0 = all)
   * @param {string} window - Time window: '7d' (default), '1d', or 'all'
   */
  getTopTokens(n = 15, window = '7d') {
    const now = Date.now();
    const cutoff = window === '1d' ? now - DAY_MS 
                 : window === '7d' ? now - (7 * DAY_MS)
                 : 0; // 'all' = no cutoff
    
    const tokens = Object.entries(this.db?.tokens || {})
      .map(([addr, token]) => {
        // Calculate peakMult from pPeak/p0 if not stored
        const peakMult = token.peakMult || (token.pPeak && token.p0 ? token.pPeak / token.p0 : token.mult || 1);
        return {
          addr,
          ...token,
          peakMult, // Entry to peak multiplier
          rankScore: peakMult, // Rank by peak, not current
        };
      })
      // Filter: Not rugged, hit at least 1.0x peak, within time window
      .filter(t => !t.rugged && t.peakMult >= 1.0 && (t.lastSig || t.firstSeen || 0) > cutoff)
      .sort((a, b) => b.rankScore - a.rankScore);
    
    return n > 0 ? tokens.slice(0, n) : tokens;
  }

  /**
   * Get Hall of Fame tokens (past 7D window, best all-time performers)
   * These are archived tokens that went past 7D but achieved significant gains
   * @param {number} n - Max tokens to return
   */
  getHallOfFame(n = 25) {
    const now = Date.now();
    const cutoff7d = now - (7 * DAY_MS);
    
    const tokens = Object.entries(this.db?.tokens || {})
      .map(([addr, token]) => {
        const peakMult = token.peakMult || (token.pPeak && token.p0 ? token.pPeak / token.p0 : token.mult || 1);
        return {
          addr,
          ...token,
          peakMult,
          rankScore: peakMult,
        };
      })
      // Filter: Achieved at least 2x peak (notable gains), regardless of age
      .filter(t => !t.rugged && t.peakMult >= 2.0)
      .sort((a, b) => b.rankScore - a.rankScore);
    
    return tokens.slice(0, n);
  }

  /**
   * Get gains leaderboard for a specific time period
   * Returns tokens sorted by peakMult with stats
   * 
   * @param {string} period - Time period: '1h', '6h', '12h', '24h', '2d', '3d', '7d', '2w', '3w', '4w'
   * @param {number} n - Max tokens to return
   */
  getGainsLeaderboard(period = '7d', n = 15) {
    const now = Date.now();
    
    // Parse period to milliseconds
    const HOUR_MS = 60 * 60 * 1000;
    const periodMs = {
      '1h': 1 * HOUR_MS,
      '6h': 6 * HOUR_MS,
      '12h': 12 * HOUR_MS,
      '24h': 24 * HOUR_MS,
      '2d': 2 * DAY_MS,
      '3d': 3 * DAY_MS,
      '7d': 7 * DAY_MS,
      '1w': 7 * DAY_MS,
      '2w': 14 * DAY_MS,
      '3w': 21 * DAY_MS,
      '4w': 28 * DAY_MS,
      'all': now,  // No cutoff
    }[period] || 7 * DAY_MS;
    
    const cutoff = now - periodMs;
    
    // Get all tokens within time period
    const tokens = Object.entries(this.db?.tokens || {})
      .map(([addr, token]) => {
        const peakMult = token.peakMult || (token.pPeak && token.p0 ? token.pPeak / token.p0 : token.mult || 1);
        return {
          addr,
          sym: token.sym || 'UNKNOWN',
          peakMult,
          mult: token.mult || 1,
          p0: token.p0,
          pPeak: token.pPeak,
          pNow: token.pNow,
          firstSeen: token.firstSeen || 0,
          lastSig: token.lastSig || token.firstSeen || 0,
          scnt: token.scnt || 1,
          rugged: token.rugged || false,
          msgId: token.lastMsgId || token.msgId || null,  // For signal link
        };
      })
      .filter(t => (t.firstSeen || 0) > cutoff);
    
    // Sort by peakMult descending
    tokens.sort((a, b) => b.peakMult - a.peakMult);
    
    // Calculate stats
    const totalTokens = tokens.length;
    const winners = tokens.filter(t => t.peakMult >= 1.25);
    const moonshots = tokens.filter(t => t.peakMult >= 2.0);
    const rugged = tokens.filter(t => t.rugged);
    
    // Calculate hit rates
    const hitRate = totalTokens > 0 ? Math.round((winners.length / totalTokens) * 100) : 0;
    const moonshotRate = totalTokens > 0 ? Math.round((moonshots.length / totalTokens) * 100) : 0;
    
    // Calculate median peakMult
    const sortedMults = [...tokens].sort((a, b) => a.peakMult - b.peakMult);
    const medianMult = totalTokens > 0 
      ? sortedMults[Math.floor(totalTokens / 2)].peakMult 
      : 1;
    
    // Calculate average peakMult
    const avgMult = totalTokens > 0 
      ? tokens.reduce((sum, t) => sum + t.peakMult, 0) / totalTokens 
      : 1;
    
    // Top performers (n=0 means return all)
    const top = n > 0 ? tokens.slice(0, n) : tokens;
    
    return {
      period,
      periodMs,
      cutoff,
      stats: {
        total: totalTokens,
        winners: winners.length,
        moonshots: moonshots.length,
        rugged: rugged.length,
        hitRate,
        moonshotRate,
        medianMult: Math.round(medianMult * 100) / 100,
        avgMult: Math.round(avgMult * 100) / 100,
      },
      tokens: top,
    };
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
    // EXCEPTION: Keep tokens that are currently winning (> 1.0x) for up to 7 days
    const winnerCutoff = Date.now() - (7 * DAY_MS);
    
    for (const [addr, token] of Object.entries(this.db.tokens || {})) {
      const isWinner = (token.mult || 0) >= 1.0;
      const tokenCutoff = isWinner ? winnerCutoff : cutoff;
      
      if ((token.lastSig || 0) < tokenCutoff) {
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
  sol: { emoji: '🟣', tag: '#SOL', name: 'SOL' },
  eth: { emoji: '🔷', tag: '#ETH', name: 'ETH' },
  bsc: { emoji: '🔶', tag: '#BSC', name: 'BSC' },
  base: { emoji: '🔵', tag: '#BASE', name: 'BASE' },
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
        
        // Migrate from old format if needed
        if (data.leaderboardIds && !data.leaderboards) {
          console.log('   🔄 Migrating old leaderboard config format...');
          data.leaderboards = data.leaderboardIds;
          delete data.leaderboardIds;
        }
        
        // Ensure summaries structure exists
        if (!data.summaries) {
          data.summaries = { private: null, public: null };
        }
        
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
        
        const editRes = await fetch(`${this.apiBase}/editMessageMedia`, { method: 'POST', body: updateForm });
        const editResult = await editRes.json();
        if (!editResult.ok) {
          console.log(`   ⚠️ Config edit failed: ${editResult.description}, sending new...`);
          // Fall through to send new
        } else {
          console.log(`   💾 Config updated`);
          return;
        }
      }
      
      // Send new config file
      const res = await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: formData });
      const result = await res.json();
      
      if (result.ok) {
        await this.api('pinChatMessage', {
          chat_id: this.archiveChannel,
          message_id: result.result.message_id,
          disable_notification: true,
        });
        console.log(`   💾 Config saved & pinned`);
      } else {
        console.error(`   ❌ Config send failed: ${result.description}`);
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
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    
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
   * Shows Top 25 7D gainers + Top 10 1D gainers
   * Uses peakMult (entry to ATH), not current price
   * Format: <code>1. │ 18.5x │ 🚨2 │ </code>TOKEN
   */
  formatChainTokenLeaderboard(chain, tokens7d, tokens1d, channelId, isPublic = false) {
    const chainInfo = CHAIN_TAGS[chain] || { emoji: '🔗', tag: `#${chain}`, name: chain };
    
    // Helper: Calculate sum of gains (Hybrid: <2x adds decimal part, >=2x adds full mult)
    // Example: 1.5x -> +0.5, 11x -> +11
    const calcGainSum = (tokens) => tokens.reduce((sum, t) => {
      const m = t.peakMult || t.mult || 1;
      if (m < 1) return sum;
      return sum + (m < 2 ? m - 1 : m);
    }, 0);
    
    // Helper to format token rows (uses peakMult)
    const formatTokenRow = (t, i, channelId, isPublic) => {
      const rank = i + 1;
      const sym = t.sym || '???';
      const mult = t.peakMult || t.mult || 1;
      const multStr = mult >= 10 ? mult.toFixed(0) + 'x' : mult.toFixed(1) + 'x';
      const sigs = t.scnt || 1;
      const msgId = isPublic ? t.publicMsgId : t.lastMsgId;
      const msgLink = buildMsgLink(channelId, msgId);
      const tokenDisplay = msgLink ? `<a href="${msgLink}">${sym}</a>` : `<b>${sym}</b>`;
      return `<code>${String(rank).padStart(2)}. │ ${multStr.padStart(6)} │ 🚨${sigs} │ </code>${tokenDisplay}\n`;
    };
    
    let msg = `${chainInfo.emoji} <b>${chainInfo.name} Token Leaderboard</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n\n`;
    
    // === 7D Gainers with sum ===
    const sum7d = calcGainSum(tokens7d.slice(0, 25));
    const sum7dStr = sum7d >= 100 ? sum7d.toFixed(0) : sum7d.toFixed(1);
    msg += `📅 <b>7D Top Gainers (${sum7dStr}x)</b>\n`;
    if (tokens7d.length === 0) {
      msg += `<i>No 7D gainers yet</i>\n`;
    } else {
      tokens7d.slice(0, 25).forEach((t, i) => {
        msg += formatTokenRow(t, i, channelId, isPublic);
      });
    }
    
    msg += `\n`;
    
    // === 1D Gainers with sum ===
    const sum1d = calcGainSum(tokens1d.slice(0, 10));
    const sum1dStr = sum1d >= 100 ? sum1d.toFixed(0) : sum1d.toFixed(1);
    msg += `🔥 <b>1D Hot Movers (${sum1dStr}x)</b>\n`;
    if (tokens1d.length === 0) {
      msg += `<i>No 1D movers yet</i>\n`;
    } else {
      tokens1d.slice(0, 10).forEach((t, i) => {
        msg += formatTokenRow(t, i, channelId, isPublic);
      });
    }
    
    if (!isPublic) {
      msg += `\n<i>🔗 Tap token to view signal</i>`;
    }
    
    return msg;
  }

  /**
   * Format summary message with Top 25 cross-chain gainers
   * Uses peakMult (entry to ATH), not current price
   * @param {string} channelId - Target channel
   * @param {boolean} isPublic - Public channel (redacted)
   * @param {Array} topTokens - Top tokens across all chains
   * @param {number} hallOfFameMsgId - Message ID of the Hall of Fame post
   * @param {Object} stats - Global stats (totalGains, badCalls, chainSums)
   */
  formatSummaryMessage(channelId, isPublic = false, topTokens = [], hallOfFameMsgId = null, stats = null) {
    const leaderboards = this.config?.leaderboards || {};
    const chains = ['sol', 'eth', 'bsc', 'base'];
    
    // Calculate sum of gains (Hybrid: <2x adds decimal part, >=2x adds full mult)
    const displayed = topTokens.slice(0, 25);
    const gainSum = displayed.reduce((sum, t) => {
      const m = t.peakMult || t.mult || 1;
      if (m < 1) return sum;
      return sum + (m < 2 ? m - 1 : m);
    }, 0);
    const sumStr = gainSum >= 100 ? gainSum.toFixed(0) : gainSum.toFixed(1);
    
    let msg = `<b>Leaderboards:</b>\n\n`;
    msg += `🏆 <b>Top 25 Gainers - 7D (${sumStr}x)</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    
    if (topTokens.length === 0) {
      msg += `<i>No gainers tracked yet</i>\n`;
    } else {
      // Show Top 25 cross-chain gainers (using peakMult)
      displayed.forEach((t, i) => {
        const rank = i + 1;
        const sym = t.sym || '???';
        const mult = t.peakMult || t.mult || 1;
        const multStr = mult >= 10 ? mult.toFixed(0) + 'x' : mult.toFixed(1) + 'x';
        const chainEmoji = t.chainEmoji || '🔗';
        
        // Token link (private channel only)
        const msgId = isPublic ? t.publicMsgId : t.lastMsgId;
        const targetChannel = t.chain ? (isPublic ? this.publicChannel : this.privateChannel) : channelId;
        const msgLink = buildMsgLink(targetChannel, msgId);
        const tokenDisplay = msgLink && !isPublic 
          ? `<a href="${msgLink}">${sym}</a>` 
          : `<b>${sym}</b>`;
        
        msg += `<code>${String(rank).padStart(2)}. ${chainEmoji} │ ${multStr.padStart(6)} │ </code>${tokenDisplay}\n`;
      });
    }
    
    // Hall of Fame Link
    if (hallOfFameMsgId) {
      const hofLink = buildMsgLink(channelId, hallOfFameMsgId);
      msg += `\n━━━━━━━━━━━━━━━━━━\n`;
      msg += `🏅 Hall of Fame: <a href="${hofLink}">[CLICK TO SEE]</a>\n`;
    }

    // Total Gains & Bad Calls Section
    if (stats) {
      const totalStr = stats.totalGains >= 1000 
        ? (stats.totalGains / 1000).toFixed(1) + 'K' 
        : stats.totalGains.toFixed(0);
        
      const badCallsStr = stats.badCalls >= 1000
        ? (stats.badCalls / 1000).toFixed(1) + 'K'
        : stats.badCalls;

      msg += `\n🔥 <b>Total Gains: x${totalStr}</b>\n`;
      
      // Chain sums row
      const chainSums = chains.map(c => {
        const sum = stats.chainSums[c] || 0;
        const sumStr = sum >= 1000 ? (sum/1000).toFixed(1) + 'K' : sum.toFixed(0);
        return `${CHAIN_TAGS[c].emoji} x${sumStr}`;
      }).join(' │ ');
      
      msg += `${chainSums}\n`;
      msg += `<i>Tokens over 1.3x gain</i>\n`;
      
      msg += `\n📅 Daily Table: [SOON!]\n`;
      
      msg += `\n💀 <b>Bad Calls: ${badCallsStr}</b>\n`;
      msg += `<i>These never hit more than 1.3x!</i>\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `<b>📊 Chain based Leaderboards:</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    
    for (const chain of chains) {
      const chainInfo = CHAIN_TAGS[chain]; 
      const chainLeaderboards = leaderboards[chain]?.[isPublic ? 'public' : 'private'] || {};
      
      const tokensLink = buildMsgLink(channelId, chainLeaderboards.tokens);
      const walletsLink = buildMsgLink(channelId, chainLeaderboards.wallets);
      
      const tokensDisplay = tokensLink ? `<a href="${tokensLink}">Tokens</a>` : 'Tokens';
      const walletsDisplay = walletsLink ? `<a href="${walletsLink}">Wallets</a>` : 'Wallets';
      
      // Format: 🟣 SOL: Tokens │ Wallets
      msg += `${chainInfo.emoji} <code>${chainInfo.name.padEnd(5)}: </code>${tokensDisplay} │ ${walletsDisplay}\n`;
    }
    
    msg += `\n━━━━━━━━━━━━━━━━━━\n`;
    msg += `🔗 <i>Tap token to view signal message!</i>`;
    
    return msg;
  }

  /**
   * Format Hall of Fame message (best performers past 7D window)
   * @param {string} channelId - Target channel
   * @param {boolean} isPublic - Public channel (redacted)
   * @param {Array} hallOfFame - Hall of Fame tokens across all chains
   */
  formatHallOfFame(channelId, isPublic = false, hallOfFame = []) {
    // Calculate sum of gains (Hybrid: <2x adds decimal part, >=2x adds full mult)
    const displayed = hallOfFame.slice(0, 25);
    const gainSum = displayed.reduce((sum, t) => {
      const m = t.peakMult || t.mult || 1;
      if (m < 1) return sum;
      return sum + (m < 2 ? m - 1 : m);
    }, 0);
    const sumStr = gainSum >= 100 ? gainSum.toFixed(0) : gainSum.toFixed(1);
    
    let msg = `🏅 <b>Hall of Fame (${sumStr}x)</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `<i>Best gainers since start</i>\n\n`;
    
    if (hallOfFame.length === 0) {
      msg += `<i>No Hall of Fame entries yet</i>\n`;
    } else {
      displayed.forEach((t, i) => {
        const rank = i + 1;
        const sym = t.sym || '???';
        const mult = t.peakMult || t.mult || 1;
        const multStr = mult >= 10 ? mult.toFixed(0) + 'x' : mult.toFixed(1) + 'x';
        const chainEmoji = t.chainEmoji || '🔗';
        
        // Token link (private channel only)
        const msgId = isPublic ? t.publicMsgId : t.lastMsgId;
        const targetChannel = t.chain ? (isPublic ? this.publicChannel : this.privateChannel) : channelId;
        const msgLink = buildMsgLink(targetChannel, msgId);
        const tokenDisplay = msgLink && !isPublic 
          ? `<a href="${msgLink}">${sym}</a>` 
          : `<b>${sym}</b>`;
        
        msg += `<code>${String(rank).padStart(2)}. ${chainEmoji} │ ${multStr.padStart(6)} │ </code>${tokenDisplay}\n`;
      });
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
        console.log(`   ✏️ Edited message ${messageId}`);
        return messageId;
      } catch (err) {
        // Check if it's "message not modified" - that's OK, keep the same ID
        if (err.message.includes('not modified')) {
          console.log(`   ✏️ Message ${messageId} unchanged`);
          return messageId;
        }
        // Message may have been deleted or can't be edited, send new
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
    
    console.log(`   📤 Sent new message ${result.message_id}`);
    return result.message_id;
  }

  /**
   * Update or create pinned summary message
   * @param {string} channelId - Target channel
   * @param {boolean} isPublic - Public channel (redacted)
   * @param {Array} topTokens - Top tokens across all chains
   * @param {number} hallOfFameMsgId - Message ID of the Hall of Fame post
   * @param {Object} stats - Global stats (totalGains, badCalls, chainSums)
   */
  async updateSummaryMessage(channelId, isPublic = false, topTokens = [], hallOfFameMsgId = null, stats = null) {
    const key = isPublic ? 'public' : 'private';
    const messageId = this.config?.summaries?.[key];
    const text = this.formatSummaryMessage(channelId, isPublic, topTokens, hallOfFameMsgId, stats);
    
    if (messageId) {
      try {
        await this.api('editMessageText', {
          chat_id: channelId,
          message_id: messageId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        console.log(`   ✏️ Summary ${key} updated (msg ${messageId})`);
        return messageId;
      } catch (err) {
        // "message not modified" is OK - content is same, keep the existing ID
        if (err.message.includes('not modified')) {
          console.log(`   ✏️ Summary ${key} unchanged (msg ${messageId})`);
          return messageId;
        }
        // Only create new message if the edit truly failed (message deleted, etc)
        console.log(`   ⚠️ Summary edit failed: ${err.message}, sending new...`);
      }
    }
    
    // Send and pin new summary (only if no existing message or edit failed)
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
    
    // Collect cross-chain tokens for summary (Top 25 across all chains)
    const allTokens7d = [];

    // Initialize stats
    const stats = {
      totalGains: 0,
      badCalls: 0,
      chainSums: { sol: 0, eth: 0, bsc: 0, base: 0 }
    };
    
    // Update each chain's leaderboards
    for (const chain of chains) {
      const db = allChainDBs[chain];
      if (!db) continue;
      
      console.log(`   📊 ${chain.toUpperCase()}...`);

      // Calculate stats for this chain
      const allTokens = db.db?.tokens || {};
      let chainSum = 0;
      
      for (const token of Object.values(allTokens)) {
        const mult = token.peakMult || token.mult || 1;
        
        // Only count if > 1.3x
        if (mult > 1.3) {
          // Hybrid sum: <2x adds decimal, >=2x adds full
          const gain = mult < 2 ? mult - 1 : mult;
          chainSum += gain;
          stats.totalGains += gain;
        } else {
          // Bad call: never hit > 1.3x
          stats.badCalls++;
        }
      }
      stats.chainSums[chain] = chainSum;
      
      const wallets = db.getTopWallets(10);
      const tokens7d = db.getTopTokens(25, '7d');
      const tokens1d = db.getTopTokens(10, '1d');
      
      // Add chain tag to tokens for cross-chain summary
      const chainInfo = CHAIN_TAGS[chain];
      tokens7d.forEach(t => {
        allTokens7d.push({ ...t, chain, chainEmoji: chainInfo?.emoji || '🔗' });
      });
      
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
          this.formatChainTokenLeaderboard(chain, tokens7d, tokens1d, this.privateChannel, false)
        );
        results.tokens++;
      } catch (err) {
        console.log(`   ⚠️ Private ${chain}: ${err.message}`);
      }
    }
    
    // Sort all tokens by peakMult (entry to ATH) and take top 25
    const top25CrossChain = allTokens7d
      .sort((a, b) => (b.peakMult || 1) - (a.peakMult || 1))
      .slice(0, 25);
    
    // Collect Hall of Fame tokens (past 7D, 2x+ peak) across all chains
    const allHallOfFame = [];
    for (const chain of chains) {
      const db = allChainDBs[chain];
      if (!db) continue;
      const hof = db.getHallOfFame(25);
      const chainInfo = CHAIN_TAGS[chain];
      hof.forEach(t => {
        allHallOfFame.push({ ...t, chain, chainEmoji: chainInfo?.emoji || '🔗' });
      });
    }
    const top25HallOfFame = allHallOfFame
      .sort((a, b) => (b.peakMult || 1) - (a.peakMult || 1))
      .slice(0, 25);
    
    // Update Hall of Fame message FIRST so we can link to it
    try {
      if (!this.config.hallOfFame) this.config.hallOfFame = { private: null, public: null };
      this.config.hallOfFame.private = await this.updateMessage(
        this.privateChannel,
        this.config.hallOfFame.private,
        this.formatHallOfFame(this.privateChannel, false, top25HallOfFame)
      );
      console.log('   🏅 Updated Hall of Fame message');
    } catch (err) {
      console.log(`   ⚠️ Hall of Fame update failed: ${err.message}`);
    }

    // Update pinned summary messages with Top 25 cross-chain gainers
    try {
      this.config.summaries.private = await this.updateSummaryMessage(
        this.privateChannel, 
        false, 
        top25CrossChain,
        this.config.hallOfFame.private, // Pass HoF message ID
        stats // Pass stats
      );
      console.log('   📌 Updated private summary message');
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
