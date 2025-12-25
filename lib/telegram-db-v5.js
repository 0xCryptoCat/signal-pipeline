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
   */
  pruneOldData(maxAgeDays = 30) {
    if (!this.db) return { tokens: 0, wallets: 0, signals: 0 };
    
    const cutoff = Date.now() - (maxAgeDays * DAY_MS);
    let prunedTokens = 0, prunedWallets = 0, prunedSignals = 0;
    
    // Prune tokens older than maxAgeDays with no recent signals
    for (const [addr, token] of Object.entries(this.db.tokens || {})) {
      if ((token.lastSig || 0) < cutoff) {
        delete this.db.tokens[addr];
        prunedTokens++;
      }
    }
    
    // Prune wallets not seen in 7 days (unless high score)
    const walletCutoff = Date.now() - (7 * DAY_MS);
    for (const [addr, wallet] of Object.entries(this.db.wallets || {})) {
      const score = calcWalletRankScore(wallet, this.getTokenPeaks());
      if ((wallet.lastSeen || 0) < walletCutoff && score < 0.5) {
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
    
    return { tokens: prunedTokens, wallets: prunedWallets, signals: prunedSignals };
  }
}

// ============================================================
// LEADERBOARD MANAGER
// ============================================================

export class LeaderboardManager {
  constructor(botToken) {
    this.botToken = botToken;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
    this.archiveChannel = CHANNELS.archive;
    this.privateChannel = CHANNELS.private;
    this.publicChannel = CHANNELS.public;
    
    // Message IDs for pinned leaderboards
    this.messageIds = null;
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
   * Load leaderboard message IDs from archive channel
   */
  async loadMessageIds() {
    if (this.messageIds) return this.messageIds;
    
    try {
      const chat = await this.api('getChat', { chat_id: this.archiveChannel });
      
      if (chat.pinned_message?.document) {
        const file = await this.api('getFile', { file_id: chat.pinned_message.document.file_id });
        const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const data = await res.json();
        
        if (data.leaderboardIds) {
          this.messageIds = data.leaderboardIds;
          return this.messageIds;
        }
      }
    } catch (err) {
      console.log(`   ⚠️ Could not load leaderboard IDs: ${err.message}`);
    }
    
    return null;
  }

  /**
   * Save leaderboard message IDs to archive channel
   */
  async saveMessageIds(ids) {
    this.messageIds = ids;
    
    // Save to archive as JSON file
    const data = {
      leaderboardIds: ids,
      updatedAt: Date.now(),
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const formData = new FormData();
    formData.append('chat_id', this.archiveChannel);
    formData.append('document', blob, 'leaderboard-config.json');
    formData.append('caption', `🏆 Leaderboard Config | ${new Date().toISOString()}`);
    
    try {
      // Check if we have existing config to update
      const chat = await this.api('getChat', { chat_id: this.archiveChannel });
      
      if (chat.pinned_message?.document?.file_name === 'leaderboard-config.json') {
        // Update existing
        const updateForm = new FormData();
        updateForm.append('chat_id', this.archiveChannel);
        updateForm.append('message_id', chat.pinned_message.message_id);
        updateForm.append('media', JSON.stringify({
          type: 'document',
          media: 'attach://document',
          caption: `🏆 Leaderboard Config | ${new Date().toISOString()}`,
        }));
        updateForm.append('document', blob, 'leaderboard-config.json');
        
        const res = await fetch(`${this.apiBase}/editMessageMedia`, {
          method: 'POST',
          body: updateForm,
        });
        await res.json();
      } else {
        // Create new and pin
        const res = await fetch(`${this.apiBase}/sendDocument`, {
          method: 'POST',
          body: formData,
        });
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
      console.error(`   ❌ Failed to save leaderboard IDs: ${err.message}`);
    }
  }

  /**
   * Format token leaderboard message
   * Note: Token leaderboard is the SAME for public and private (tokens aren't sensitive)
   */
  formatTokenLeaderboard(tokens, isPublic = false) {
    const now = new Date().toUTCString().replace('GMT', 'UTC');
    
    // Same format for both public and private (tokens aren't sensitive info)
    let msg = `📊 <b>TOKEN LEADERBOARD</b> (Live)\n`;
    msg += `<i>Updated: ${now}</i>\n\n`;
    msg += `<code> # │ Token │ Chain │ Peak │ Sigs │ Score</code>\n`;
    msg += `<code>───┼───────┼───────┼──────┼──────┼──────</code>\n`;
    
    tokens.forEach((t, i) => {
      const rank = String(i + 1).padStart(2);
      const sym = (t.sym || '???').slice(0, 5).padEnd(5);
      const chain = (t.chain || 'sol').toUpperCase().padEnd(5);
      const peak = (t.peakMult?.toFixed(1) || '1.0').padStart(4) + 'x';
      const sigs = String(t.scnt || 1).padStart(4);
      const score = (t.trendScore?.toFixed(2) || '0.00').padStart(4);
      msg += `<code>${rank} │ ${sym} │ ${chain} │ ${peak} │ ${sigs} │ ${score}</code>\n`;
    });
    
    msg += `\n🔄 <i>Updates every 30 minutes</i>`;
    return msg;
  }

  /**
   * Format wallet leaderboard message
   * Public: redacted addresses (0x1a...3f4d)
   * Private: full addresses
   */
  formatWalletLeaderboard(wallets, isPublic = false) {
    const now = new Date().toUTCString().replace('GMT', 'UTC');
    
    let msg = `👛 <b>WALLET LEADERBOARD</b> (7d)\n`;
    msg += `<i>Updated: ${now}</i>\n\n`;
    
    if (isPublic) {
      // Redacted wallet addresses for public
      msg += `<code> # │ Wallet        │ Win% │ Entries │ ⭐</code>\n`;
      msg += `<code>───┼───────────────┼──────┼─────────┼────</code>\n`;
      
      wallets.forEach((w, i) => {
        const rank = String(i + 1).padStart(2);
        const addr = this.shortenAddress(w.addr).padEnd(13);
        const winRate = String(w.winRate || 0).padStart(3) + '%';
        const entries = String(w.scnt || 0).padStart(7);
        const stars = '⭐'.repeat(w.stars || 0) || '☆';
        msg += `<code>${rank} │ ${addr} │ ${winRate} │ ${entries} │</code>${stars}\n`;
      });
      
      msg += `\n🔓 <i>Full addresses in private channel</i>`;
      msg += `\n📈 <i>Based on 7-day performance</i>`;
    } else {
      // Full wallet addresses for private
      msg += `<code> # │ Wallet                        │ Win% │ Entries │ ⭐</code>\n`;
      msg += `<code>───┼───────────────────────────────┼──────┼─────────┼────</code>\n`;
      
      wallets.forEach((w, i) => {
        const rank = String(i + 1).padStart(2);
        const addr = (w.addr || '').slice(0, 28).padEnd(28);
        const winRate = String(w.winRate || 0).padStart(3) + '%';
        const entries = String(w.scnt || 0).padStart(7);
        const stars = '⭐'.repeat(w.stars || 0) || '☆';
        msg += `<code>${rank} │ ${addr} │ ${winRate} │ ${entries} │</code>${stars}\n`;
      });
      
      msg += `\n📈 <i>Based on 7-day performance</i>`;
    }
    
    return msg;
  }

  /**
   * Send or edit leaderboard message
   */
  async updateLeaderboardMessage(channelId, messageId, text) {
    if (messageId) {
      // Edit existing
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
        console.log(`   ⚠️ Edit failed, sending new: ${err.message}`);
      }
    }
    
    // Send new and pin
    const result = await this.api('sendMessage', {
      chat_id: channelId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    
    // Pin the new message
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
   * Update all leaderboards (called by cron)
   */
  async updateAll(allChainDBs) {
    console.log('🏆 Updating leaderboards...');
    
    // Load existing message IDs
    let ids = await this.loadMessageIds() || {
      private: { tokenLeaderboard: null, walletLeaderboard: null },
      public: { tokenLeaderboard: null, walletLeaderboard: null },
    };
    
    // Aggregate data from all chains
    const allTokens = [];
    const allWallets = [];
    
    for (const [chain, db] of Object.entries(allChainDBs)) {
      const tokens = db.getTopTokens(15).map(t => ({ ...t, chain }));
      const wallets = db.getTopWallets(15).map(w => ({ ...w, chain }));
      allTokens.push(...tokens);
      allWallets.push(...wallets);
    }
    
    // Sort combined lists
    const topTokens = allTokens
      .sort((a, b) => b.trendScore - a.trendScore)
      .slice(0, 15);
    
    const topWallets = allWallets
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, 15);
    
    // Update private channel
    console.log('   📝 Updating private leaderboards...');
    ids.private.tokenLeaderboard = await this.updateLeaderboardMessage(
      this.privateChannel,
      ids.private.tokenLeaderboard,
      this.formatTokenLeaderboard(topTokens, false)
    );
    
    ids.private.walletLeaderboard = await this.updateLeaderboardMessage(
      this.privateChannel,
      ids.private.walletLeaderboard,
      this.formatWalletLeaderboard(topWallets, false)
    );
    
    // Update public channel
    console.log('   📝 Updating public leaderboards...');
    ids.public.tokenLeaderboard = await this.updateLeaderboardMessage(
      this.publicChannel,
      ids.public.tokenLeaderboard,
      this.formatTokenLeaderboard(topTokens, true)
    );
    
    ids.public.walletLeaderboard = await this.updateLeaderboardMessage(
      this.publicChannel,
      ids.public.walletLeaderboard,
      this.formatWalletLeaderboard(topWallets, true)
    );
    
    // Save updated message IDs
    await this.saveMessageIds(ids);
    
    console.log('   ✅ Leaderboards updated');
    return { topTokens, topWallets };
  }

  // Helpers
  shortenAddress(addr) {
    if (!addr || addr.length < 10) return addr || '???';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  }

  getWeekRange() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const format = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${format(weekAgo)} - ${format(now)}`;
  }
}

// ============================================================
// EXPORTS
// ============================================================

export default TelegramDBv5;
