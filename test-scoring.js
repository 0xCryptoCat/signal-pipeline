/**
 * Signal Pipeline - Test with Scoring
 * 
 * Step 2: Poll signals + score participating wallets
 * Compare OKX-reported PnL/ROI vs our calculated scores
 */

// ============================================================
// CONSTANTS
// ============================================================

const SIGNAL_LABELS = {
  '1': 'Smart Money',
  '2': 'Influencers', 
  '3': 'Whales'
};

const TRENDS = {
  1: 'BUY',
  2: 'SELL'
};

const CHAIN_NAMES = {
  501: 'Solana',
  1: 'Ethereum',
  56: 'BSC',
  8453: 'Base'
};

const LOOKBACK_MS = 8 * 60 * 60 * 1000;   // 8 hours before
const LOOKFORWARD_MS = 24 * 60 * 60 * 1000; // 24 hours after

const ENDPOINTS = {
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
  candles: 'https://web3.okx.com/priapi/v5/dex/token/market/dex-token-hlc-candles',
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function parseTokenKey(tokenKey) {
  const parts = tokenKey.split('!@#');
  return {
    chainId: parseInt(parts[0]),
    tokenAddress: parts[1]
  };
}

function formatUsd(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '$0';
  const sign = n < 0 ? '-' : '';
  const absN = Math.abs(n);
  if (absN >= 1_000_000_000) return `${sign}$${(absN / 1_000_000_000).toFixed(2)}B`;
  if (absN >= 1_000_000) return `${sign}$${(absN / 1_000_000).toFixed(2)}M`;
  if (absN >= 1_000) return `${sign}$${(absN / 1_000).toFixed(2)}K`;
  if (absN >= 1) return `${sign}$${absN.toFixed(2)}`;
  return `${sign}$${absN.toFixed(6)}`;
}

function formatPct(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '0%';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatTime(ts) {
  return new Date(parseInt(ts)).toLocaleString();
}

function getTokenAge(createTime) {
  const ageMs = Date.now() - parseInt(createTime);
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Score emoji
function scoreEmoji(score) {
  if (score === 2) return '🔵';
  if (score === 1) return '🟢';
  if (score === 0) return '⚪️';
  if (score === -1) return '🟠';
  if (score === -2) return '🔴';
  return '⚪️';
}

// ============================================================
// API FUNCTIONS
// ============================================================

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchFilterActivity(chainId = 501, trend = '1', pageSize = 3) {
  const t = Date.now();
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview?t=${t}`;
  
  const body = {
    chainId,
    trend,
    signalLabelList: [1, 2, 3],
    protocolIdList: [],
    tokenMetricsFilter: {},
    signalMetricsFilter: {},
    pageSize
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (json.code !== 0) throw new Error(`API Error: ${json.error_message || json.msg}`);
  return json.data;
}

async function fetchSignalDetail(chainId, tokenAddress, batchId, batchIndex) {
  const t = Date.now();
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail?` +
    `chainId=${chainId}&tokenContractAddress=${tokenAddress}&batchId=${batchId}&batchIndex=${batchIndex}&t=${t}`;

  const json = await fetchJson(url);
  if (json.code !== 0) throw new Error(`API Error: ${json.error_message || json.msg}`);
  return json.data;
}

async function fetchTradingHistory(chainId, walletAddress, limit = 50) {
  const allTokens = [];
  let offset = 0;
  
  while (allTokens.length < limit) {
    const url = `${ENDPOINTS.tradingHistory}?walletAddress=${walletAddress}&chainId=${chainId}&isAsc=false&sortType=2&offset=${offset}&limit=20&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    
    const data = await fetchJson(url);
    if (data.code !== 0) break;
    
    allTokens.push(...data.data.tokenList);
    
    if (!data.data.hasNext || allTokens.length >= limit) break;
    offset = data.data.offset;
    
    await sleep(100);
  }
  
  return allTokens.slice(0, limit);
}

async function fetchCandles(chainId, tokenAddress, limit = 500) {
  const url = `${ENDPOINTS.candles}?chainId=${chainId}&address=${tokenAddress}&bar=15m&limit=${limit}&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== '0' && data.code !== 0) return [];
    
    return (data.data || []).map(c => ({
      timestamp: parseInt(c[0], 10),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));
  } catch {
    return [];
  }
}

// ============================================================
// SCORING FUNCTIONS
// ============================================================

function classifyBefore(entryPrice, beforeMin, beforeMax) {
  const riseToEntry = ((entryPrice - beforeMin) / beforeMin) * 100;
  const fallToEntry = ((beforeMax - entryPrice) / beforeMax) * 100;
  
  if (riseToEntry > 25 && riseToEntry > fallToEntry) return 'pumped_to';
  if (riseToEntry > 10 && riseToEntry > fallToEntry) return 'rose_to';
  if (fallToEntry > 25 && fallToEntry > riseToEntry) return 'dumped_to';
  if (fallToEntry > 10 && fallToEntry > riseToEntry) return 'fell_to';
  return 'flat';
}

function classifyAfter(entryPrice, afterMin, afterMax) {
  const pctUp = ((afterMax - entryPrice) / entryPrice) * 100;
  const pctDown = ((entryPrice - afterMin) / entryPrice) * 100;
  
  if (pctUp > 25 && pctUp > pctDown) return 'moon';
  if (pctUp > 10 && pctUp > pctDown) return 'pump';
  if (pctDown > 25 && pctDown > pctUp) return 'dump';
  if (pctDown > 10 && pctDown > pctUp) return 'dip';
  return 'flat';
}

function scoreBuy(beforeCtx, afterCtx) {
  const matrix = {
    'dumped_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'fell_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'flat': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'rose_to': { 'moon': 1, 'pump': 0, 'flat': -1, 'dip': -2, 'dump': -2 },
    'pumped_to': { 'moon': 0, 'pump': -1, 'flat': -1, 'dip': -2, 'dump': -2 },
  };
  return matrix[beforeCtx]?.[afterCtx] ?? 0;
}

function scoreEntry(entryPrice, entryTime, candles) {
  const beforeCandles = candles.filter(c => 
    c.timestamp < entryTime && c.timestamp >= entryTime - LOOKBACK_MS
  );
  const afterCandles = candles.filter(c => 
    c.timestamp > entryTime && c.timestamp <= entryTime + LOOKFORWARD_MS
  );
  
  const beforeMin = beforeCandles.length > 0 ? Math.min(...beforeCandles.map(c => c.low)) : entryPrice;
  const beforeMax = beforeCandles.length > 0 ? Math.max(...beforeCandles.map(c => c.high)) : entryPrice;
  const afterMin = afterCandles.length > 0 ? Math.min(...afterCandles.map(c => c.low)) : entryPrice;
  const afterMax = afterCandles.length > 0 ? Math.max(...afterCandles.map(c => c.high)) : entryPrice;
  
  const beforeCtx = classifyBefore(entryPrice, beforeMin, beforeMax);
  const afterCtx = classifyAfter(entryPrice, afterMin, afterMax);
  
  return scoreBuy(beforeCtx, afterCtx);
}

// ============================================================
// WALLET SCORING (7d history)
// ============================================================

async function scoreWallet7d(walletAddress, chainId, maxTokens = 20) {
  console.log(`      ⏳ Fetching 7d trading history...`);
  
  const tokens = await fetchTradingHistory(chainId, walletAddress, maxTokens);
  
  // Filter to 7d window
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentTokens = tokens.filter(t => 
    t.latestTime && parseInt(t.latestTime, 10) >= sevenDaysAgo
  );
  
  console.log(`      📊 Found ${recentTokens.length} tokens in 7d window`);
  
  const tokenScores = [];
  let totalPnl = 0;
  let totalBuyVolume = 0;
  let totalSellVolume = 0;
  let wins = 0;
  let losses = 0;
  
  for (const token of recentTokens.slice(0, maxTokens)) {
    const tokenAddress = token.tokenContractAddress;
    const buyAvgPrice = parseFloat(token.buyAvgPrice) || 0;
    const buyCount = token.totalTxBuy || 0;
    const buyVolume = parseFloat(token.buyVolume) || 0;
    const sellVolume = parseFloat(token.sellVolume) || 0;
    const pnl = parseFloat(token.totalPnl) || 0;
    
    totalPnl += pnl;
    totalBuyVolume += buyVolume;
    totalSellVolume += sellVolume;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
    
    // Score if we have buy data
    let score = 0;
    if (buyCount > 0 && buyAvgPrice > 0) {
      const candles = await fetchCandles(chainId, tokenAddress);
      
      if (candles.length > 0) {
        // Find closest candle to buy avg price
        const closestCandle = candles.reduce((best, c) => 
          Math.abs(c.close - buyAvgPrice) < Math.abs(best.close - buyAvgPrice) ? c : best
        );
        score = scoreEntry(buyAvgPrice, closestCandle.timestamp, candles);
      }
    }
    
    tokenScores.push({
      symbol: token.tokenSymbol || 'UNKNOWN',
      score,
      pnl,
      buyCount
    });
    
    await sleep(50);  // Rate limit
  }
  
  // Calculate aggregates
  const allScores = tokenScores.flatMap(t => Array(t.buyCount).fill(t.score));
  const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
  const roi = totalBuyVolume > 0 ? ((totalSellVolume - totalBuyVolume + totalPnl) / totalBuyVolume) * 100 : 0;
  
  return {
    tokensAnalyzed: recentTokens.length,
    totalBuys: allScores.length,
    avgScore,
    scoreDist: {
      excellent: tokenScores.filter(t => t.score === 2).length,
      good: tokenScores.filter(t => t.score === 1).length,
      neutral: tokenScores.filter(t => t.score === 0).length,
      poor: tokenScores.filter(t => t.score === -1).length,
      terrible: tokenScores.filter(t => t.score === -2).length,
    },
    calculated: {
      pnl7d: totalPnl,
      roi,
      winRate
    },
    topTokens: tokenScores.slice(0, 5)
  };
}

// ============================================================
// DISPLAY FUNCTIONS
// ============================================================

function joinSignalData(activity, tokenInfo, overviewList) {
  const { chainId, tokenAddress } = parseTokenKey(activity.tokenKey);
  const tokenData = tokenInfo[activity.tokenKey] || {};
  const overview = overviewList.find(o => o.tokenKey === activity.tokenKey) || {};
  const labelIndex = parseInt(activity.signalLabel) - 1;
  
  return {
    signalId: activity.id,
    batchId: activity.batchId,
    batchIndex: activity.batchIndex,
    eventTime: activity.eventTime,
    trend: TRENDS[activity.trend] || 'UNKNOWN',
    signalLabel: SIGNAL_LABELS[activity.signalLabel] || 'Unknown',
    addressNum: activity.addressNum,
    chainId,
    chainName: CHAIN_NAMES[chainId] || `Chain ${chainId}`,
    tokenAddress,
    tokenName: tokenData.tokenName || 'Unknown',
    tokenSymbol: tokenData.tokenSymbol || '???',
    tokenAge: tokenData.tokenCreateTime ? getTokenAge(tokenData.tokenCreateTime) : 'Unknown',
    priceAtSignal: activity.price,
    mcapAtSignal: activity.mcap,
    volumeInSignal: activity.volume,
    currentPrice: tokenData.currentPrice,
    maxMultiplier: overview.maxIncreaseMultiplier || '0',
    maxPctGain: overview.maxIncreasePercentage || '0',
  };
}

function displaySignalHeader(signal, index) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 SIGNAL #${index + 1}: ${signal.tokenName} ($${signal.tokenSymbol})`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`   📍 ${signal.chainName} | ${signal.signalLabel} ${signal.trend} | ${signal.addressNum} wallets`);
  console.log(`   ⏰ ${formatTime(signal.eventTime)}`);
  console.log(`   💰 Volume: ${formatUsd(signal.volumeInSignal)} | MCap: ${formatUsd(signal.mcapAtSignal)}`);
  console.log(`   🏆 Max Gain: ${signal.maxMultiplier}x (${formatPct(signal.maxPctGain)})`);
}

function displayWalletComparison(wallet, scoring) {
  const okxPnl = parseFloat(wallet.pnl7d);
  const okxRoi = parseFloat(wallet.roi);
  const okxWinRate = parseFloat(wallet.winRate);
  
  const calcPnl = scoring.calculated.pnl7d;
  const calcRoi = scoring.calculated.roi;
  const calcWinRate = scoring.calculated.winRate;
  
  const isKol = wallet.addressInfo?.kolAddress;
  const twitter = wallet.addressInfo?.twitterHandle;
  
  console.log(`\n   ┌─────────────────────────────────────────────────────────────────`);
  console.log(`   │ 👛 ${wallet.walletAddress.slice(0, 12)}...${wallet.walletAddress.slice(-6)}`);
  if (isKol) console.log(`   │    🎤 KOL: @${twitter}`);
  console.log(`   │`);
  console.log(`   │ 📈 OKX Reported vs Our Calculation:`);
  console.log(`   │    ┌──────────────┬────────────────┬────────────────┐`);
  console.log(`   │    │   Metric     │  OKX Reported  │ Our Calculated │`);
  console.log(`   │    ├──────────────┼────────────────┼────────────────┤`);
  console.log(`   │    │ 7d PnL       │ ${formatUsd(okxPnl).padStart(14)} │ ${formatUsd(calcPnl).padStart(14)} │`);
  console.log(`   │    │ ROI          │ ${formatPct(okxRoi).padStart(14)} │ ${formatPct(calcRoi).padStart(14)} │`);
  console.log(`   │    │ Win Rate     │ ${okxWinRate.toFixed(1).padStart(13)}% │ ${calcWinRate.toFixed(1).padStart(13)}% │`);
  console.log(`   │    └──────────────┴────────────────┴────────────────┘`);
  console.log(`   │`);
  console.log(`   │ 🎯 Entry Quality Score: ${scoring.avgScore.toFixed(2)} avg (${scoring.totalBuys} entries)`);
  console.log(`   │    ${scoreEmoji(2)} Excellent: ${scoring.scoreDist.excellent} | ${scoreEmoji(1)} Good: ${scoring.scoreDist.good} | ${scoreEmoji(0)} Neutral: ${scoring.scoreDist.neutral}`);
  console.log(`   │    ${scoreEmoji(-1)} Poor: ${scoring.scoreDist.poor} | ${scoreEmoji(-2)} Terrible: ${scoring.scoreDist.terrible}`);
  console.log(`   │`);
  console.log(`   │ 📋 Top Tokens (by our scoring):`);
  for (const t of scoring.topTokens) {
    console.log(`   │    ${scoreEmoji(t.score)} ${t.symbol.padEnd(12)} Score: ${t.score.toString().padStart(2)} | PnL: ${formatUsd(t.pnl)}`);
  }
  console.log(`   └─────────────────────────────────────────────────────────────────`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🚀 Signal Pipeline - Test with Wallet Scoring\n');
  console.log('=' .repeat(70));
  
  try {
    // Fetch 1 signal for testing (scoring takes time)
    const data = await fetchFilterActivity(501, '1', 1);
    
    console.log(`\n✅ Fetched ${data.activityList.length} signal(s)`);
    
    for (let i = 0; i < data.activityList.length; i++) {
      const activity = data.activityList[i];
      const signal = joinSignalData(activity, data.tokenInfo, data.overviewList);
      
      // Display signal header
      displaySignalHeader(signal, i);
      
      // Fetch wallet details
      console.log(`\n   ⏳ Fetching wallet details...`);
      const { chainId, tokenAddress } = parseTokenKey(activity.tokenKey);
      const detail = await fetchSignalDetail(chainId, tokenAddress, activity.batchId, activity.batchIndex);
      
      console.log(`   ✅ Found ${detail.addresses.length} wallets, scoring each (7d history)...\n`);
      
      // Score each wallet
      for (const wallet of detail.addresses) {
        console.log(`   🔍 Scoring ${wallet.walletAddress.slice(0, 12)}...`);
        
        const scoring = await scoreWallet7d(wallet.walletAddress, chainId, 15);
        
        displayWalletComparison(wallet, scoring);
        
        await sleep(200);  // Be nice to API
      }
    }
    
    console.log(`\n\n${'═'.repeat(70)}`);
    console.log('✅ Test completed!');
    console.log(`${'═'.repeat(70)}\n`);
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
