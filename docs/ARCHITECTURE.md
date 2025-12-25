# Signal Pipeline - System Architecture

> Last Updated: 2025-12-25

## Overview

The Signal Pipeline monitors smart money activity across 4 chains and posts trading signals to Telegram.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRON TRIGGERS                            │
│  cron-job.org pings Vercel endpoints at scheduled intervals     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     VERCEL SERVERLESS FUNCTIONS                 │
├──────────────────┬──────────────────┬───────────────────────────┤
│ /api/poll-solana │ /api/poll-eth    │ /api/poll-bsc             │
│ (every 2 min)    │ (every 5 min)    │ (every 5 min)             │
├──────────────────┴──────────────────┴───────────────────────────┤
│ /api/poll-base   │ /api/update-prices │ /api/cleanup            │
│ (every 5 min)    │ (every 15 min)     │ (daily 04:00 UTC)       │
└──────────────────┴────────────────────┴─────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                             │
├─────────────────────────────────────────────────────────────────┤
│ OKX Signal API ──────► Filter Activity (smart money trades)    │
│ OKX Candles API ─────► OHLC prices for scoring                 │
│ DexScreener API ─────► Current prices + liquidity              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TELEGRAM OUTPUT                             │
├─────────────────────────────────────────────────────────────────┤
│ Public Channel ──► -1003474351030 (Smart Signals)              │
│ Archive Channel ─► -1003645445736 (Signal Archive)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cron Jobs (cron-job.org)

| Endpoint | Interval | Purpose | Status |
|----------|----------|---------|--------|
| `/api/poll-solana` | 2 min | Poll Solana signals | ✅ Working |
| `/api/poll-eth` | 5 min | Poll ETH signals | ✅ Working |
| `/api/poll-bsc` | 5 min | Poll BSC signals | ✅ Working |
| `/api/poll-base` | 5 min | Poll Base signals | ✅ Working |
| `/api/update-prices` | 15 min | Performance tracking | ⚠️ Was timing out |
| `/api/cleanup` | Daily 04:00 UTC | Archive old signals | ❓ Check logs |
| `/api/health` | 1 min (optional) | Keepalive ping | Optional |

### Why update-prices keeps going inactive

**ROOT CAUSE**: `update-prices.js` was NOT in `vercel.json` maxDuration config!
- Vercel default timeout = 10 seconds
- update-prices processes 4 chains = takes 15-30+ seconds
- Timeouts cause cron-job.org to mark job as "failed"
- After X failures, cron-job.org marks job as "inactive"

**FIX APPLIED**: Added `"api/update-prices.js": { "maxDuration": 60 }` to vercel.json

---

## TelegramDB Channel Architecture

Each chain has 4 dedicated channels for structured data storage:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PER-CHAIN CHANNELS                           │
├─────────────┬───────────────┬───────────────┬───────────────────┤
│   SOLANA    │   ETHEREUM    │     BSC       │      BASE         │
├─────────────┼───────────────┼───────────────┼───────────────────┤
│ index-sol   │ index-eth     │ index-bsc     │ index-base        │
│ signals-sol │ signals-eth   │ signals-bsc   │ signals-base      │
│ tokens-sol  │ tokens-eth    │ tokens-bsc    │ tokens-base       │
│ wallets-sol │ wallets-eth   │ wallets-bsc   │ wallets-base      │
└─────────────┴───────────────┴───────────────┴───────────────────┘
```

### Channel IDs

| Chain | Index | Signals | Tokens | Wallets |
|-------|-------|---------|--------|---------|
| SOL | -1003359608037 | -1003683149932 | -1003300774874 | -1003664436076 |
| ETH | -1003584605646 | -1003578324311 | -1003359979587 | -1003674004589 |
| BSC | -1003672339048 | -1003512733161 | -1003396432095 | -1003232990934 |
| BASE | -1003269677620 | -1003646542784 | -1003510261312 | -1003418587058 |

### Channel Purposes

| Channel Type | Purpose | Retention | Pinned? |
|--------------|---------|-----------|---------|
| **index** | Dedup, tracked tokens, aggregates | Permanent | YES (critical!) |
| **signals** | Individual signal records | 7 days | No |
| **tokens** | Token aggregate data | 30 days | No |
| **wallets** | Wallet aggregate data | 7-30 days | No |
| **archive** | Archived/expired records | Permanent | No |

---

## Data Flow - Signal Processing

```
1. CRON TRIGGERS /api/poll-{chain}
         │
         ▼
2. LOAD INDEX from pinned message
   ├── Get lastSigs (dedup list)
   └── Get trackedTokens (for perf tracking)
         │
         ▼
3. FETCH SIGNALS from OKX
   └── Filter by trend=1, pageSize=5
         │
         ▼
4. FOR EACH SIGNAL:
   ├── Check dedup (skip if in lastSigs)
   ├── Fetch wallet details from OKX
   ├── Score each wallet entry (-2 to +2)
   ├── Calculate avg signal score
   ├── Filter by score threshold (skip if avg < 0.3)
   │
   ▼
5. FORMAT & SEND MESSAGE
   ├── Build signal message with wallet details
   ├── Add inline buttons (DexTools, DexScreener)
   ├── Reply to previous signal for same token (chaining)
   └── Post to public channel
         │
         ▼
