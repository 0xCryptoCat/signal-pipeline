/**
 * Health Check Endpoint - /api/health
 * 
 * Simple endpoint for cron services to ping to verify the service is alive.
 * Enhanced with keepalive support for cron-job.org.
 * 
 * Features:
 * - Returns 200 OK immediately (fast response)
 * - Logs ping for debugging
 * - Can be called more frequently (every 1 min) to keep cron active
 */
export default async function handler(req, res) {
  const now = new Date().toISOString();
  
  // Set headers for best keepalive compatibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Log ping (useful for Vercel logs)
  console.log(`🏥 Health check pinged at ${now}`);
  
  return res.status(200).json({
    status: 'ok',
    ok: true,
    service: 'signal-pipeline',
    timestamp: now,
    version: '1.1.0',
    message: 'Alphalert Signal Pipeline is healthy',
  });
}
