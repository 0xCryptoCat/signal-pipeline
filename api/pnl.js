/**
 * /api/pnl - Token PnL Card Generator
 * 
 * Generates a shareable image card showing token performance.
 * 
 * Usage:
 *   /pnl <chain> <token_address>  - Generate PnL card for token
 *   Chains: sol, eth, bsc, base
 * 
 * POST /api/pnl (webhook mode - for Telegram bot)
 * GET /api/pnl?addr=<address>&chain=sol (API mode - for testing)
 */

import { TelegramDBv5, CHAIN_IDS, CHANNELS } from '../lib/telegram-db-v5.js';
import { generatePnlCardHtml, formatMcap, formatPrice, formatMult, multToPercent, getChainInfo, formatTimeDiff } from '../card-generator/pnl-generator.js';
import { generatePnlCard } from '../card-generator/puppeteer-card.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAINS = ['sol', 'eth', 'bsc', 'base'];
const PRIVATE_CHANNEL = CHANNELS.private;

// Channel config
const CHANNEL_NAME = 'AI Alpha Signals';
const BOT_USERNAME = '@aialphasignals';

// ============================================================
// TELEGRAM API HELPERS
// ============================================================

async function api(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function sendMessage(chatId, text, replyToMessageId = null) {
  const params = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
  return api('sendMessage', params);
}

async function sendPhoto(chatId, photoBuffer, caption = '', replyToMessageId = null) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'pnl-card.png');
  if (caption) formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');
  if (replyToMessageId) formData.append('reply_to_message_id', replyToMessageId);

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

async function deleteMessage(chatId, messageId) {
  return api('deleteMessage', { chat_id: chatId, message_id: messageId });
}

// ============================================================
// TOKEN LOOKUP
// ============================================================

/**
 * Find token in a specific chain database
 */
async function findTokenInChain(chain, address) {
  const normalizedAddr = address.toLowerCase().trim();
  
  try {
    const chainId = CHAIN_IDS[chain];
    if (!chainId) return null;
    
    const db = new TelegramDBv5(BOT_TOKEN, chainId);
    await db.load();
    
    // Search all tokens
    const tokens = db.db?.tokens || {};
    
    // Check both exact match and case-insensitive
    for (const [addr, token] of Object.entries(tokens)) {
      if (addr.toLowerCase() === normalizedAddr) {
        console.log(`   Found token ${token.sym} on ${chain}`);
        return { chain, address: addr, token };
      }
    }
  } catch (err) {
    console.log(`   Error searching ${chain}:`, err.message);
  }
  
  return null;
}

/**
 * Find token across all chain databases (fallback)
 */
async function findToken(address) {
  const normalizedAddr = address.toLowerCase().trim();
  
  for (const chain of CHAINS) {
    const result = await findTokenInChain(chain, normalizedAddr);
    if (result) return result;
  }
  
  return null;
}

/**
 * Get token data formatted for card generation
 */
function formatTokenData(chain, address, token) {
  const entryMcap = token.mc0 || null;
  const entryPrice = token.p0 || 0;
  const peakPrice = token.pPeak || entryPrice;
  const peakMcap = entryMcap && peakPrice && entryPrice 
    ? entryMcap * (peakPrice / entryPrice) 
    : null;
  const multiplier = token.peakMult || (peakPrice && entryPrice ? peakPrice / entryPrice : 1);
  
  // Calculate proper peakMult (same logic as gains.js)
  const storedPeakMult = token.peakMult || (token.pPeak && token.p0 ? token.pPeak / token.p0 : 1);
  const currentMult = token.mult || (token.pNow && token.p0 ? token.pNow / token.p0 : 1);
  const effectivePeakMult = storedPeakMult < 1.01 && currentMult < 1.0 ? currentMult : storedPeakMult;
  
  return {
    symbol: token.sym || 'UNKNOWN',
    chain,
    address,
    entryMcap,
    peakMcap,
    entryPrice,
    peakPrice,
    multiplier: effectivePeakMult,
    firstSeen: token.firstSeen || Date.now(),
    peakTime: token.peakTime || token.lastSig || Date.now(),
    signalCount: token.scnt || 1,
    avgScore: token.avgScr || 0,
    msgId: token.lastMsgId || token.msgId || null,
    channelName: CHANNEL_NAME,
    username: BOT_USERNAME,
    logoUrl: null,
  };
}

/**
 * Build signal link
 */
function buildSignalLink(msgId) {
  if (!msgId) return null;
  const channelId = PRIVATE_CHANNEL.replace('-100', '');
  return `https://t.me/c/${channelId}/${msgId}`;
}

/**
 * Generate text-based response (fallback when image generation not available)
 */