6. STORE DATA
   ├── Store signal record in signals-{chain}
   ├── Upsert token aggregate in tokens-{chain}
   ├── Upsert wallet aggregates in wallets-{chain}
   └── Update index (dedup list, tracked tokens)
         │
         ▼
7. PIN INDEX (for cold start recovery)
   └── Edit + pin index message in index-{chain}
```

---

## Data Flow - Performance Updates

```
1. CRON TRIGGERS /api/update-prices
         │
         ▼
2. FOR EACH CHAIN:
   ├── Load index from pinned message
   ├── Get trackedTokens array
   │
   ▼
3. BATCH FETCH PRICES from DexScreener
   └── Get current price + liquidity for all tokens
         │
         ▼
4. FOR EACH TOKEN:
   ├── Calculate multiplier (current / entry price)
   ├── Check if NEW ATH or NEW ATL
   ├── Check if RUGGED (liquidity < $1000)
   ├── Decide if should report
   │
   ▼
5. AGGREGATE & SEND MESSAGE
   ├── Group all performers across chains
   ├── Format aggregated performance message
   └── Post to public channel
         │
         ▼
6. SAVE UPDATED INDEX
   └── Pin index with updated pPeak/pLow values
```

---

## Index Structure (Pinned Message)

The index is the MOST IMPORTANT data structure - it survives cold starts.

```json
{
  "c": 501,                    // Chain ID
  "lastSigs": [                // Dedup list (last 100 signal keys)
    "sig_1734567890_0",
    "sig_1734567891_0"
  ],
  "totalSigs": 156,            // Total signals processed
  "totalToks": 45,             // Total unique tokens seen
  "totalWals": 89,             // Total unique wallets seen
  "lastUpdate": 1734567890000, // Last update timestamp
  "trackedTokens": [           // Active tokens for perf tracking
    {
      "addr": "So11111...",    // Token address
      "sym": "SOL",            // Token symbol
      "p0": 100.50,            // Entry price (first signal)
      "pPeak": 125.00,         // All-time high since signal
      "pLow": 95.00,           // All-time low since signal
      "scnt": 3,               // Signal count
      "avgScr": 1.2,           // Average signal score
      "firstSeen": 1734500000, // First signal timestamp
      "lastSig": 1734567000,   // Last signal timestamp
      "lastMsgId": 123,        // Telegram msg ID (for reply chaining)
      "rugged": false,         // Rugged flag
      "ruggedAt": null         // When rugged detected
    }
  ],
  "tokenPeaks": {              // Peak multipliers for wallet win rate
    "So111111": { "peak": 1.5, "entry": 100, "sym": "SOL" }
  }
}
```

---

## Known Issues & Status

| Issue | Status | Fix |
|-------|--------|-----|
| update-prices timing out | ✅ FIXED | Added to vercel.json maxDuration |
| BSC index has no pin | ⚠️ Will auto-fix | Next signal will create it |
| SOL/ETH index not updated | 🔍 Investigate | May be no signals in period |
| Cleanup not archiving | 🔍 Investigate | Check cron-job.org logs |

---

## File Structure

```
signal-pipeline/
├── api/
│   ├── poll-solana.js      # Solana signal polling
│   ├── poll-eth.js         # ETH signal polling
│   ├── poll-bsc.js         # BSC signal polling
│   ├── poll-base.js        # Base signal polling
│   ├── update-prices.js    # Performance tracking
│   ├── cleanup.js          # Archive old signals
│   └── health.js           # Health check endpoint
├── lib/
│   ├── telegram-db-v4.js   # TelegramDB storage layer
│   ├── db-integration.js   # High-level DB wrapper
│   └── price-fetcher.js    # DexScreener API
├── index.js                # Main signal processing logic
├── vercel.json             # Vercel config (timeouts)
└── diagnostic.js           # Channel health diagnostics
```

---

## Scoring Logic

### Entry Score (-2 to +2)

Scores wallet ENTRIES (buys) based on price action after purchase:

| Score | Condition | Meaning |
|-------|-----------|---------|
| +2 | Rose >25% after buy | Excellent timing |
| +1 | Rose 10-25% after buy | Good timing |
| 0 | Flat (-10% to +10%) | Neutral |
| -1 | Dropped 10-25% after buy | Poor timing |
| -2 | Dropped >25% after buy | Terrible timing |

### Signal Score

Currently: **Average of all wallet entry scores**

Future: May weight by wallet reputation, consistency, etc.

### Performance Reporting

| Tier | Multiplier | Emoji | Report When |
|------|------------|-------|-------------|
| MOON | ≥2.0x | 🌙 | New ATH |
| ROCKET | ≥1.5x | 🚀 | New ATH |
| GOOD | ≥1.25x | 📈 | New ATH |
| BAD | ≤0.75x | 📉 | New ATL |
| DUMP | ≤0.5x | 💀 | New ATL |
| RUGGED | liq <$1k | 🪦 | First detection |

---

## Next Steps (Planned)

1. **Public Channel Broadcast** - Simplified messages for marketing
2. **Wallet Leaderboard** - Build from topWals in index
3. **File-Based Storage** - Use Telegram documents instead of messages
4. **Signal Scoring Evaluation** - Validate avg wallet score approach
