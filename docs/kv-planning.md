# Vercel KV Usage Planning

## Free Tier Limits
- **30,000 requests/month**
- **256 MB storage**
- **100 KB max value size**

## Current Architecture

### Polling Frequency
- 4 chains × 1 poll/minute = **4 polls/min**
- 4 × 60 × 24 × 30 = **172,800 polls/month** ❌ WAY OVER

### Solution: Batch Operations

Instead of individual KV calls per poll, batch them:

#### Option A: Batch every 5 minutes
- Collect signals in memory for 5 mins
- Single KV write with batch of signal IDs
- **4 chains × 12 batches/hour × 24 × 30 = 34,560 writes/month** ❌ Still over

#### Option B: Batch every 15 minutes  
- **4 chains × 4 batches/hour × 24 × 30 = 11,520 writes/month** ✅

#### Option C: Single daily summary + in-memory dedup
- Use in-memory Set for current session
- Write daily summary to KV
- **4 chains × 30 days = 120 writes/month** ✅✅

## Recommended: Hybrid Approach

### Signal Deduplication (In-Memory)
```javascript
// Each function instance has its own Set
// Resets on cold start (~15min idle)
// Duplicates possible but rare and acceptable
const seenSignals = new Set();
```

### Token Tracking (KV - Low Frequency)
Only use KV for:
1. **Token aggregation** - Track last signal per token
2. **High-score wallets** - Store wallets with score > 0.5

### KV Schema

```javascript
// Token last signal - SET on new signal, GET on new signal
// Key: token:{chainId}:{tokenAddress}
{
  lastSignalTime: 1702800000000,
  lastPrice: "0.0001234",
  lastMcap: "1300000",
  signalCount: 3
}

// High-score wallet - SET when score > 0.5
// Key: wallet:{chainId}:{address}
{
  avgScore: 1.24,
  lastSeen: 1702800000000,
  signalCount: 5
}
```

### Request Estimation (Option C + Token Tracking)

| Operation | Frequency | Requests/Month |
|-----------|-----------|----------------|
| Token GET (check prev signal) | ~50 signals/day × 30 | 1,500 |
| Token SET (update last signal) | ~50 signals/day × 30 | 1,500 |
| Wallet SET (score > 0.5) | ~10/day × 30 | 300 |
| **Total** | | **~3,300** ✅ |

## Implementation

### Phase 1: In-Memory Only (Current)
- No KV, just in-memory Set
- Works fine, occasional duplicates on cold start

### Phase 2: Add Token Tracking (Low KV usage)
```javascript
// On new signal
const prevSignal = await kv.get(`token:${chainId}:${tokenAddress}`);
if (prevSignal) {
  const priceChange = calcChange(prevSignal.lastPrice, currentPrice);
  message += `\n📊 Since last signal: ${priceChange}`;
}
await kv.set(`token:${chainId}:${tokenAddress}`, {
  lastSignalTime: Date.now(),
  lastPrice: currentPrice,
  lastMcap: currentMcap,
  signalCount: (prevSignal?.signalCount || 0) + 1
}, { ex: 86400 * 7 }); // Expire after 7 days
```

### Phase 3: High-Score Wallet Storage
```javascript
// After scoring
if (wallet.entryScore > 0.5) {
  await kv.set(`wallet:${chainId}:${address}`, {
    avgScore: wallet.entryScore,
    lastSeen: Date.now(),
    signalCount: (prev?.signalCount || 0) + 1
  });
}
```

## Conclusion

**Don't use KV for signal deduplication** - too many requests.
**Do use KV for**:
- Token aggregation ("Since last signal: 3x")
- High-score wallet storage
- Daily/weekly summaries

Stay well under 30K requests with this approach.
