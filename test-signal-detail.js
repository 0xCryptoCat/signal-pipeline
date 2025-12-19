// Test to examine signal detail wallet data
const t = Date.now();

async function main() {
  // Get signals from activity feed
  const url = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview?t=${t}`;
  
  const body = {
    chainId: 501,
    trend: '1',
    signalLabelList: [1, 2, 3],
    protocolIdList: [],
    tokenMetricsFilter: {},
    signalMetricsFilter: {},
    pageSize: 10
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  const list = data.data?.activityList || [];
  
  console.log('=== Comparing addressNum vs Actual Wallets ===\n');
  
  for (const sig of list.slice(0, 5)) {
    const parts = sig.tokenKey?.split('!@#') || [];
    const tokenAddress = parts[1];
    
    // Fetch detail
    const detailUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail?chainId=501&tokenContractAddress=${tokenAddress}&batchId=${sig.batchId}&batchIndex=${sig.batchIndex}&t=${t}`;
    
    const detailRes = await fetch(detailUrl);
    const detail = await detailRes.json();
    const actualCount = detail.data?.addresses?.length || 0;
    
    const match = sig.addressNum === actualCount ? '✅' : '❌';
    console.log(`${match} addressNum: ${sig.addressNum} | Actual: ${actualCount} | Token: ${tokenAddress.slice(0,8)}...`);
    
    if (sig.addressNum !== actualCount) {
      console.log(`   batchId: ${sig.batchId}, batchIndex: ${sig.batchIndex}`);
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
}

main().catch(console.error);
