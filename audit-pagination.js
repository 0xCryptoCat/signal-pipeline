/**
 * Deep audit - test pagination issue
 * 
 * Hypothesis: Wallets with many more than 100 tokens will show bigger discrepancies
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

async function countAllTokens(chainId, walletAddress) {
  let count = 0;
  let offset = 0;
  let hasNext = true;
  
  while (hasNext) {
    const url = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list?walletAddress=${walletAddress}&chainId=${chainId}&isAsc=false&sortType=1&offset=${offset}&limit=50&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    
    const data = await fetchJson(url);
    if (data.code !== 0) break;
    
    count += data.data.tokenList.length;
    hasNext = data.data.hasNext;
    offset = data.data.offset;
    
    console.log(`   Page: ${Math.floor(offset/50)} | Tokens so far: ${count} | hasNext: ${hasNext}`);
    
    if (count > 500) {
      console.log(`   ⚠️ Stopping at 500 tokens (too many)`);
      break;
    }
    
    await sleep(100);
  }
  
  return count;
}

async function main() {
  console.log('🔬 Pagination Investigation\n');
  
  // Wallet 1: BcvXND8eifmhfzJrLh9Xz4vB7UxxjeiZCHc2chrCAkex (big discrepancy)
  // Wallet 2: ADPCcUUS2qmSFtAgxiJMCVsk6WeoS1ux4QF8aJJeW78d (small discrepancy)
  
  const wallets = [
    { address: 'BcvXND8eifmhfzJrLh9Xz4vB7UxxjeiZCHc2chrCAkex', okxPnl: 12410, note: 'BIG discrepancy' },
    { address: 'ADPCcUUS2qmSFtAgxiJMCVsk6WeoS1ux4QF8aJJeW78d', okxPnl: 702, note: 'Small discrepancy' }
  ];
  
  for (const w of wallets) {
    console.log(`\n📊 ${w.address.slice(0, 12)}... (${w.note})`);
    console.log(`   OKX PnL 7d: ${formatUsd(w.okxPnl)}`);
    const count = await countAllTokens(501, w.address);
    console.log(`   ✅ Total tokens: ${count}`);
  }
  
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log('FINDING: If wallet has >100 tokens, our 100-token limit misses some!');
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(console.error);
