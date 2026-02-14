/**
 * Rate limiting middleware for Express
 */
function createRateLimiter(requestsPerMinute = 60) {
  const requests = new Map();

  return (req, res, next) => {
    // Skip rate limiting for health check
    if (req.path === '/health') return next();

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute

    // Get or create request list for this IP
    let reqTimes = requests.get(clientIp) || [];

    // Clean old requests
    reqTimes = reqTimes.filter(t => now - t < windowMs);

    // Check rate limit
    if (reqTimes.length >= requestsPerMinute) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Maximum ${requestsPerMinute} requests per minute allowed`,
      });
    }

    // Add current request
    reqTimes.push(now);
    requests.set(clientIp, reqTimes);

    next();
  };
}

module.exports = { createRateLimiter };
