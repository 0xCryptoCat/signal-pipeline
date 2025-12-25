# File-Based TelegramDB v5 - Design Document

> Created: 2025-12-25

## Overview

Replace message-based storage (3800 char limit) with file-based storage (50MB limit) using JSON documents attached to Telegram channel messages.

## Performance Benchmarks

| Operation | Time | Notes |
|-----------|------|-------|
| Upload 31KB | 519ms | 50 tokens, 100 wallets |
| Download | 271ms | |
| Update (editMessageMedia) | 215ms | In-place, no new message |
| Large upload 106KB | 309ms | 500 tokens, 500 wallets |

## Channel Architecture

### Current (17 channels)
```
Per chain (4 chains × 4 types):
- index-{chain}    → Pinned message with JSON text
- signals-{chain}  → Individual signal messages
- tokens-{chain}   → Token aggregate messages
- wallets-{chain}  → Wallet aggregate messages

Plus:
- archive          → Archived records
```

### New (5 channels total)
```
┌─────────────────────────────────────────────────────────────────┐
│  SIMPLIFIED CHANNEL STRUCTURE                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  db-sol (-1003359608037)     ← Reuse index-sol channel         │
│  ├── Message 1 (Pinned): 📊 SOL Database                       │
│  │   └── Attached: sol-db.json (all SOL data)                  │
│  │                                                              │
│  db-eth (-1003584605646)     ← Reuse index-eth channel         │
│  ├── Message 1 (Pinned): 📊 ETH Database                       │
│  │   └── Attached: eth-db.json                                 │
│  │                                                              │
│  db-bsc (-1003672339048)     ← Reuse index-bsc channel         │
│  ├── Message 1 (Pinned): 📊 BSC Database                       │
│  │   └── Attached: bsc-db.json                                 │
│  │                                                              │
│  db-base (-1003269677620)    ← Reuse index-base channel        │
│  ├── Message 1 (Pinned): 📊 BASE Database                      │
│  │   └── Attached: base-db.json                                │
│  │                                                              │
│  leaderboard (-1003645445736) ← Reuse archive channel          │
│  ├── Message 1 (Pinned): 🏆 Leaderboard                        │
│  │   └── Attached: leaderboard.json (all chains combined)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Schema

### Per-Chain Database (sol-db.json, etc.)

```typescript
interface ChainDatabase {
  // Metadata
  chain: string;           // 'sol' | 'eth' | 'bsc' | 'base'
  chainId: number;         // 501 | 1 | 56 | 8453
  updatedAt: number;       // Timestamp
  version: number;         // Schema version
  
  // Dedup (for cold start recovery)
  lastSigs: string[];      // Last 200 signal keys
  
  // Active tokens (unlimited now!)
  tokens: {
    [address: string]: TokenData;
  };
  
  // Wallet aggregates
  wallets: {
    [address: string]: WalletData;
  };
  
  // Recent signals (last 7 days, for reference)
  recentSignals: SignalData[];
}

interface TokenData {
  sym: string;              // Symbol
  p0: number;               // Entry price (first signal)
  pNow: number;             // Current price
  pPeak: number;            // All-time high since tracking
  pLow: number;             // All-time low since tracking
  scnt: number;             // Signal count
  avgScr: number;           // Average signal score
  firstSeen: number;        // First signal timestamp
  lastSig: number;          // Last signal timestamp
  lastMsgId: number;        // For reply chaining
  rugged: boolean;          // Liquidity dried up
  ruggedAt?: number;        // When rugged
  
  // Performance
  mult: number;             // Current multiplier (pNow/p0)
  peakMult: number;         // Peak multiplier (pPeak/p0)
  
  // Participating wallets (for leaderboard)
  wallets: string[];        // Wallet addresses that bought
}

