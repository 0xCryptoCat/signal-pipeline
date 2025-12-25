# File-Based TelegramDB v5 - Final Design

> Created: 2025-12-25 | Revised: 2025-12-25

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SIGNAL PIPELINE SYSTEM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  POLLING LAYER (api/poll-*.js)                                 │
│  ├─ poll-solana.js  [every 2min]                               │
│  ├─ poll-eth.js     [every 5min]                               │
│  ├─ poll-bsc.js     [every 5min]                               │
│  └─ poll-base.js    [every 5min]                               │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────┐                   │
│  │  DATABASE LAYER (lib/telegram-db-v5.js) │                   │
│  │  ├─ db-sol (file in index-sol channel)  │                   │
│  │  ├─ db-eth (file in index-eth channel)  │                   │
│  │  ├─ db-bsc (file in index-bsc channel)  │                   │
│  │  └─ db-base (file in index-base channel)│                   │
│  └─────────────────────────────────────────┘                   │
│       │                                                         │
│       ▼                                                         │
│  OUTPUT CHANNELS                                                │
│  ├─ PRIVATE: -1003474351030 (signals + leaderboards pinned)    │
│  └─ PUBLIC:  -1003627230339 (signals redacted + leaderboards)│
│                                                                 │
│  UPDATE LAYER                                                   │
│  ├─ api/update-prices.js   [every 15min]  → price tracking     │
│  └─ api/update-leaderboard.js [every 30min] → rank recalc      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Channel Allocation

### DATABASE CHANNELS (4 channels - reuse index-*)

| Channel | ID | Purpose | File |
|---------|-----|---------|------|
| index-sol | `-1003359608037` | SOL database | `sol-db.json` |
| index-eth | `-1003584605646` | ETH database | `eth-db.json` |
| index-bsc | `-1003672339048` | BSC database | `bsc-db.json` |
| index-base | `-1003269677620` | BASE database | `base-db.json` |

### SIGNAL + LEADERBOARD CHANNELS

| Channel | ID | Purpose |
|---------|-----|----------|
| **PRIVATE** | `-1003474351030` | Signals (full), price updates, pinned leaderboards (full) |
| **PUBLIC** | `-1003627230339` | Same signals (redacted wallets), pinned leaderboards (redacted) |
| archive | `-1003645445736` | Data archival only |

### ARCHIVED (12 channels - rename, keep data)

All `signals-*`, `tokens-*`, `wallets-*` channels renamed with `_archive_` prefix.

---

## Ranking Algorithms

### Token "Trending" Score (for Top 10-15 per chain)

```javascript
function calcTokenTrendingScore(token, now = Date.now()) {
  const hoursSinceLastSignal = (now - token.lastSig) / (60 * 60 * 1000);
  
  // Recency: decay over 48 hours (0-1)
  const recencyBoost = Math.max(0, 1 - (hoursSinceLastSignal / 48));
  
  // Signal momentum: cap at 5 signals (0-1)
  const signalMomentum = Math.min(token.scnt / 5, 1);
  
  // Performance: gains boost, losses penalize (0-1)
  const perfFactor = token.mult >= 1 
    ? Math.min(token.mult / 2, 1)
    : 0.5 * token.mult;
  
  // Wallet interest: cap at 3 wallets (0-1)
  const walletFactor = Math.min((token.wallets?.length || 1) / 3, 1);
  
  // Entry quality: normalize -2 to +2 → 0 to 1
  const qualityFactor = (token.avgScr + 2) / 4;
  
  // Weighted score
  let score = (
    recencyBoost * 0.30 +      // 30% recency
    signalMomentum * 0.25 +    // 25% signals
    perfFactor * 0.20 +        // 20% performance
    walletFactor * 0.15 +      // 15% wallets
    qualityFactor * 0.10       // 10% quality
  );
  
  // Heavy penalty for rugged tokens
  if (token.rugged) score *= 0.1;
  
  return score;
}
```

