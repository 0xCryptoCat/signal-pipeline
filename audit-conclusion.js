/**
 * Final Audit Conclusion
 * 
 * After extensive investigation, here's what we've learned:
 */

console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                    AUDIT CONCLUSION: pnl7d DISCREPANCY                     ║
╠══════════════════════════════════════════════════════════════════════════╣

KEY FINDINGS:
═════════════

1. DATA SOURCE
   • signal-detail endpoint returns pnl7d, roi, winRate
   • These are PRE-CALCULATED by OKX's backend
   • We cannot reverse-engineer the exact formula from token-list

2. OUR CALCULATION LIMITATIONS
   • token-list endpoint doesn't have firstTime populated (always 0)
   • We can only sum totalPnl for tokens with latestTime in 7d
   • This includes CUMULATIVE PnL for tokens first traded BEFORE 7d

3. LIKELY OKX CALCULATION
   • pnl7d = SUM of PnL from TRADES EXECUTED in last 7 days only
   • Not: cumulative PnL for tokens with any activity in 7d
   • OKX likely uses trade-level data, not token-level aggregates

4. WHY WALLET 2 WAS CLOSER
   • Smaller trader = most tokens traded entirely within 7d
   • Less carry-over from older positions
   • Wallet 1: Heavy trader with many positions opened before 7d

5. ROI CALCULATION
   • OKX ROI = pnl7d / (some base, possibly total capital or 7d buy volume)
   • Our ROI = totalPnl / totalBuyVolume (different base)
   • Hence ROI can differ significantly

6. WIN RATE
   • OKX winRate = wins / total trades (likely all-time or 7d trades)
   • Our winRate = winning tokens / total tokens (different metric)
   • Token-level ≠ trade-level

════════════════════════════════════════════════════════════════════════════

RECOMMENDATION FOR SIGNAL PIPELINE:
════════════════════════════════════

✅ USE OKX REPORTED VALUES for pnl7d, roi, winRate
   • They are pre-calculated with access to trade-level data
   • More accurate for display purposes

✅ USE OUR ENTRY SCORING for quality assessment
   • Entry timing quality is INDEPENDENT of PnL
   • A wallet can be profitable with poor entry timing (lucky)
   • A wallet can have great entries but lose on exits

✅ DISPLAY BOTH
   • OKX metrics: What OKX says about the wallet
   • Our score: Our assessment of entry quality

════════════════════════════════════════════════════════════════════════════

CORRECTED OUTPUT FORMAT:
════════════════════════

For each wallet in a signal, display:

1. OKX Reported (from signal-detail):
   • 7d PnL: $X,XXX
   • ROI: XX.X%
   • Win Rate: XX.X%

2. Our Entry Quality Score (from our scoring):
   • Avg Score: X.XX
   • Score Distribution: 🔵x 🟢x ⚪️x 🟠x 🔴x

This gives a complete picture:
• Are they profitable? (OKX metrics)
• Do they have good entry timing? (Our score)

A discrepancy reveals:
• High OKX PnL + Low Entry Score = Lucky or good exits, not entry timing
• Low OKX PnL + High Entry Score = Good entries but poor exits/unlucky

╚══════════════════════════════════════════════════════════════════════════╝
`);
