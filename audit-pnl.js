/**
 * Signal Pipeline - Deep Audit
 * 
 * Investigate why our calculated PnL/ROI/WinRate differs from OKX reported values
 * 
 * Hypothesis to test:
 * 1. Are we filtering out negative PnL tokens?
 * 2. Is the 7d window calculated differently?
 * 3. Does OKX include tokens we're missing?
 * 4. Is ROI calculated on different base?
 */

const ENDPOINTS = {
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUsd(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '$0';
  const sign = n < 0 ? '-' : '+';
  const absN = Math.abs(n);
  if (absN >= 1_000) return `${sign}$${(absN / 1_000).toFixed(2)}K`;
  return `${sign}$${absN.toFixed(2)}`;
}

// ============================================================
// FETCH ALL TRADING HISTORY (not just 7d filtered)
// ============================================================

async function fetchFullTradingHistory(chainId, walletAddress, limit = 100) {
  const allTokens = [];
  let offset = 0;
  
  while (allTokens.length < limit) {
    // Note: We're NOT filtering by time - get ALL tokens
    const url = `${ENDPOINTS.tradingHistory}?walletAddress=${walletAddress}&chainId=${chainId}&isAsc=false&sortType=1&offset=${offset}&limit=50&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    
    console.log(`   Fetching offset=${offset}...`);
    
    const data = await fetchJson(url);
    if (data.code !== 0) {
      console.log(`   ❌ API error: ${data.msg}`);
      break;
    }
    
    console.log(`   Got ${data.data.tokenList.length} tokens, hasNext=${data.data.hasNext}`);
    
    allTokens.push(...data.data.tokenList);
    
    if (!data.data.hasNext || allTokens.length >= limit) break;
    offset = data.data.offset;
    
    await sleep(200);
  }
  
  return allTokens;
}

// ============================================================
// DETAILED ANALYSIS
// ============================================================

async function auditWallet(walletAddress, chainId, okxReported) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`🔍 AUDITING WALLET: ${walletAddress}`);
  console.log(`${'═'.repeat(80)}`);
  
  console.log(`\n📊 OKX Signal Detail Reports:`);
  console.log(`   PnL 7d:   ${formatUsd(okxReported.pnl7d)}`);
  console.log(`   ROI:      ${parseFloat(okxReported.roi).toFixed(2)}%`);
  console.log(`   Win Rate: ${parseFloat(okxReported.winRate).toFixed(2)}%`);
  
  // Fetch full trading history
  console.log(`\n📥 Fetching FULL trading history...`);
  const allTokens = await fetchFullTradingHistory(chainId, walletAddress, 100);
  
  console.log(`\n📋 Total tokens found: ${allTokens.length}`);
  
  // Calculate time boundaries
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  
  // Analyze each token
  let totalPnlAll = 0;
  let totalPnl7d = 0;
  let totalBuyVolumeAll = 0;
  let totalBuyVolume7d = 0;
  let totalSellVolumeAll = 0;
  let totalSellVolume7d = 0;
  let winsAll = 0, lossesAll = 0;
  let wins7d = 0, losses7d = 0;
  
  const tokens7d = [];
  const tokensOlder = [];
  
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`📊 TOKEN BREAKDOWN (sorted by latestTime):`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`${'Symbol'.padEnd(15)} | ${'Latest Trade'.padEnd(22)} | ${'In 7d?'.padEnd(6)} | ${'PnL'.padStart(12)} | ${'Buy Vol'.padStart(10)} | ${'Sell Vol'.padStart(10)}`);
  console.log(`${'─'.repeat(80)}`);
  
  // Sort by latestTime descending
  allTokens.sort((a, b) => parseInt(b.latestTime || 0) - parseInt(a.latestTime || 0));
  
  for (const token of allTokens) {
    const symbol = (token.tokenSymbol || 'UNKNOWN').slice(0, 14);
    const latestTime = parseInt(token.latestTime || 0);
    const firstTime = parseInt(token.firstTime || 0);
    const pnl = parseFloat(token.totalPnl) || 0;
    const realizedPnl = parseFloat(token.realizedPnl) || 0;
    const unrealizedPnl = parseFloat(token.unrealizedPnl) || 0;
    const buyVolume = parseFloat(token.buyVolume) || 0;
    const sellVolume = parseFloat(token.sellVolume) || 0;
    
    // Check if ANY activity in last 7 days
    const isIn7d = latestTime >= sevenDaysAgo;
    const latestDate = latestTime ? new Date(latestTime).toLocaleString() : 'N/A';
    
    // Count for all-time
    totalPnlAll += pnl;
    totalBuyVolumeAll += buyVolume;
    totalSellVolumeAll += sellVolume;
    if (pnl > 0) winsAll++;
    else if (pnl < 0) lossesAll++;
    
    // Count for 7d only
    if (isIn7d) {
      totalPnl7d += pnl;
      totalBuyVolume7d += buyVolume;
      totalSellVolume7d += sellVolume;
      if (pnl > 0) wins7d++;
      else if (pnl < 0) losses7d++;
      tokens7d.push(token);
    } else {
      tokensOlder.push(token);
    }
    
    // Print row (first 30 tokens)
    if (allTokens.indexOf(token) < 30) {
      console.log(`${symbol.padEnd(15)} | ${latestDate.padEnd(22)} | ${(isIn7d ? '✅' : '❌').padEnd(6)} | ${formatUsd(pnl).padStart(12)} | ${formatUsd(buyVolume).padStart(10)} | ${formatUsd(sellVolume).padStart(10)}`);
    }
  }
  
  if (allTokens.length > 30) {
    console.log(`... and ${allTokens.length - 30} more tokens`);
  }
  
  // Summary
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 SUMMARY COMPARISON`);
  console.log(`${'═'.repeat(80)}`);
  
  console.log(`\n┌────────────────────┬────────────────┬────────────────┬────────────────┐`);
  console.log(`│ Metric             │ OKX Reported   │ Our 7d Calc    │ Our All-Time   │`);
  console.log(`├────────────────────┼────────────────┼────────────────┼────────────────┤`);
  
  // PnL
  console.log(`│ PnL 7d             │ ${formatUsd(okxReported.pnl7d).padStart(14)} │ ${formatUsd(totalPnl7d).padStart(14)} │ ${formatUsd(totalPnlAll).padStart(14)} │`);
  
  // ROI - OKX might calculate this differently
  // Hypothesis 1: ROI = PnL / BuyVolume
  const roi7dSimple = totalBuyVolume7d > 0 ? (totalPnl7d / totalBuyVolume7d) * 100 : 0;
  const roiAllSimple = totalBuyVolumeAll > 0 ? (totalPnlAll / totalBuyVolumeAll) * 100 : 0;
  
  console.log(`│ ROI (PnL/BuyVol)   │ ${(parseFloat(okxReported.roi).toFixed(2) + '%').padStart(14)} │ ${(roi7dSimple.toFixed(2) + '%').padStart(14)} │ ${(roiAllSimple.toFixed(2) + '%').padStart(14)} │`);
  
  // Win Rate
  const winRate7d = (wins7d + losses7d) > 0 ? (wins7d / (wins7d + losses7d)) * 100 : 0;
  const winRateAll = (winsAll + lossesAll) > 0 ? (winsAll / (winsAll + lossesAll)) * 100 : 0;
  
  console.log(`│ Win Rate           │ ${(parseFloat(okxReported.winRate).toFixed(2) + '%').padStart(14)} │ ${(winRate7d.toFixed(2) + '%').padStart(14)} │ ${(winRateAll.toFixed(2) + '%').padStart(14)} │`);
  
  // Token counts
  console.log(`├────────────────────┼────────────────┼────────────────┼────────────────┤`);
  console.log(`│ Tokens Counted     │       N/A      │ ${tokens7d.length.toString().padStart(14)} │ ${allTokens.length.toString().padStart(14)} │`);
  console.log(`│ Wins/Losses        │       N/A      │ ${(wins7d + '/' + losses7d).padStart(14)} │ ${(winsAll + '/' + lossesAll).padStart(14)} │`);
  console.log(`│ Buy Volume         │       N/A      │ ${formatUsd(totalBuyVolume7d).padStart(14)} │ ${formatUsd(totalBuyVolumeAll).padStart(14)} │`);
  console.log(`└────────────────────┴────────────────┴────────────────┴────────────────┘`);
  
  // Check negative PnL tokens in 7d
  const negativeTokens7d = tokens7d.filter(t => parseFloat(t.totalPnl) < 0);
  const positiveTokens7d = tokens7d.filter(t => parseFloat(t.totalPnl) > 0);
  
  console.log(`\n📈 7d Window Analysis:`);
  console.log(`   Positive PnL tokens: ${positiveTokens7d.length}`);
  console.log(`   Negative PnL tokens: ${negativeTokens7d.length}`);
  console.log(`   Zero PnL tokens: ${tokens7d.length - positiveTokens7d.length - negativeTokens7d.length}`);
  
  if (negativeTokens7d.length > 0) {
    console.log(`\n   🔴 Negative PnL tokens in 7d:`);
    for (const t of negativeTokens7d.slice(0, 10)) {
      console.log(`      ${t.tokenSymbol}: ${formatUsd(t.totalPnl)}`);
    }
  }
  
  // Difference analysis
  const pnlDiff = totalPnl7d - parseFloat(okxReported.pnl7d);
  const roiDiff = roi7dSimple - parseFloat(okxReported.roi);
  const wrDiff = winRate7d - parseFloat(okxReported.winRate);
  
  console.log(`\n📐 Differences (Our 7d - OKX Reported):`);
  console.log(`   PnL difference:      ${formatUsd(pnlDiff)}`);
  console.log(`   ROI difference:      ${roiDiff.toFixed(2)}%`);
  console.log(`   Win Rate difference: ${wrDiff.toFixed(2)}%`);
  
  return {
    totalPnl7d,
    totalPnlAll,
    tokens7d: tokens7d.length,
    tokensAll: allTokens.length,
    roi7dSimple,
    winRate7d,
    wins7d,
    losses7d
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🔬 Signal Pipeline - Deep Audit\n');
  console.log('Investigating PnL/ROI/WinRate discrepancies between OKX and our calculations\n');
  
  // Fetch one signal to get wallet addresses with OKX-reported values
  const t = Date.now();
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview?t=${t}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: 501,
      trend: '1',
      signalLabelList: [1, 2, 3],
      protocolIdList: [],
      tokenMetricsFilter: {},
      signalMetricsFilter: {},
      pageSize: 1
    })
  });
  
  const json = await res.json();
  const activity = json.data.activityList[0];
  
  // Parse token key
  const [chainIdStr, tokenAddress] = activity.tokenKey.split('!@#');
  const chainId = parseInt(chainIdStr);
  
  console.log(`📡 Signal: ${json.data.tokenInfo[activity.tokenKey]?.tokenName} ($${json.data.tokenInfo[activity.tokenKey]?.tokenSymbol})`);
  console.log(`   Batch: ${activity.batchId}#${activity.batchIndex}`);
  console.log(`   Wallets: ${activity.addressNum}`);
  
  // Fetch signal detail
  const detailUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail?chainId=${chainId}&tokenContractAddress=${tokenAddress}&batchId=${activity.batchId}&batchIndex=${activity.batchIndex}&t=${Date.now()}`;
  const detailRes = await fetch(detailUrl);
  const detailJson = await detailRes.json();
  
  // Audit first wallet in detail
  for (const wallet of detailJson.data.addresses.slice(0, 2)) {
    await auditWallet(wallet.walletAddress, chainId, wallet);
    await sleep(500);
  }
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('🎯 CONCLUSIONS');
  console.log(`${'═'.repeat(80)}`);
  console.log(`
Based on this audit, the likely causes of discrepancy are:

1. ROI CALCULATION:
   - OKX likely calculates ROI as: PnL / total_portfolio_value (not just 7d trades)
   - We calculate: PnL / buyVolume (which can be very high for small positions)

2. WIN RATE:
   - OKX likely includes ALL historical tokens, not just 7d window
   - Our 7d filter shows different win/loss ratio than all-time

3. PnL:
   - Should be closer if we include ALL tokens with activity in 7d
   - OKX might use a rolling 7d window that includes partial trades

4. DATA WINDOW:
   - OKX "7d" might be rolling last 7 days from NOW
   - We filter tokens by latestTime >= 7d ago, but PnL is cumulative for that token

RECOMMENDATION:
- For ROI, use OKX's reported value (it's more meaningful for portfolio context)
- For Win Rate, use OKX's value (includes full history)
- Our ENTRY SCORING is still valid - it measures timing quality, not profitability
`);
}

main().catch(console.error);
