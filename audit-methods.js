/**
 * Deep audit - understand EXACTLY how OKX calculates pnl7d
 * 
 * Key question: Is pnl7d calculated from trades in last 7 days,
 * or is it cumulative PnL for tokens that had activity in last 7 days?
 */

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
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

async function fetchAllTradingHistory(chainId, walletAddress) {
  const allTokens = [];
  let offset = 0;
  
  while (true) {
    const url = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list?walletAddress=${walletAddress}&chainId=${chainId}&isAsc=false&sortType=1&offset=${offset}&limit=50&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    
    const data = await fetchJson(url);
    if (data.code !== 0) break;
    
    allTokens.push(...data.data.tokenList);
    
    if (!data.data.hasNext) break;
    offset = data.data.offset;
    
    await sleep(50);
  }
  
  return allTokens;
}

async function main() {
  console.log('🔬 Deep 7d PnL Investigation\n');
  
  const walletAddress = 'BcvXND8eifmhfzJrLh9Xz4vB7UxxjeiZCHc2chrCAkex';
  const chainId = 501;
  const okxPnl7d = 12410; // From signal-detail
  
  console.log(`📊 Wallet: ${walletAddress.slice(0, 12)}...`);
  console.log(`   OKX Reported pnl7d: ${formatUsd(okxPnl7d)}`);
  
  console.log(`\n📥 Fetching ALL trading history...`);
  const allTokens = await fetchAllTradingHistory(chainId, walletAddress);
  console.log(`   Total tokens: ${allTokens.length}`);
  
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  
  // Method 1: Sum totalPnl for tokens with latestTime in 7d
  let method1Pnl = 0;
  let method1Count = 0;
  
  // Method 2: Sum totalPnl for tokens with firstTime in 7d (new tokens only)
  let method2Pnl = 0;
  let method2Count = 0;
  
  // Method 3: Sum realizedPnl only (not unrealized)
  let method3Pnl = 0;
  let method3Count = 0;
  
  // Method 4: For tokens with activity in 7d, only count realized if sell happened in 7d
  let method4Pnl = 0;
  let method4Count = 0;
  
  for (const token of allTokens) {
    const latestTime = parseInt(token.latestTime || 0);
    const firstTime = parseInt(token.firstTime || 0);
    const totalPnl = parseFloat(token.totalPnl) || 0;
    const realizedPnl = parseFloat(token.realizedPnl) || 0;
    const unrealizedPnl = parseFloat(token.unrealizedPnl) || 0;
    const sellCount = parseInt(token.totalTxSell) || 0;
    
    const in7dByLatest = latestTime >= sevenDaysAgo;
    const in7dByFirst = firstTime >= sevenDaysAgo;
    
    // Method 1: Any activity in 7d
    if (in7dByLatest) {
      method1Pnl += totalPnl;
      method1Count++;
    }
    
    // Method 2: Token created/first traded in 7d
    if (in7dByFirst) {
      method2Pnl += totalPnl;
      method2Count++;
    }
    
    // Method 3: Realized only for tokens with 7d activity
    if (in7dByLatest) {
      method3Pnl += realizedPnl;
      method3Count++;
    }
    
    // Method 4: Realized for tokens with sells, unrealized for holds (7d activity)
    if (in7dByLatest) {
      if (sellCount > 0) {
        method4Pnl += realizedPnl;
      }
      method4Pnl += unrealizedPnl;
      method4Count++;
    }
  }
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 PnL CALCULATION METHODS COMPARISON`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`\n   OKX Reported pnl7d:           ${formatUsd(okxPnl7d)}`);
  console.log(`\n   Method 1 (totalPnl, 7d activity):     ${formatUsd(method1Pnl)} (${method1Count} tokens)`);
  console.log(`   Method 2 (totalPnl, new in 7d):       ${formatUsd(method2Pnl)} (${method2Count} tokens)`);
  console.log(`   Method 3 (realizedPnl only, 7d):      ${formatUsd(method3Pnl)} (${method3Count} tokens)`);
  console.log(`   Method 4 (realized+unrealized, 7d):   ${formatUsd(method4Pnl)} (${method4Count} tokens)`);
  
  // Check differences
  console.log(`\n📐 Differences from OKX:`);
  console.log(`   Method 1: ${formatUsd(method1Pnl - okxPnl7d)}`);
  console.log(`   Method 2: ${formatUsd(method2Pnl - okxPnl7d)}`);
  console.log(`   Method 3: ${formatUsd(method3Pnl - okxPnl7d)}`);
  console.log(`   Method 4: ${formatUsd(method4Pnl - okxPnl7d)}`);
  
  // Now let's try second wallet which was close
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`📊 SECOND WALLET (was close match)`);
  console.log(`${'═'.repeat(60)}`);
  
  const wallet2 = 'ADPCcUUS2qmSFtAgxiJMCVsk6WeoS1ux4QF8aJJeW78d';
  const okxPnl7d_2 = 702.19;
  
  console.log(`\n   OKX Reported pnl7d: ${formatUsd(okxPnl7d_2)}`);
  
  const tokens2 = await fetchAllTradingHistory(chainId, wallet2);
  console.log(`   Total tokens: ${tokens2.length}`);
  
  let w2_method1 = 0, w2_method2 = 0, w2_method3 = 0;
  let w2_c1 = 0, w2_c2 = 0;
  
  for (const token of tokens2) {
    const latestTime = parseInt(token.latestTime || 0);
    const firstTime = parseInt(token.firstTime || 0);
    const totalPnl = parseFloat(token.totalPnl) || 0;
    const realizedPnl = parseFloat(token.realizedPnl) || 0;
    
    const in7dByLatest = latestTime >= sevenDaysAgo;
    const in7dByFirst = firstTime >= sevenDaysAgo;
    
    if (in7dByLatest) {
      w2_method1 += totalPnl;
      w2_c1++;
    }
    if (in7dByFirst) {
      w2_method2 += totalPnl;
      w2_c2++;
    }
    if (in7dByLatest) {
      w2_method3 += realizedPnl;
    }
  }
  
  console.log(`\n   Method 1 (totalPnl, 7d activity):     ${formatUsd(w2_method1)} (${w2_c1} tokens)`);
  console.log(`   Method 2 (totalPnl, new in 7d):       ${formatUsd(w2_method2)} (${w2_c2} tokens)`);
  console.log(`   Method 3 (realizedPnl only, 7d):      ${formatUsd(w2_method3)}`);
  
  console.log(`\n📐 Differences from OKX:`);
  console.log(`   Method 1: ${formatUsd(w2_method1 - okxPnl7d_2)}`);
  console.log(`   Method 2: ${formatUsd(w2_method2 - okxPnl7d_2)}`);
  console.log(`   Method 3: ${formatUsd(w2_method3 - okxPnl7d_2)}`);
}

main().catch(console.error);
