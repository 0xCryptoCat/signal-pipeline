# Signal Performance Tracking - Design Document

## Overview

Track signal performance over time to:
1. Measure if high-score signals actually perform better
2. Post update messages when signals hit milestones (2x, 5x, 10x)
3. Validate the scoring system correlates with real outcomes
4. Build historical data for wallet/token performance analysis

---

## Performance Update Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PERFORMANCE UPDATE PIPELINE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CRON: Every 15 minutes                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 1. Load all signals from signals-{chain} channel            │   │
│  │ 2. For each signal < 7 days old:                            │   │
│  │    a. Fetch current price from OKX candles API              │   │
│  │    b. Calculate multiplier from entry price                 │   │
│  │    c. Update signal record (pxNow, pxHigh, mult)            │   │
│  │    d. If milestone hit → Post update to public channel      │   │
│  │ 3. Update token records with outcomes                       │   │
│  │ 4. Update wallet records with wins/losses                   │   │
│  │ 5. Update index with best performers                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Milestone Thresholds

| Multiplier | Emoji | Message Type | When to Post |
|------------|-------|--------------|--------------|
| 2x | 🚀 | Update | First time hitting 2x |
| 3x | 🔥 | Update | First time hitting 3x |
| 5x | 💎 | Update | First time hitting 5x |
| 10x | 🌙 | Update | First time hitting 10x |
| 0.5x | 📉 | Warning | Dropped 50% from entry |
| 0.25x | ⚠️ | Alert | Dropped 75% from entry |

### Milestone Tracking in Signal Record

```javascript
{
  // ... existing fields ...
  
  // Performance tracking
  pxNow: 0.00003,      // Current price
  pxHigh: 0.00005,     // Highest price seen
  pxLow: 0.00001,      // Lowest price seen
  mult: 3.0,           // Current multiplier from entry
  multHigh: 5.0,       // Highest multiplier achieved
  
  // Milestones hit (to avoid duplicate notifications)
  milestones: [2, 3, 5], // Already notified for these
  
  // Outcome (set after 24h or when definitive)
  outcome: 'win',      // 'win' | 'loss' | 'neutral'
  outcomeTime: 1234567890,
}
```

---

## Update Message Format

### Milestone Hit (Positive)
```
#Solana 🚀 SIGNAL UPDATE

🪙 ALPHA ($ALPHA)
Entry: $0.00001 → Now: $0.00002 (2x)
High: $0.000025 (2.5x)

⏰ 4h since signal
📊 Signal Score: 1.15 ⚪️

Original wallets:
SmartWa...1234 🟢 1.8
SmartWa...5678 🟢 1.2
```

### Milestone Hit (Negative)
```
#Solana 📉 SIGNAL UPDATE

🪙 BETA ($BETA)
Entry: $0.00005 → Now: $0.000025 (-50%)
High: $0.00006 (1.2x)

⏰ 12h since signal
📊 Signal Score: 0.4 🟠

⚠️ Consider reviewing this token
```

---

## Data Update Logic

### Signal Record Updates
```javascript
async function updateSignalPerformance(db, signal, currentPrice) {
  const mult = currentPrice / signal.p0;
  const multHigh = Math.max(signal.multHigh || 1, mult);
  
  // Check for new milestones
  const milestones = signal.milestones || [];
  const newMilestones = [];
  
  for (const threshold of [2, 3, 5, 10]) {
    if (multHigh >= threshold && !milestones.includes(threshold)) {
      newMilestones.push(threshold);
      milestones.push(threshold);
    }
  }
  
  // Update record
  await db.update('signals', key, {
    pxNow: currentPrice,
    pxHigh: Math.max(signal.pxHigh || signal.p0, currentPrice),
    mult: round(mult, 2),
    multHigh: round(multHigh, 2),
    milestones,
  });
  
  return { newMilestones, mult, multHigh };
}
```

