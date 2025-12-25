const BOT_TOKEN = '8369100757:AAGVf_PBjm-3dJpo_zaWik-fEQqm-iETVf0';
const ARCHIVE_CHANNEL = '-1003645445736';
const PRIVATE_CHANNEL = '-1003474351030';
const PUBLIC_CHANNEL = '-1003627230339';

async function main() {
  // Get pinned message from archive
  const chatRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${ARCHIVE_CHANNEL}`);
  const chat = await chatRes.json();
  
  if (!chat.ok || !chat.result.pinned_message?.document) {
    console.log('No config found');
    return;
  }
  
  // Get file
  const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${chat.result.pinned_message.document.file_id}`);
  const file = await fileRes.json();
  
  // Download config
  const configRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.result.file_path}`);
  const config = await configRes.json();
  
  console.log('\n=== LEADERBOARD URLS ===\n');
  
  const privateId = PRIVATE_CHANNEL.replace('-100', '');
  const publicId = PUBLIC_CHANNEL.replace('-100', '');
  
  // Private channel leaderboards
  console.log('PRIVATE CHANNEL:');
  for (const chain of ['sol', 'eth', 'bsc', 'base']) {
    const lb = config.leaderboards?.[chain]?.private || {};
    if (lb.wallets) console.log(`${chain.toUpperCase()} Wallets: https://t.me/c/${privateId}/${lb.wallets}`);
    if (lb.tokens) console.log(`${chain.toUpperCase()} Tokens:  https://t.me/c/${privateId}/${lb.tokens}`);
  }
  
  console.log('\nPUBLIC CHANNEL:');
  for (const chain of ['sol', 'eth', 'bsc', 'base']) {
    const lb = config.leaderboards?.[chain]?.public || {};
    if (lb.wallets) console.log(`${chain.toUpperCase()} Wallets: https://t.me/c/${publicId}/${lb.wallets}`);
    if (lb.tokens) console.log(`${chain.toUpperCase()} Tokens:  https://t.me/c/${publicId}/${lb.tokens}`);
  }
  
  console.log('\nSUMMARY MESSAGES:');
  if (config.summaries?.private) console.log(`Private: https://t.me/c/${privateId}/${config.summaries.private}`);
  if (config.summaries?.public) console.log(`Public:  https://t.me/c/${publicId}/${config.summaries.public}`);
}

main().catch(console.error);
