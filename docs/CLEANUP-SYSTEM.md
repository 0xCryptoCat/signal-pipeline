# Cleanup System - Design Document

## Overview

Manage Telegram channel data lifecycle:
1. Archive expired records before deletion
2. Aggregate stats to index before archiving
3. Maintain channel health (not too many messages)
4. Preserve historical insights in archive

---

## Retention Policies

| Record Type | Retention | Condition |
|-------------|-----------|-----------|
| Signals | 7 days | Always |
| Tokens | 30 days | If no signal in 30d |
| Wallets (high score ≥0.5) | 30 days | From last appearance |
| Wallets (low score <0.5) | 7 days | From last appearance |
| Index | Forever | Never delete |
| Archive | Forever | Historical record |

---

## Cleanup Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLEANUP PIPELINE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CRON: Daily at 00:00 UTC                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ For each chain:                                             │   │
│  │                                                             │   │
│  │ 1. SIGNALS CLEANUP                                          │   │
│  │    - Find signals with _exp < now                           │   │
│  │    - Aggregate final stats to index                         │   │
│  │    - Archive to archive-all channel                         │   │
│  │    - Delete from signals-{chain} channel                    │   │
│  │                                                             │   │
│  │ 2. TOKENS CLEANUP                                           │   │
│  │    - Find tokens with _exp < now AND no recent signals      │   │
│  │    - Aggregate final stats to index                         │   │
│  │    - Archive to archive-all channel                         │   │
│  │    - Delete from tokens-{chain} channel                     │   │
│  │                                                             │   │
│  │ 3. WALLETS CLEANUP                                          │   │
│  │    - Find wallets with _exp < now                           │   │
│  │    - If high performer → add to index.topWals               │   │
│  │    - Archive to archive-all channel                         │   │
│  │    - Delete from wallets-{chain} channel                    │   │
│  │                                                             │   │
│  │ 4. UPDATE INDEX                                             │   │
│  │    - Remove expired signal keys from lastSigs               │   │
│  │    - Update aggregate counts                                │   │
│  │    - Recalculate top performers                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Archive Record Format

When archiving, we enrich the record with final stats:

```javascript
{
  // Original record fields
  ...originalRecord,
  
  // Archive metadata
  _archived: 1734567890000,    // Archive timestamp
  _reason: 'expired',          // 'expired' | 'manual' | 'merged'
  _originalType: 'signals',    // Original channel type
  _originalKey: 'TEST001_0',   // Original key
  _chain: 'sol',               // Chain
  
  // Final stats (for signals)
  _finalMult: 2.5,             // Final multiplier
  _finalOutcome: 'win',        // Final outcome
  _timeToHigh: 14400000,       // Time to reach high (ms)
}
```

---

## Pre-Archive Aggregation

Before archiving, aggregate useful stats to index:

### Signal Aggregation
```javascript
async function aggregateSignalToIndex(db, signal) {
  const index = await db.get('index', 'main');
  
  // Update outcome stats
  if (signal.outcome === 'win') {
    index.totalWins = (index.totalWins || 0) + 1;
  } else if (signal.outcome === 'loss') {
    index.totalLosses = (index.totalLosses || 0) + 1;
  }
  
  // Update best signals if this was a winner
  if (signal.multHigh >= 2) {
    index.bestSigs = index.bestSigs || [];
    index.bestSigs.push([
      signal.sym,
      signal.multHigh,
      signal.scr,
      signal.t0
    ]);
    // Keep top 20
    index.bestSigs.sort((a, b) => b[1] - a[1]);
    index.bestSigs = index.bestSigs.slice(0, 20);
  }
  
  // Update score correlation data
  index.scoreCorrelation = index.scoreCorrelation || {
    highScoreWins: 0,
    highScoreTotal: 0,
    lowScoreWins: 0,
    lowScoreTotal: 0,
  };
  
  if (signal.scr >= 1.0) {
    index.scoreCorrelation.highScoreTotal++;
    if (signal.outcome === 'win') index.scoreCorrelation.highScoreWins++;
  } else {
    index.scoreCorrelation.lowScoreTotal++;
    if (signal.outcome === 'win') index.scoreCorrelation.lowScoreWins++;
  }
  
  await db.update('index', 'main', index);
}
```

### Wallet Aggregation
```javascript
async function aggregateWalletToIndex(db, wallet) {
  const index = await db.get('index', 'main');
  
  // Only track high performers in index
  if (wallet.avgScr >= 1.0 && wallet.scnt >= 3) {
    index.topWals = index.topWals || [];
    
    // Check if already tracked
    const existing = index.topWals.findIndex(w => w[0] === wallet.addr.slice(0, 12));
    
    const walletEntry = [
      wallet.addr.slice(0, 12),
      wallet.avgScr,
      wallet.scnt,
      wallet.winRate,
      wallet.consistency,
    ];
    
    if (existing >= 0) {
      index.topWals[existing] = walletEntry;
    } else {
      index.topWals.push(walletEntry);
    }
    
    // Keep top 50 by avgScr
    index.topWals.sort((a, b) => b[1] - a[1]);
    index.topWals = index.topWals.slice(0, 50);
  }
  
  await db.update('index', 'main', index);
}
```

