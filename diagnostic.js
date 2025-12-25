/**
 * Comprehensive Diagnostic Script
 * 
 * Tests all TelegramDB channels and identifies issues.
 * Run: node diagnostic.js
 */

import { config } from 'dotenv';
config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const CHANNELS = {
  // Main public channel
  public: { id: '-1003474351030', name: 'Public Signals' },
  
  // Archive
  archive: { id: '-1003645445736', name: 'Archive' },
  
  // Per-chain channels
  sol: {
    index: { id: '-1003359608037', name: 'SOL Index' },
    signals: { id: '-1003683149932', name: 'SOL Signals' },
    tokens: { id: '-1003300774874', name: 'SOL Tokens' },
    wallets: { id: '-1003664436076', name: 'SOL Wallets' },
  },
  eth: {
    index: { id: '-1003584605646', name: 'ETH Index' },
    signals: { id: '-1003578324311', name: 'ETH Signals' },
    tokens: { id: '-1003359979587', name: 'ETH Tokens' },
    wallets: { id: '-1003674004589', name: 'ETH Wallets' },
  },
  bsc: {
    index: { id: '-1003672339048', name: 'BSC Index' },
    signals: { id: '-1003512733161', name: 'BSC Signals' },
    tokens: { id: '-1003396432095', name: 'BSC Tokens' },
    wallets: { id: '-1003232990934', name: 'BSC Wallets' },
  },
  base: {
    index: { id: '-1003269677620', name: 'BASE Index' },
    signals: { id: '-1003646542784', name: 'BASE Signals' },
    tokens: { id: '-1003510261312', name: 'BASE Tokens' },
    wallets: { id: '-1003418587058', name: 'BASE Wallets' },
  },
};