### Token Record Updates
```javascript
async function updateTokenPerformance(db, tokenKey, signals) {
  let wins = 0, losses = 0;
  
  for (const sig of signals) {
    if (sig.multHigh >= 2) wins++;
    else if (sig.mult < 0.5) losses++;
  }
  
  await db.update('tokens', tokenKey, {
    winRate: round((wins / (wins + losses)) * 100, 1),
    pHigh: Math.max(...signals.map(s => s.multHigh || 1)),
  });
}
```

### Wallet Record Updates
```javascript
async function updateWalletPerformance(db, walletKey, entries) {
  let wins = 0, losses = 0;
  
  for (const entry of entries) {
    // entry = [tokenPrefix, timestamp, entryPrice, outcome]
    if (entry[3] === 'win') wins++;
    else if (entry[3] === 'loss') losses++;
  }
  
  await db.update('wallets', walletKey, {
    wins,
    losses,
    winRate: round((wins / (wins + losses)) * 100, 1),
  });
}
```

---

## Cron Job Structure

### `/api/update-performance.js`

```javascript
// Triggered every 15 minutes by cron-job.org
// Processes one chain per invocation to stay within time limits

export default async function handler(req, res) {
  const chainId = parseInt(req.query.chain) || 501;
  
  // 1. Initialize DB
  const db = new TelegramDBv4(BOT_TOKEN, chainId);
  
  // 2. Load index to get signal list
  // (In production, we'd need to bootstrap from channel history)
  
  // 3. For each signal < 7 days old
  //    - Fetch current price
  //    - Update performance
  //    - Post milestone notifications
  
  // 4. Update token aggregates
  
  // 5. Update wallet aggregates
  
  // 6. Update index with top performers
  
  return res.json({ ok: true, updated: count });
}
```

### Cron Schedule
```
/api/update-performance?chain=501  - Every 15 min
/api/update-performance?chain=1    - Every 15 min (offset 5 min)
/api/update-performance?chain=56   - Every 15 min (offset 10 min)
/api/update-performance?chain=8453 - Every 15 min (offset 15 min)
```

---

## Correlation Analysis

After collecting data, we can analyze:

### Score vs Outcome
```
High Score (≥1.0):  X% hit 2x, Y% dropped 50%
Medium Score (0-1): X% hit 2x, Y% dropped 50%  
Low Score (<0):     X% hit 2x, Y% dropped 50%
```

### Wallet Consistency
```
Wallets with consistency >80%: X% win rate
Wallets with consistency <50%: Y% win rate
```

### Token Repeat Signals
```
1st signal for token: X% win rate
2nd+ signal for token: Y% win rate
```

---

## Bootstrap Problem

**Issue:** When Vercel cold starts, cache is empty. We can't query Telegram channel history directly via Bot API.

**Solutions:**

1. **Index stores recent signal keys**
   - Index record keeps last 100 signal keys
   - On cold start, we only track new signals
   - Old signals that haven't been updated will expire naturally

2. **Periodic full sync (optional)**
   - Separate script that reads channel via Telegram client API
   - Rebuilds cache and updates index
   - Run manually or weekly

3. **Accept partial coverage**
   - New signals get full tracking
   - Old signals from before cold start won't get updates
   - This is acceptable for MVP

---

## Rate Limiting Considerations

### Per 15-minute update cycle:
- ~50 signals per chain (7 days, ~7/day)
- 50 price fetches (OKX candles API)
- 50 signal record updates
- ~30 token updates
- ~100 wallet updates
- 1 index update
- ~5 milestone notifications

### Telegram limits:
- 30 messages/second to different chats ✅
- 20 messages/minute to same chat ✅
- We're well within limits

### OKX limits:
- No documented rate limit for candles API
- Add 100ms delay between fetches to be safe

---

## Next Steps

1. ✅ Design document (this file)
2. Implement `/api/update-performance.js`
3. Test with mock data
4. Integrate with signal-pipeline
5. Set up cron jobs
6. Monitor and adjust thresholds