---

## Cleanup API Endpoint

### `/api/cleanup.js`

```javascript
export default async function handler(req, res) {
  const chainId = parseInt(req.query.chain) || 501;
  const dryRun = req.query.dry === 'true';
  
  const db = new TelegramDBv4(BOT_TOKEN, chainId);
  const now = Date.now();
  const stats = { signals: 0, tokens: 0, wallets: 0 };
  
  // 1. Cleanup signals
  for (const [key, record] of db.entries('signals')) {
    if (record._exp && record._exp < now) {
      if (!dryRun) {
        await aggregateSignalToIndex(db, record);
        await db.archiveAndDelete('signals', key, 'expired');
      }
      stats.signals++;
    }
  }
  
  // 2. Cleanup tokens
  for (const [key, record] of db.entries('tokens')) {
    if (record._exp && record._exp < now) {
      if (!dryRun) {
        await db.archiveAndDelete('tokens', key, 'expired');
      }
      stats.tokens++;
    }
  }
  
  // 3. Cleanup wallets
  for (const [key, record] of db.entries('wallets')) {
    if (record._exp && record._exp < now) {
      if (!dryRun) {
        await aggregateWalletToIndex(db, record);
        await db.archiveAndDelete('wallets', key, 'expired');
      }
      stats.wallets++;
    }
  }
  
  return res.json({
    ok: true,
    dryRun,
    chain: chainId,
    archived: stats,
  });
}
```

---

## Cron Schedule

```
# Daily cleanup at midnight UTC (staggered by chain)
/api/cleanup?chain=501  - 00:00 UTC
/api/cleanup?chain=1    - 00:15 UTC
/api/cleanup?chain=56   - 00:30 UTC
/api/cleanup?chain=8453 - 00:45 UTC
```

---

## Bootstrap Problem (Cleanup Context)

**Issue:** After cold start, cache is empty. We don't know which records exist in channels.

**Solutions for Cleanup:**

1. **Store record keys in index**
   ```javascript
   index.signalKeys = ['sig1', 'sig2', ...]; // All active signal keys
   index.tokenKeys = ['tok1', 'tok2', ...];
   index.walletKeys = ['wal1', 'wal2', ...];
   ```
   - On cold start, we know what exists
   - But can't access the actual data without re-fetching

2. **Accept orphan messages**
   - If we can't track a record, it stays in channel forever
   - Not ideal, but channels have no size limit
   - Run manual cleanup periodically using Telegram client

3. **Hybrid approach (recommended)**
   - Index stores all record keys
   - Cleanup only runs on records we know about
   - Manual cleanup script for orphans (run monthly)

---

## Index Record Structure (Updated)

```javascript
{
  c: 501,                    // Chain ID
  lastUpdate: 1734567890,    // Last update timestamp
  
  // Dedup
  lastSigs: ['sig1', 'sig2', ...],  // Last 100 signal keys
  
  // Counts
  totalSigs: 150,
  totalToks: 45,
  totalWals: 230,
  
  // Outcomes (for correlation analysis)
  totalWins: 45,
  totalLosses: 30,
  totalNeutral: 75,
  
  // Score correlation
  scoreCorrelation: {
    highScoreWins: 20,
    highScoreTotal: 35,
    lowScoreWins: 25,
    lowScoreTotal: 115,
  },
  
  // Top performers (permanent)
  topWals: [
    ['SmartWal1234', 1.8, 15, 75, 90],  // addr, avgScr, scnt, winRate, consistency
    ['SmartWal5678', 1.5, 12, 70, 85],
    // ...
  ],
  
  // Best signals (permanent)
  bestSigs: [
    ['ALPHA', 10.5, 1.8, 1734567890],   // sym, mult, score, timestamp
    ['BETA', 8.2, 1.2, 1734567890],
    // ...
  ],
  
  // Active record keys (for cleanup)
  signalKeys: ['sig1', 'sig2', ...],
  tokenKeys: ['tok1', 'tok2', ...],
  walletKeys: ['wal1', 'wal2', ...],
}
```

---

## Archive Channel Structure

The archive-all channel will contain mixed records:

```
#archived_signals
#reason_expired
{...signal data...}

#archived_wallets
#reason_expired
{...wallet data with final stats...}

#archived_tokens
#reason_expired
{...token data...}
```

This allows:
- Searching by type: `#archived_signals`
- Searching by reason: `#reason_expired`
- Historical analysis via manual export

---

## Estimated Volume

### Per chain, per month:
- Signals created: ~200
- Signals archived: ~200 (after 7d)
- Tokens created: ~100
- Tokens archived: ~50 (after 30d, others still active)
- Wallets created: ~500
- Wallets archived: ~400 (mix of 7d and 30d)

### Archive channel growth:
- ~650 records/month per chain
- ~2,600 records/month total
- ~31,200 records/year

This is manageable - Telegram channels can hold millions of messages.

---

## Next Steps

1. ✅ Design document (this file)
2. Update TelegramDBv4 to track record keys in index
3. Implement `/api/cleanup.js`
4. Test with mock expired records
5. Set up daily cron jobs
6. Monitor archive channel growth