async function api(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function getChannelInfo(chatId, name) {
  try {
    const chat = await api('getChat', { chat_id: chatId });
    if (!chat.ok) {
      return { name, chatId, status: 'ERROR', error: chat.description };
    }
    
    const result = {
      name,
      chatId,
      status: 'OK',
      title: chat.result.title,
      type: chat.result.type,
      hasPinned: !!chat.result.pinned_message,
      pinnedMsgId: chat.result.pinned_message?.message_id || null,
      pinnedDate: chat.result.pinned_message?.date 
        ? new Date(chat.result.pinned_message.date * 1000).toISOString()
        : null,
    };
    
    // Check pinned message content
    if (chat.result.pinned_message?.text) {
      const text = chat.result.pinned_message.text;
      const lines = text.split('\n');
      result.pinnedFirstLine = lines[0]?.slice(0, 50) + (lines[0]?.length > 50 ? '...' : '');
      result.pinnedLineCount = lines.length;
      result.pinnedCharCount = text.length;
      
      // Try to parse as JSON (skip first line which is the key)
      try {
        const jsonStr = lines.slice(1).join('\n');
        const data = JSON.parse(jsonStr);
        result.pinnedDataType = 'JSON';
        result.pinnedKeys = Object.keys(data).slice(0, 10);
        
        // Extract useful stats
        if (data.lastSigs) result.lastSigsCount = data.lastSigs.length;
        if (data.trackedTokens) result.trackedTokensCount = data.trackedTokens.length;
        if (data.tokenPeaks) result.tokenPeaksCount = Object.keys(data.tokenPeaks).length;
        if (data.wallets) result.walletsCount = Object.keys(data.wallets).length;
        if (data.updatedAt) result.lastUpdated = new Date(data.updatedAt).toISOString();
      } catch {
        result.pinnedDataType = 'TEXT';
      }
    }
    
    return result;
  } catch (err) {
    return { name, chatId, status: 'EXCEPTION', error: err.message };
  }
}

async function getRecentMessages(chatId, name, limit = 5) {
  try {
    // Get history requires different approach - use getUpdates or forwarding
    // For channels, we can check the pinned message timing
    return { name, note: 'Use getChat for channel inspection' };
  } catch (err) {
    return { name, error: err.message };
  }
}

async function testBotPermissions(chatId, name) {
  try {
    const member = await api('getChatMember', { 
      chat_id: chatId, 
      user_id: BOT_TOKEN.split(':')[0] // Bot user ID from token
    });
    
    if (!member.ok) {
      return { name, chatId, status: 'ERROR', error: member.description };
    }
    
    return {
      name,
      chatId,
      status: member.result.status,
      canPost: member.result.can_post_messages,
      canEdit: member.result.can_edit_messages,
      canDelete: member.result.can_delete_messages,
      canPin: member.result.can_pin_messages,
    };
  } catch (err) {
    return { name, chatId, status: 'EXCEPTION', error: err.message };
  }
}

async function runDiagnostics() {
  console.log('='.repeat(60));
  console.log('ALPHALERT SIGNAL PIPELINE - DIAGNOSTIC REPORT');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Bot Token: ${BOT_TOKEN?.slice(0, 10)}...${BOT_TOKEN?.slice(-5)}`);
  console.log();

  // Test bot info
  console.log('📱 BOT INFO');
  console.log('-'.repeat(40));
  const botInfo = await api('getMe');
  if (botInfo.ok) {
    console.log(`   Name: ${botInfo.result.first_name}`);
    console.log(`   Username: @${botInfo.result.username}`);
    console.log(`   ID: ${botInfo.result.id}`);
    console.log(`   Can Join Groups: ${botInfo.result.can_join_groups}`);
    console.log(`   Can Read Messages: ${botInfo.result.can_read_all_group_messages}`);
  } else {
    console.log(`   ❌ Error: ${botInfo.description}`);
  }
  console.log();

  // Test each channel
  console.log('📊 CHANNEL STATUS');
  console.log('-'.repeat(40));
  
  const results = {
    public: await getChannelInfo(CHANNELS.public.id, CHANNELS.public.name),
    archive: await getChannelInfo(CHANNELS.archive.id, CHANNELS.archive.name),
  };
  
  // Per-chain channels
  for (const chain of ['sol', 'eth', 'bsc', 'base']) {
    results[chain] = {};
    for (const type of ['index', 'signals', 'tokens', 'wallets']) {
      const ch = CHANNELS[chain][type];
      results[chain][type] = await getChannelInfo(ch.id, ch.name);
    }
  }
  
  // Display results
  console.log(`\n   📢 ${results.public.name}: ${results.public.status}`);
  if (results.public.hasPinned) {
    console.log(`      Pinned: Yes (msg ${results.public.pinnedMsgId})`);
  }
  
  console.log(`\n   📦 ${results.archive.name}: ${results.archive.status}`);
  
  for (const chain of ['sol', 'eth', 'bsc', 'base']) {
    console.log(`\n   🔗 ${chain.toUpperCase()}`);
    for (const type of ['index', 'signals', 'tokens', 'wallets']) {
      const r = results[chain][type];
      const status = r.status === 'OK' ? '✅' : '❌';
      let details = '';
      
      if (r.status === 'OK') {
        if (type === 'index') {
          details = r.hasPinned 
            ? `pinned, ${r.trackedTokensCount || 0} tokens, ${r.lastSigsCount || 0} sigs`
            : 'NO PINNED MSG';
        } else {
          details = r.hasPinned ? `pinned (${r.pinnedDate?.slice(0, 10)})` : 'no pinned';
        }
        if (r.lastUpdated) {
          const age = Date.now() - new Date(r.lastUpdated).getTime();
          const hours = (age / (1000 * 60 * 60)).toFixed(1);
          details += `, updated ${hours}h ago`;
        }
      } else {
        details = r.error || 'unknown error';
      }
      
      console.log(`      ${status} ${type}: ${details}`);
    }
  }
  
  // Bot permissions check
  console.log('\n📝 BOT PERMISSIONS (Public Channel)');
  console.log('-'.repeat(40));
  const perms = await testBotPermissions(CHANNELS.public.id, 'Public');
  console.log(`   Status: ${perms.status}`);
  console.log(`   Can Post: ${perms.canPost}`);
  console.log(`   Can Edit: ${perms.canEdit}`);
  console.log(`   Can Delete: ${perms.canDelete}`);
  console.log(`   Can Pin: ${perms.canPin}`);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY & RECOMMENDATIONS');
  console.log('='.repeat(60));
  
  const issues = [];
  
  // Check for missing index pins
  for (const chain of ['sol', 'eth', 'bsc', 'base']) {
    const idx = results[chain].index;
    if (idx.status === 'OK' && !idx.hasPinned) {
      issues.push(`⚠️ ${chain.toUpperCase()} Index has no pinned message - cold starts will lose state`);
    }
    if (idx.status === 'OK' && idx.hasPinned && idx.trackedTokensCount === 0) {
      issues.push(`⚠️ ${chain.toUpperCase()} Index has 0 tracked tokens`);
    }
  }
  
  // Check for stale updates
  for (const chain of ['sol', 'eth', 'bsc', 'base']) {
    const idx = results[chain].index;
    if (idx.lastUpdated) {
      const age = Date.now() - new Date(idx.lastUpdated).getTime();
      const hours = age / (1000 * 60 * 60);
      if (hours > 24) {
        issues.push(`⚠️ ${chain.toUpperCase()} Index not updated in ${hours.toFixed(0)} hours`);
      }
    }
  }
  
  if (issues.length === 0) {
    console.log('✅ No critical issues detected');
  } else {
    issues.forEach(i => console.log(i));
  }
  
  console.log('\n📋 RAW RESULTS (for debugging):');
  console.log(JSON.stringify(results, null, 2));
  
  return results;
}

runDiagnostics().catch(console.error);
