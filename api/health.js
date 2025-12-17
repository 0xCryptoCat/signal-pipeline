/**
 * Health check endpoint
 */
export default async function handler(req, res) {
  return res.status(200).json({
    status: 'ok',
    service: 'signal-pipeline',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
