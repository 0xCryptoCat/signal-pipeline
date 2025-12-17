/**
 * Signal Pipeline - Test Polling
 * 
 * Step 1: Poll filter-activity-overview and display parsed signals
 * No scoring yet - just validate we can fetch and parse the data correctly
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

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Parse tokenKey into chainId and tokenAddress
 * Format: "501!@#tokenAddress"
 */
function parseTokenKey(tokenKey) {
  const parts = tokenKey.split('!@#');
  return {
    chainId: parseInt(parts[0]),
    tokenAddress: parts[1]
  };
}

/**
 * Format USD amount with K/M/B suffixes
 */
function formatUsd(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6)}`;
}

/**
 * Format percentage
 */
function formatPct(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '0%';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/**
 * Format timestamp to readable date
 */
function formatTime(ts) {
  return new Date(parseInt(ts)).toLocaleString();
}

/**
 * Calculate token age from creation time
 */
function getTokenAge(createTime) {
  const ageMs = Date.now() - parseInt(createTime);
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ============================================================
// API FUNCTIONS
// ============================================================

/**
 * Fetch Filter Activity Overview
 */
async function fetchFilterActivity(chainId = 501, trend = '1', pageSize = 5) {
  const t = Date.now();
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview?t=${t}`;
  
  const body = {
    chainId,
    trend,
    signalLabelList: [1, 2, 3],  // All: Smart Money, Influencers, Whales
    protocolIdList: [],
    tokenMetricsFilter: {},
    signalMetricsFilter: {},
    pageSize
  };

  console.log(`\n📡 Fetching signals (chain=${chainId}, trend=${trend}, pageSize=${pageSize})...`);
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  
  if (json.code !== 0) {
    throw new Error(`API Error: ${json.error_message || json.msg}`);
  }

  return json.data;
}

/**
 * Fetch Signal Detail (wallet addresses)
 */
async function fetchSignalDetail(chainId, tokenAddress, batchId, batchIndex) {
  const t = Date.now();
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail?` +
    `chainId=${chainId}&tokenContractAddress=${tokenAddress}&batchId=${batchId}&batchIndex=${batchIndex}&t=${t}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  
  if (json.code !== 0) {
    throw new Error(`API Error: ${json.error_message || json.msg}`);
  }

  return json.data;
}

// ============================================================
// DATA JOINING
// ============================================================

/**
 * Join activity with token info and overview data
 */
function joinSignalData(activity, tokenInfo, overviewList) {
  const { chainId, tokenAddress } = parseTokenKey(activity.tokenKey);
  const tokenData = tokenInfo[activity.tokenKey] || {};
  
  // Find matching overview for this token
  const overview = overviewList.find(o => o.tokenKey === activity.tokenKey) || {};
  
  // Parse performance arrays (indexed by signalLabel - 1)
  const labelIndex = parseInt(activity.signalLabel) - 1;
  
  return {
    // Signal identifiers
    signalId: activity.id,
    batchId: activity.batchId,
    batchIndex: activity.batchIndex,
    eventTime: activity.eventTime,
    
    // Signal type
    trend: TRENDS[activity.trend] || 'UNKNOWN',
    signalLabel: SIGNAL_LABELS[activity.signalLabel] || 'Unknown',
    addressNum: activity.addressNum,
    
    // Chain info
    chainId,
    chainName: CHAIN_NAMES[chainId] || `Chain ${chainId}`,
    
    // Token identity
    tokenAddress,
    tokenName: tokenData.tokenName || 'Unknown',
    tokenSymbol: tokenData.tokenSymbol || '???',
    tokenAge: tokenData.tokenCreateTime ? getTokenAge(tokenData.tokenCreateTime) : 'Unknown',
    
    // At signal time
    priceAtSignal: activity.price,
    mcapAtSignal: activity.mcap,
    liquidityAtSignal: activity.liquidity,
    holdersAtSignal: activity.holders,
    volumeInSignal: activity.volume,
    sellRatio: activity.sellRatio,
    
    // Current state
    currentPrice: tokenData.currentPrice,
    currentMcap: tokenData.currentMcap,
    currentHolders: tokenData.currentHolders,
    totalVolume: tokenData.volume,
    buyTxs: tokenData.buyTxs,
    sellTxs: tokenData.sellTxs,
    top10Hold: tokenData.top10HoldAmountPercentage,
    
    // Performance (from overview)
    maxMultiplier: overview.maxIncreaseMultiplier || '0',
    maxPctGain: overview.maxIncreasePercentage || '0',
    firstSignalTime: overview.fstList?.[labelIndex] || '',
    labelMaxMultiplier: overview.mimList?.[labelIndex] || '',
    labelMaxPctGain: overview.mipList?.[labelIndex] || ''
  };
}

// ============================================================
// DISPLAY FUNCTIONS
// ============================================================

/**
 * Display a single joined signal
 */