interface WalletData {
  scnt: number;             // Signal count (participated)
  avgScr: number;           // Average entry score
  winRate: number;          // % of tokens that went up
  avgPeak: number;          // Average peak multiplier
  totalPnl: number;         // Estimated total PnL %
  lastSeen: number;         // Last activity
  tags: string[];           // ['smartMoney', 'whale', etc.]
  
  // Token participation
  tokens: {
    [prefix: string]: {     // First 8 chars of token addr
      entry: number;        // Entry price
      peak: number;         // Peak seen
      score: number;        // Entry score
    };
  };
  
  // Reputation
  stars: number;            // 0-3 stars based on performance
  consistency: number;      // Score consistency %
}

interface SignalData {
  id: string;               // Signal key
  token: string;            // Token address
  sym: string;              // Token symbol
  time: number;             // Signal time
  price: number;            // Price at signal
  avgScr: number;           // Average wallet score
  wallets: number;          // Wallet count
  msgId: number;            // Telegram message ID
}
```

### Leaderboard Database (leaderboard.json)

```typescript
interface LeaderboardDatabase {
  updatedAt: number;
  
  // Top wallets per chain
  wallets: {
    sol: WalletRank[];
    eth: WalletRank[];
    bsc: WalletRank[];
    base: WalletRank[];
    all: WalletRank[];      // Cross-chain combined
  };
  
  // Top tokens per chain (by performance)
  tokens: {
    sol: TokenRank[];
    eth: TokenRank[];
    bsc: TokenRank[];
    base: TokenRank[];
  };
  
  // Statistics
  stats: {
    totalSignals: number;
    totalTokens: number;
    totalWallets: number;
    avgWinRate: number;
    topPerformer: TokenRank;
  };
}

interface WalletRank {
  rank: number;
  addr: string;             // Full address
  short: string;            // First 6 + last 4
  scnt: number;             // Signal count
  winRate: number;          // Win rate %
  avgPeak: number;          // Average peak multiplier
  stars: number;            // 0-3 stars
  chain: string;            // Primary chain
}

interface TokenRank {
  rank: number;
  addr: string;
  sym: string;
  chain: string;
  peakMult: number;         // Best multiplier achieved
  scnt: number;             // Signal count
  wallets: number;          // Unique wallets
  age: string;              // Human readable age
}
```

## API Design

### TelegramDBv5 Class

```typescript
class TelegramDBv5 {
  constructor(botToken: string, chainId: number);
  
  // Core operations
  async load(): Promise<ChainDatabase>;
  async save(data: ChainDatabase): Promise<void>;
  
  // Token operations
  async upsertToken(addr: string, data: Partial<TokenData>): Promise<void>;
  async getToken(addr: string): Promise<TokenData | null>;
  async removeToken(addr: string): Promise<void>;
  
  // Wallet operations
  async upsertWallet(addr: string, data: Partial<WalletData>): Promise<void>;
  async getWallet(addr: string): Promise<WalletData | null>;
  
  // Signal operations
  async addSignal(signal: SignalData): Promise<void>;
  isSignalSeen(key: string): boolean;
  
  // Leaderboard
  async updateLeaderboard(): Promise<void>;
  async getTopWallets(limit?: number): Promise<WalletRank[]>;
  async getTopTokens(limit?: number): Promise<TokenRank[]>;
  
  // Utilities
  async cleanup(): Promise<{ removed: number }>;
}
```

## Operation Flow

### Signal Processing (poll-*.js)

```
1. db.load()                    ← Download JSON from pinned message
2. For each signal:
   a. Check db.isSignalSeen()   ← Check lastSigs array
   b. Process signal
   c. db.upsertToken()          ← Update token data
   d. db.upsertWallet()         ← Update wallet data  
   e. db.addSignal()            ← Add to recentSignals
3. db.save()                    ← Upload updated JSON (editMessageMedia)
```

### Price Updates (update-prices.js)

```
1. For each chain:
   a. db.load()
   b. Fetch prices from DexScreener
   c. For each token in db.tokens:
      - Update pNow, mult, check ATH/ATL
      - Detect rugged (liquidity check)
   d. db.save()