function generateTextResponse(data) {
  const chainInfo = getChainInfo(data.chain);
  const isLoss = data.multiplier < 1;
  const emoji = isLoss ? '📉' : data.multiplier >= 2 ? '🚀' : '📈';
  
  let msg = `${emoji} <b>$${data.symbol}</b> - ${chainInfo.name}\n`;
  msg += `<code>────────────────────</code>\n\n`;
  
  msg += `📊 <b>Performance</b>\n`;
  msg += `├ Multiplier: <b>${formatMult(data.multiplier)}</b> (${multToPercent(data.multiplier)})\n`;
  msg += `├ Entry Price: <b>${formatPrice(data.entryPrice)}</b>\n`;
  msg += `├ Peak Price: <b>${formatPrice(data.peakPrice)}</b>\n`;
  
  if (data.entryMcap) {
    msg += `├ Entry MC: <b>${formatMcap(data.entryMcap)}</b>\n`;
    if (data.peakMcap) {
      msg += `├ Peak MC: <b>${formatMcap(data.peakMcap)}</b>\n`;
    }
  }
  
  msg += `└ Signals: <b>${data.signalCount}</b>\n\n`;
  
  if (data.msgId) {
    msg += `🔗 <a href="${buildSignalLink(data.msgId)}">View Signal</a>\n`;
  }
  
  return msg;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  const startTime = Date.now();
  
  // Handle GET request (API testing mode)
  if (req.method === 'GET') {
    const { addr, chain } = req.query;
    
    if (!addr) {
      return res.status(400).json({ 
        error: 'Missing address', 
        usage: '/api/pnl?addr=<token_address>&chain=sol' 
      });
    }
    
    try {
      // Find token
      const result = await findToken(addr);
      
      if (!result) {
        return res.status(404).json({ 
          error: 'Token not found',
          address: addr 
        });
      }
      
      // Format data
      const data = formatTokenData(result.chain, result.address, result.token);
      
      // Generate HTML (for preview)
      const html = generatePnlCardHtml(data);
      
      // Return HTML for browser preview
      if (req.headers.accept?.includes('text/html')) {
        res.setHeader('Content-Type', 'text/html');
        return res.send(html);
      }
      
      // Return JSON
      return res.status(200).json({
        success: true,
        data,
        timing: Date.now() - startTime,
      });
    } catch (err) {
      console.error('PnL error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
  
  // Handle POST request (Telegram webhook)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const update = req.body;
  
  // Only handle messages with /pnl command
  if (!update.message?.text?.startsWith('/pnl')) {
    return res.status(200).json({ ok: true, ignored: true });
  }
  
  const chatId = update.message.chat.id;
  const messageId = update.message.message_id;
  const text = update.message.text.trim();
  
  // Parse command: /pnl <chain> <address>
  const parts = text.split(/\s+/);
  const chainArg = parts[1]?.toLowerCase();
  const address = parts[2];
  
  // Validate chain tag
  const validChains = ['sol', 'eth', 'bsc', 'base'];
  if (!chainArg || !validChains.includes(chainArg)) {
    await sendMessage(chatId, 
      '❌ <b>Usage:</b> <code>/pnl &lt;chain&gt; &lt;token_address&gt;</code>\n\n' +
      '<b>Chains:</b> sol, eth, bsc, base\n\n' +
      'Examples:\n' +
      '<code>/pnl sol So11111111111111111111111111111111111111112</code>\n' +
      '<code>/pnl eth 0x1234...abcd</code>',
      messageId
    );
    return res.status(200).json({ ok: true });
  }
  
  if (!address) {
    await sendMessage(chatId, 
      '❌ <b>Missing token address</b>\n\n' +
      '<b>Usage:</b> <code>/pnl ' + chainArg + ' &lt;token_address&gt;</code>',
      messageId
    );
    return res.status(200).json({ ok: true });
  }
  
  // Send "searching" message (we'll delete it later)
  const searchingMsg = await sendMessage(chatId, `🔍 Looking up token on ${chainArg.toUpperCase()}...`, messageId);
  const searchingMsgId = searchingMsg?.result?.message_id;
  
  try {
    // Find token in specified chain
    const result = await findTokenInChain(chainArg, address);
    
    if (!result) {
      await sendMessage(chatId,
        `❌ <b>Token not found on ${chainArg.toUpperCase()}</b>\n\n` +
        `Address: <code>${address.slice(0, 16)}...${address.slice(-8)}</code>\n\n` +
        `This token may not have any signals yet on this chain.`,
        messageId
      );
      return res.status(200).json({ ok: true, found: false });
    }
    
    // Format token data
    const data = formatTokenData(result.chain, result.address, result.token);
    
    console.log(`📊 PnL lookup: ${data.symbol} (${data.chain}) - ${data.multiplier.toFixed(2)}x`);
    
    // Generate and send image card
    try {
      const imageBuffer = await generatePnlCard(data);
      
      // Build caption with link to signal
      let caption = `<b>$${data.symbol}</b> on ${chainArg.toUpperCase()}`;
      if (data.msgId) {
        const channelId = PRIVATE_CHANNEL.replace('-100', '');
        caption += `\n\n🔗 <a href="https://t.me/c/${channelId}/${data.msgId}">View Signal</a>`;
      }
      
      await sendPhoto(chatId, imageBuffer, caption, messageId);
      
      // Delete the "searching" message
      if (searchingMsgId) {
        await deleteMessage(chatId, searchingMsgId).catch(() => {});
      }
    } catch (imgErr) {
      console.error('Image generation error:', imgErr);
      // Fallback to text response
      const textResponse = generateTextResponse(data);
      await sendMessage(chatId, textResponse, messageId);
      
      // Delete the "searching" message
      if (searchingMsgId) {
        await deleteMessage(chatId, searchingMsgId).catch(() => {});
      }
    }
    
    return res.status(200).json({ 
      ok: true, 
      found: true,
      data: {
        symbol: data.symbol,
        chain: data.chain,
        multiplier: data.multiplier,
      },
      timing: Date.now() - startTime,
    });
    
  } catch (err) {
    console.error('PnL error:', err);
    await sendMessage(chatId,
      `❌ <b>Error looking up token</b>\n\n${err.message}`,
      messageId
    );
    return res.status(200).json({ ok: true, error: err.message });
  }
}
