/**
 * Deep audit - check if firstTime field is in 7d window
 * 
 * Hypothesis: OKX pnl7d only includes tokens FIRST TRADED in last 7 days
 * (not just any activity in 7 days)
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
  console.log('🔬 First Trade Time Investigation\n');
  
  const walletAddress = 'BcvXND8eifmhfzJrLh9Xz4vB7UxxjeiZCHc2chrCAkex';
  const chainId = 501;
  const okxPnl7d = 12410;
  
  console.log(`📊 Wallet: ${walletAddress.slice(0, 12)}...`);
  console.log(`   OKX Reported pnl7d: ${formatUsd(okxPnl7d)}`);
  
  const allTokens = await fetchAllTradingHistory(chainId, walletAddress);
  console.log(`   Total tokens: ${allTokens.length}`);
  
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  
  // Check tokens with firstTime in 7d (new tokens this week)
  const newTokens = allTokens.filter(t => parseInt(t.firstTime || 0) >= sevenDaysAgo);
  
  console.log(`\n📋 Tokens with firstTime in last 7 days: ${newTokens.length}`);
  
  // If 0, check the actual firstTime values
  console.log(`\n📋 Sample of firstTime values (first 10 tokens by PnL):`);
  const sortedByPnl = [...allTokens].sort((a, b) => 
    parseFloat(b.totalPnl || 0) - parseFloat(a.totalPnl || 0)
  );
  
  for (const t of sortedByPnl.slice(0, 10)) {
    const firstTime = parseInt(t.firstTime || 0);
    const latestTime = parseInt(t.latestTime || 0);
    const firstDate = new Date(firstTime).toLocaleDateString();
    const latestDate = new Date(latestTime).toLocaleDateString();
    const pnl = parseFloat(t.totalPnl) || 0;
    
    console.log(`   ${(t.tokenSymbol || 'UNKNOWN').padEnd(12)} | First: ${firstDate.padEnd(10)} | Latest: ${latestDate.padEnd(10)} | PnL: ${formatUsd(pnl)}`);
  }
  
  // Hmm, let me try another approach - check the token-list endpoint with different params
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`🔬 Checking different sortType values...`);
  console.log(`${'═'.repeat(60)}`);
  
  // sortType=1 is PnL, let's try others
  for (const sortType of [1, 2, 3, 4, 5]) {
    const url = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list?walletAddress=${walletAddress}&chainId=${chainId}&isAsc=false&sortType=${sortType}&offset=0&limit=1&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    
    try {
      const data = await fetchJson(url);
      if (data.code === 0 && data.data.tokenList.length > 0) {
        const t = data.data.tokenList[0];
        console.log(`\n   sortType=${sortType}: Top token = ${t.tokenSymbol} (PnL: ${formatUsd(t.totalPnl)})`);
      }
    } catch (e) {
      console.log(`   sortType=${sortType}: Error`);
    }
  }
  
  // Let me check if there's a pnl7d field in the token data itself
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`🔬 Checking for pnl7d field in token data...`);
  console.log(`${'═'.repeat(60)}`);
  
  const sampleToken = allTokens[0];
  console.log(`\n   Sample token fields:`);
  console.log(`   ${Object.keys(sampleToken).join(', ')}`);
  
  // Check if there's pnl7d
  if (sampleToken.pnl7d !== undefined) {
    console.log(`\n   ✅ Found pnl7d field!`);
    let sumPnl7d = 0;
    for (const t of allTokens) {
      sumPnl7d += parseFloat(t.pnl7d || 0);
    }
    console.log(`   Sum of all token pnl7d: ${formatUsd(sumPnl7d)}`);
  } else {
    console.log(`\n   ❌ No pnl7d field in token data`);
  }
  
  // Print full sample token
  console.log(`\n   Full sample token object:`);
  console.log(JSON.stringify(sampleToken, null, 2));
}

main().catch(console.error);
