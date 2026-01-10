/**
 * Screenshot API Card Generator
 * Uses external screenshot service to render HTML/CSS to image
 * This preserves the full HTML design with all CSS features
 */

import { generatePnlCardHtml } from './pnl-generator.js';

// Screenshot API options:
// 1. screenshotapi.net - 100 free/month
// 2. htmlcsstoimage.com - 50 free/month
// 3. apiflash.com - 100 free/month

const SCREENSHOT_API_KEY = process.env.SCREENSHOT_API_KEY;
const SCREENSHOT_API = process.env.SCREENSHOT_API || 'apiflash';

/**
 * Generate PnL card using screenshot API
 * Returns PNG buffer
 */
export async function generatePnlCard(data) {
  // Generate HTML using existing generator
  const html = generatePnlCardHtml(data);
  
  // Encode HTML for URL
  const encodedHtml = encodeURIComponent(html);
  
  let imageUrl;
  
  if (SCREENSHOT_API === 'apiflash') {
    // APIFlash - 100 free/month, good quality
    // Docs: https://apiflash.com/documentation
    const params = new URLSearchParams({
      access_key: SCREENSHOT_API_KEY,
      url: `data:text/html;charset=utf-8,${encodedHtml}`,
      width: '1200',
      height: '675',
      format: 'png',
      quality: '100',
      fresh: 'true',
      full_page: 'false',
      scroll_page: 'false',
      delay: '1', // Wait for fonts to load
    });
    
    const response = await fetch(`https://api.apiflash.com/v1/urltoimage?${params}`);
    if (!response.ok) {
      throw new Error(`APIFlash error: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
    
  } else if (SCREENSHOT_API === 'screenshotapi') {
    // ScreenshotAPI.net - 100 free/month
    const response = await fetch('https://shot.screenshotapi.net/screenshot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: SCREENSHOT_API_KEY,
        url: `data:text/html;charset=utf-8,${encodedHtml}`,
        width: 1200,
        height: 675,
        output: 'image',
        file_type: 'png',
        wait_for_event: 'load',
      }),
    });
    
    if (!response.ok) {
      throw new Error(`ScreenshotAPI error: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
    
  } else if (SCREENSHOT_API === 'hcti') {
    // HTML CSS to Image - 50 free/month
    const HCTI_USER_ID = process.env.HCTI_USER_ID;
    const HCTI_API_KEY = process.env.HCTI_API_KEY;
    
    const response = await fetch('https://hcti.io/v1/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${HCTI_USER_ID}:${HCTI_API_KEY}`).toString('base64')}`,
      },
      body: JSON.stringify({
        html,
        google_fonts: 'Inter',
        viewport_width: 1200,
        viewport_height: 675,
        device_scale: 2,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HCTI error: ${response.status}`);
    }
    
    const result = await response.json();
    const imageResponse = await fetch(result.url);
    return Buffer.from(await imageResponse.arrayBuffer());
  }
  
  throw new Error(`Unknown screenshot API: ${SCREENSHOT_API}`);
}

export default { generatePnlCard };