### Wallet Rank Score (using entry_score + entry_count)

```javascript
function calcWalletRankScore(wallet, tokenPeaks = {}) {
  // Entry score (your original scoring): -2 to +2, normalized to 0-1
  const entryScore = wallet.avgScr || 0;
  const entryScoreNorm = (entryScore + 2) / 4;
  
  // Entry count: sqrt for diminishing returns (prevents whale dominance)
  const entryCountFactor = Math.sqrt(Math.min(wallet.scnt, 50)) / Math.sqrt(50);
  
  // Win rate from actual token peaks (7d performance)
  let wins = 0, total = 0;
  for (const [prefix, data] of Object.entries(wallet.tokens || {})) {
    const peak = tokenPeaks[prefix];
    if (peak) {
      total++;
      if (peak >= 1.25) wins++; // 25%+ gain = win
    }
  }
  const winRate = total > 0 ? wins / total : 0.5;
  
  // Consistency: low variance = reliable
  const consistencyFactor = (wallet.consistency || 50) / 100;
  
  // Final score
  return (
    entryScoreNorm * 0.40 +      // 40% entry score (most important)
    entryCountFactor * 0.20 +    // 20% participation
    winRate * 0.25 +             // 25% actual performance
    consistencyFactor * 0.15     // 15% consistency
  );
}
```

### Stars Display

```javascript
function calcWalletStars(wallet, tokenPeaks) {
  const score = calcWalletRankScore(wallet, tokenPeaks);
  const winRate = calcWinRate(wallet, tokenPeaks);
  const avgPeak = calcAvgPeak(wallet, tokenPeaks);
  
  // ⭐⭐⭐ Elite: score > 0.7 AND winRate > 60% AND avgPeak > 1.5x
  if (score > 0.7 && winRate > 0.6 && avgPeak > 1.5) return 3;
  
  // ⭐⭐ Good: score > 0.5 AND winRate > 50%
  if (score > 0.5 && winRate > 0.5) return 2;
  
  // ⭐ Decent: score > 0.3 OR winRate > 40%
  if (score > 0.3 || winRate > 0.4) return 1;
  
  return 0;
}
```

---

## Cron Schedule

| Endpoint | Interval | Purpose | Resource Priority |
|----------|----------|---------|-------------------|
| `/api/poll-solana` | 2 min | Poll SOL signals | HIGH |
| `/api/poll-eth` | 5 min | Poll ETH signals | MEDIUM |
| `/api/poll-bsc` | 5 min | Poll BSC signals | MEDIUM |
| `/api/poll-base` | 5 min | Poll Base signals | MEDIUM |
| `/api/update-prices` | 15 min | Price tracking | MEDIUM |
| `/api/update-leaderboard` | **30 min** | Rank recalc + leaderboard edit | LOW |
| `/api/cleanup` | Daily 04:00 | Prune old data | LOW |

**Note:** Leaderboard runs every 30min to keep data fresh without hogging resources.
The leaderboard EDITS existing pinned messages (no new messages sent).

---

## Leaderboard System

### Pinned Messages (EDIT, not re-send)

**Private Channel** (`-1003474351030`) - 2 pinned messages:
1. **Token Leaderboard** - Top 15 trending tokens (full data)
2. **Wallet Leaderboard** - Top 15 wallets (full addresses + full stats)

