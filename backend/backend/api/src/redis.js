/**
 * Redis client singleton — shared by nonce store, session, and BullMQ.
 */

const Redis = require('ioredis');
const config = require('./config');

let redis = null;

function getRedis() {
  if (!redis) {
    redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    });
    redis.on('error', (err) => console.error('[Redis] Connection error:', err.message));
    redis.on('connect', () => console.log('[Redis] Connected'));
  }
  return redis;
}

module.exports = { getRedis };
