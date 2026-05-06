/**
 * Redis client singleton — shared by nonce store, session, and BullMQ.
 */

const Redis = require('ioredis');
const config = require('./config');

let redis = null;

function getRedis() {
  if (!redis) {
    const redisUrl = config.redis.url;
    // Log masked URL for debugging (hide password)
    const maskedUrl = redisUrl.replace(/:([^:@]+)@/, ':***@');
    console.log(`[Redis] Connecting to: ${maskedUrl}`);

    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 5) return null; // Stop retrying after 5 attempts
        return Math.min(times * 500, 3000);
      },
    });
    redis.on('error', (err) => console.error('[Redis] Connection error:', err.message || err.code || String(err)));
    redis.on('connect', () => console.log('[Redis] Connected successfully'));
  }
  return redis;
}

module.exports = { getRedis };