2. Post performance message to public channel
```

### Leaderboard Update (new: update-leaderboard.js)

```
1. Load all 4 chain databases
2. Aggregate wallet stats across chains
3. Rank by: winRate (40%), avgPeak (30%), scnt (30%)
4. Rank tokens by: peakMult (50%), scnt (30%), wallets (20%)
5. Save to leaderboard channel
6. Optionally post top 10 to public channel
```

## Leaderboard Ranking Algorithm

### Wallet Score (for ranking)
```javascript
function calcWalletScore(wallet) {
  // Weights
  const W_WINRATE = 0.40;   // 40% weight on win rate
  const W_AVGPEAK = 0.30;   // 30% weight on average peak
  const W_ACTIVITY = 0.30;  // 30% weight on activity
  
  // Normalize values (0-1 scale)
  const winRateNorm = wallet.winRate;  // Already 0-1
  const avgPeakNorm = Math.min(wallet.avgPeak / 3, 1);  // Cap at 3x
  const activityNorm = Math.min(wallet.scnt / 20, 1);   // Cap at 20 signals
  
  return (winRateNorm * W_WINRATE) + 
         (avgPeakNorm * W_AVGPEAK) + 
         (activityNorm * W_ACTIVITY);
}
```

### Token Score (for ranking)
```javascript
function calcTokenScore(token) {
  const W_PEAK = 0.50;      // 50% weight on peak performance
  const W_SIGNALS = 0.30;   // 30% weight on signal count
  const W_WALLETS = 0.20;   // 20% weight on wallet participation
  
  const peakNorm = Math.min(token.peakMult / 5, 1);  // Cap at 5x
  const signalsNorm = Math.min(token.scnt / 10, 1);  // Cap at 10
  const walletsNorm = Math.min(token.wallets.length / 5, 1);  // Cap at 5
  
  return (peakNorm * W_PEAK) + 
         (signalsNorm * W_SIGNALS) + 
         (walletsNorm * W_WALLETS);
}
```

## Migration Plan

### Phase 1: Create New DB Class (telegram-db-v5.js)
- Implement file upload/download
- Implement load/save with pinned message
- Keep backward compatible with v4 data

### Phase 2: Migrate poll-*.js endpoints
- Load from v5, fall back to v4 if no file exists
- Save to v5 format
- First save migrates data automatically

### Phase 3: Migrate update-prices.js
- Use v5 for price updates
- Unlimited token tracking

### Phase 4: Add Leaderboard
- New update-leaderboard.js endpoint
- Aggregate across chains
- Post to public channel weekly

### Phase 5: Cleanup
- Remove old v4 messages from channels
- Remove signals/tokens/wallets channels (optional)
- Update documentation

## File Format Comparison

| Format | Size (500 tokens) | Parse Time | Pros | Cons |
|--------|-------------------|------------|------|------|
| JSON | 106 KB | Fast | Native JS, readable | Larger size |
| JSON minified | 85 KB | Fast | Smaller | Less readable |
| MessagePack | ~70 KB | Fast | Smallest | Requires library |

**Recommendation**: Use minified JSON (no spaces). It's:
- Fast to parse (native)
- Small enough (106KB is tiny)
- Human-readable for debugging
- No extra dependencies

## Estimated Implementation Time

| Task | Time |
|------|------|
| telegram-db-v5.js core | 1 hour |
| Migrate poll endpoints | 30 min |
| Migrate update-prices | 30 min |
| Leaderboard endpoint | 1 hour |
| Testing & debugging | 1 hour |
| **Total** | **4 hours** |

## Questions to Resolve

1. **Channel reuse**: Reuse index-* channels or create new db-* channels?
2. **Migration**: Auto-migrate on first load or manual migration script?
3. **Leaderboard frequency**: Real-time update or scheduled (daily/weekly)?
4. **Public posting**: Post leaderboard to public channel? How often?