function displaySignal(signal, index) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 SIGNAL #${index + 1} (ID: ${signal.signalId})`);
  console.log(`${'═'.repeat(60)}`);
  
  // Token header
  console.log(`\n🪙 ${signal.tokenName} ($${signal.tokenSymbol})`);
  console.log(`   📍 ${signal.chainName} | Age: ${signal.tokenAge}`);
  console.log(`   📋 ${signal.tokenAddress}`);
  
  // Signal info
  console.log(`\n📡 Signal Info:`);
  console.log(`   ├── Type: ${signal.signalLabel} ${signal.trend}`);
  console.log(`   ├── Time: ${formatTime(signal.eventTime)}`);
  console.log(`   ├── Wallets: ${signal.addressNum}`);
  console.log(`   ├── Volume: ${formatUsd(signal.volumeInSignal)}`);
  console.log(`   └── Batch: ${signal.batchId}#${signal.batchIndex}`);
  
  // At signal time
  console.log(`\n⏱️  At Signal Time:`);
  console.log(`   ├── Price: ${formatUsd(signal.priceAtSignal)}`);
  console.log(`   ├── MCap: ${formatUsd(signal.mcapAtSignal)}`);
  console.log(`   ├── Liquidity: ${formatUsd(signal.liquidityAtSignal)}`);
  console.log(`   ├── Holders: ${signal.holdersAtSignal}`);
  console.log(`   └── Sell Ratio: ${(parseFloat(signal.sellRatio) * 100).toFixed(1)}%`);
  
  // Current state
  const priceChange = signal.currentPrice && signal.priceAtSignal 
    ? ((parseFloat(signal.currentPrice) / parseFloat(signal.priceAtSignal) - 1) * 100)
    : 0;
  
  console.log(`\n📈 Current State:`);
  console.log(`   ├── Price: ${formatUsd(signal.currentPrice)} (${formatPct(priceChange)} since signal)`);
  console.log(`   ├── MCap: ${formatUsd(signal.currentMcap)}`);
  console.log(`   ├── Holders: ${signal.currentHolders}`);
  console.log(`   ├── Total Volume: ${formatUsd(signal.totalVolume)}`);
  console.log(`   ├── Txs: ${signal.buyTxs} buys / ${signal.sellTxs} sells`);
  console.log(`   └── Top 10 Hold: ${signal.top10Hold}%`);
  
  // Performance
  console.log(`\n🏆 Token Performance:`);
  console.log(`   ├── Max Multiplier: ${signal.maxMultiplier}x`);
  console.log(`   ├── Max % Gain: ${formatPct(signal.maxPctGain)}`);
  console.log(`   └── ${signal.signalLabel} Max: ${signal.labelMaxMultiplier || '-'}x (${formatPct(signal.labelMaxPctGain)})`);
}

/**
 * Display wallet info from signal-detail
 */
function displayWallets(wallets) {
  console.log(`\n👛 Participating Wallets (${wallets.length}):`);
  
  wallets.forEach((w, i) => {
    const isKol = w.addressInfo?.kolAddress;
    const twitter = w.addressInfo?.twitterHandle;
    const pnl = parseFloat(w.pnl7d);
    const roi = parseFloat(w.roi);
    
    console.log(`\n   ${i + 1}. ${w.walletAddress.slice(0, 8)}...${w.walletAddress.slice(-4)}`);
    if (isKol) console.log(`      🎤 KOL: @${twitter}`);
    console.log(`      ├── 7d PnL: ${formatUsd(pnl)} ${pnl >= 0 ? '🟢' : '🔴'}`);
    console.log(`      ├── ROI: ${formatPct(roi)}`);
    console.log(`      └── Win Rate: ${parseFloat(w.winRate).toFixed(1)}%`);
  });
}

// ============================================================
// MAIN TEST
// ============================================================

async function main() {
  console.log('🚀 Signal Pipeline - Test Polling\n');
  console.log('=' .repeat(60));
  
  try {
    // Step 1: Fetch filter activity overview
    const data = await fetchFilterActivity(501, '1', 3);  // Solana, BUY signals, 3 results
    
    console.log(`\n✅ Fetched ${data.activityList.length} signals`);
    console.log(`   └── hasNext: ${data.hasNext}`);
    console.log(`   └── tokenInfo entries: ${Object.keys(data.tokenInfo).length}`);
    console.log(`   └── overviewList entries: ${data.overviewList.length}`);
    
    // Step 2: Process each activity
    for (let i = 0; i < data.activityList.length; i++) {
      const activity = data.activityList[i];
      
      // Join with token info and overview
      const signal = joinSignalData(activity, data.tokenInfo, data.overviewList);
      
      // Display the signal
      displaySignal(signal, i);
      
      // Step 3: Fetch wallet details for this signal
      console.log(`\n   ⏳ Fetching wallet details...`);
      const { chainId, tokenAddress } = parseTokenKey(activity.tokenKey);
      const detail = await fetchSignalDetail(chainId, tokenAddress, activity.batchId, activity.batchIndex);
      
      // Display wallets
      displayWallets(detail.addresses);
    }
    
    console.log(`\n\n${'═'.repeat(60)}`);
    console.log('✅ Test completed successfully!');
    console.log(`${'═'.repeat(60)}\n`);
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