**Public Channel** (`-1003627230339`) - 2 pinned messages:
1. **Token Leaderboard** - Same format (full data - tokens aren't sensitive)
2. **Wallet Leaderboard** - Same format but REDACTED addresses (0x1a...3f4d)

### Leaderboard Update Flow

```
update-leaderboard.js (every 30min)
    │
    ├─► Load all 4 chain DBs (sol, eth, bsc, base)
    │
    ├─► Calculate rankings:
    │   ├─ Token trending scores (all chains combined)
    │   └─ Wallet rank scores (7d window)
    │
    ├─► EDIT pinned messages (editMessageText):
    │   ├─ Private: full wallet addresses
    │   └─ Public: redacted wallet addresses (0x1a...3f4d)
    │
    └─► Save leaderboard cache to archive channel
```

### Message IDs Storage

Leaderboard message IDs stored in environment or archive channel:
```javascript
// Stored in archive channel as pinned JSON file
{
  "private": {
    "tokenLeaderboard": 12345,    // message_id in -1003474351030
    "walletLeaderboard": 12346
  },
  "public": {
    "tokenLeaderboard": 23456,    // message_id in -1003627230339
    "walletLeaderboard": 23457
  }
}
```

### Private Leaderboard Format

```
📊 TOKEN LEADERBOARD (Live)
Updated: Dec 25, 2025 14:30 UTC

 # │ Token │ Chain │ Peak │ Signals │ Score
───┼───────┼───────┼──────┼─────────┼──────
 1 │ $PEPE │  SOL  │ 5.5x │    8    │ 0.92
 2 │ $BONK │  SOL  │ 3.8x │    5    │ 0.85
 3 │ $WIF  │  ETH  │ 2.8x │    4    │ 0.78
...
15 │ $DOGE │  BSC  │ 1.3x │    2    │ 0.41

🔄 Updates every 30 minutes
```

```
👛 WALLET LEADERBOARD (7d)
Updated: Dec 25, 2025 14:30 UTC

 # │ Wallet                        │ Win% │ Entries │ ⭐
───┼───────────────────────────────┼──────┼─────────┼────
 1 │ 0x1a2b3c4d5e6f7a8b9c0d1e2f... │  85% │    47   │⭐⭐⭐
 2 │ 0x7b8c9d0e1f2a3b4c5d6e7f8a... │  78% │    32   │⭐⭐⭐
 3 │ 0x3c4d5e6f7a8b9c0d1e2f3a4b... │  65% │    28   │⭐⭐
...
15 │ 0xf1e2d3c4b5a6978685746352... │  42% │    12   │⭐

📈 Based on 7-day performance
```

### Public Leaderboard Format (Redacted Wallets Only)

```
📊 TOKEN LEADERBOARD (Live)
Updated: Dec 25, 2025 14:30 UTC

 # │ Token │ Chain │ Peak │ Signals │ Score
───┼───────┼───────┼──────┼─────────┼──────
 1 │ $PEPE │  SOL  │ 5.5x │    8    │ 0.92
 2 │ $BONK │  SOL  │ 3.8x │    5    │ 0.85
 3 │ $WIF  │  ETH  │ 2.8x │    4    │ 0.78
...
15 │ $DOGE │  BSC  │ 1.3x │    2    │ 0.41

🔄 Updates every 30 minutes
```

```
👛 WALLET LEADERBOARD (7d)
Updated: Dec 25, 2025 14:30 UTC

 # │ Wallet        │ Win% │ Entries │ ⭐
───┼───────────────┼──────┼─────────┼────
 1 │ 0x1a...3f4d   │  85% │    47   │⭐⭐⭐
 2 │ 0x7b...9e2c   │  78% │    32   │⭐⭐⭐
 3 │ 0x3c...1a8b   │  65% │    28   │⭐⭐
...
15 │ 0xf1...6352   │  42% │    12   │⭐

🔓 Full addresses in private channel
📈 Based on 7-day performance
```

---

## Data Schema

### Per-Chain Database (sol-db.json)

```typescript
{
  chain: "sol",
  chainId: 501,
  version: 5,
  updatedAt: 1735123456789,
  
  // Dedup (last 200 signal keys)
  lastSigs: ["sig_123_0", "sig_124_0", ...],
  
  // All tokens (unlimited)
  tokens: {
    "TokenAddress123...": {
      sym: "PEPE",
      p0: 0.001,           // Entry price
      pNow: 0.0025,        // Current price
      pPeak: 0.003,        // ATH since signal
      pLow: 0.0008,        // ATL since signal
      mult: 2.5,           // Current multiplier
      peakMult: 3.0,       // Peak multiplier
      scnt: 5,             // Signal count
      avgScr: 1.2,         // Average signal score
      firstSeen: 173500000,
      lastSig: 1735100000,
      lastMsgId: 1234,
      rugged: false,
      wallets: ["0x1...", "0x2..."]  // Participating wallets
    }
  },
  
  // All wallets
  wallets: {
    "0xWalletAddress...": {
      scnt: 15,            // Entry count
      avgScr: 1.5,         // Average entry score
      consistency: 75,     // Score consistency %
      lastSeen: 1735100000,
      tags: ["smartMoney", "whale"],
      tokens: {
        "Token123": { entry: 0.001, peak: 0.003, score: 1.8 },
        "Token456": { entry: 0.05, peak: 0.08, score: 1.2 }
      }
    }
  },
  
  // Recent signals (last 7 days, for display)
  recentSignals: [
    { id: "sig_123_0", token: "addr", sym: "PEPE", time: 173500000, price: 0.001, avgScr: 1.2, msgId: 1234 }
  ]
}
```

### Leaderboard Database (leaderboard.json)

```typescript
{
  updatedAt: 1735123456789,
  
  // Top tokens per chain (trending)
  trendingTokens: {
    sol: [{ rank: 1, addr, sym, trendScore, peakMult, scnt, wallets }],
    eth: [...],
    bsc: [...],
    base: [...]
  },
  
  // Top wallets per chain (by rank score)
  topWallets: {
    sol: [{ rank: 1, addr, short, rankScore, winRate, scnt, stars }],
    eth: [...],
    bsc: [...],
    base: [...],
    all: [...]  // Cross-chain combined
  },
  
  // Weekly best signals (for public)
  weeklyTopSignals: {
    sol: [{ sym, peakMult, wallets, avgScr, msgId }],
    eth: [...],
    bsc: [...],
    base: [...]
  }
}
```

---

## Migration Strategy

1. **Auto-migrate on first load**:
   - Check if file exists in channel (pinned doc)
   - If no: load v4 data from pinned message, convert, save as file
   - If yes: load file directly

2. **Data preserved**:
   - lastSigs (dedup)
   - trackedTokens → tokens (with full history)
   - wallet data from index

3. **Leaderboard initialization**:
   - First run: send new messages and pin them (save message IDs)
   - Subsequent runs: edit existing messages using saved IDs

---

## Implementation Order

1. `lib/telegram-db-v5.js` - Core file-based DB class
2. Migrate `api/poll-*.js` endpoints to use v5
3. Migrate `api/update-prices.js` to use v5
4. New `api/update-leaderboard.js` - ranking + message edit
5. Update vercel.json with leaderboard cron
6. Archive old test scripts via .gitignore
7. Test & deploy

---

## File Structure After Implementation

```
signal-pipeline/
├── api/
│   ├── poll-solana.js       # Uses v5 DB
│   ├── poll-eth.js          # Uses v5 DB
│   ├── poll-bsc.js          # Uses v5 DB
│   ├── poll-base.js         # Uses v5 DB
│   ├── update-prices.js     # Uses v5 DB
│   ├── update-leaderboard.js # NEW - ranking system
│   ├── health.js            # Health check
│   └── cleanup.js           # Data pruning
├── lib/
│   ├── telegram-db-v5.js    # NEW - file-based DB
│   ├── db-integration.js    # Updated for v5
│   ├── price-fetcher.js     # No change
│   └── telegram-db-v4.js    # DEPRECATED (keep for reference)
├── docs/
│   └── FILE-DB-V5-FINAL.md  # This document
├── _archive/                 # OLD test scripts (git-ignored)
│   ├── test-*.js
│   ├── audit-*.js
│   ├── analyze-*.js
│   └── diagnostic.js
├── index.js                  # Main signal processing
├── vercel.json
├── package.json
└── .gitignore
```
