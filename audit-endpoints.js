/**
 * Deep audit - understand the 7d PnL calculation
 * 
 * Key insight: OKX "7d PnL" from signal-detail might be calculated differently
 * Let's check if there's a wallet-profile endpoint that gives aggregate stats
 */

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatUsd(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '$0';
  const sign = n < 0 ? '-' : '+';
  const absN = Math.abs(n);
  if (absN >= 1_000) return `${sign}$${(absN / 1_000).toFixed(2)}K`;
  return `${sign}$${absN.toFixed(2)}`;
}

async function main() {
  console.log('🔬 Wallet Profile Investigation\n');
  
  const walletAddress = 'BcvXND8eifmhfzJrLh9Xz4vB7UxxjeiZCHc2chrCAkex';
  const chainId = 501;
  
  // 1. Fetch wallet profile (might have aggregate PnL)
  console.log('📥 Fetching wallet-profile...');
  const profileUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/wallet-profile/query/address/info?chainId=${chainId}&walletAddress=${walletAddress}&t=${Date.now()}`;
  const profile = await fetchJson(profileUrl);
  
  console.log('\n📋 Wallet Profile Response:');
  console.log(JSON.stringify(profile.data, null, 2));
  
  // 2. Check if there's a summary endpoint
  console.log('\n📥 Fetching wallet summary...');
  const summaryUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/summary?walletAddress=${walletAddress}&chainId=${chainId}&t=${Date.now()}`;
  try {
    const summary = await fetchJson(summaryUrl);
    console.log('\n📋 Wallet Summary Response:');
    console.log(JSON.stringify(summary.data, null, 2));
  } catch (e) {
    console.log('   (endpoint not available)');
  }
  
  // 3. Check wallet-pnl endpoint
  console.log('\n📥 Fetching wallet-pnl...');
  const pnlUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/wallet-pnl?walletAddress=${walletAddress}&chainId=${chainId}&t=${Date.now()}`;
  try {
    const pnl = await fetchJson(pnlUrl);
    console.log('\n📋 Wallet PnL Response:');
    console.log(JSON.stringify(pnl.data, null, 2));
  } catch (e) {
    console.log('   (endpoint not available)');
  }
  
  // 4. Try wallet-portfolio
  console.log('\n📥 Fetching wallet-portfolio...');
  const portfolioUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/wallet-portfolio?walletAddress=${walletAddress}&chainId=${chainId}&t=${Date.now()}`;
  try {
    const portfolio = await fetchJson(portfolioUrl);
    console.log('\n📋 Wallet Portfolio Response:');
    console.log(JSON.stringify(portfolio.data, null, 2));
  } catch (e) {
    console.log('   (endpoint not available)');
  }
  
  // 5. Check address-detail
  console.log('\n📥 Fetching address-detail...');
  const detailUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/address-detail?walletAddress=${walletAddress}&chainId=${chainId}&t=${Date.now()}`;
  try {
    const detail = await fetchJson(detailUrl);
    console.log('\n📋 Address Detail Response:');
    console.log(JSON.stringify(detail.data, null, 2));
  } catch (e) {
    console.log('   (endpoint not available)');
  }
}

main().catch(console.error);
