/**
 * Cadencia CreditFlow — API Server
 *
 * Main Express app serving all REST endpoints.
 * This is the "api" process in the 3-process architecture.
 */

const express = require('express');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { getRedis } = require('./redis');

const authRoutes = require('./routes/auth');
const kycRoutes = require('./routes/kyc');
const loanRoutes = require('./routes/loans');
const poolRoutes = require('./routes/pool');

const app = express();

// ── Middleware ──

// Support comma-separated list of allowed origins: FRONTEND_URLS=https://x.vercel.app,http://localhost:8080
const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:8080')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// connect-redis v7 uses node-redis v4 API: client.set(key, val, { EX: ttl })
// ioredis expects positional args:          client.set(key, val, 'EX', ttl)
// Without this adapter every session.save() sends invalid Redis syntax and the
// cookie is never written — the user appears to stay logged out after auth.
function makeSessionAdapter(ioredisClient) {
  return {
    get:  (key)          => ioredisClient.get(key),
    set:  (key, val, opts) => {
      if (opts && typeof opts === 'object' && opts.EX) {
        return ioredisClient.set(key, val, 'EX', opts.EX);
      }
      return ioredisClient.set(key, val);
    },
    del:  (key)          => ioredisClient.del(key),
    expire: (key, ttl)   => ioredisClient.expire(key, ttl),
    pexpire: (key, ttl)  => ioredisClient.pexpire(key, ttl),
  };
}

// Session — httpOnly cookie backed by Redis (survives server restarts)
app.use(session({
  store: new RedisStore({ client: makeSessionAdapter(getRedis()) }),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',          // HTTPS only in prod
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax', // 'none' required for cross-origin (Vercel → Railway)
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Rate limiting on auth routes (100 req / 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 500, // higher limit in test env
  message: { error: 'Too many auth requests, try again later' },
});

// Rate limiting on KYC / loan submission endpoints (20 req / 15 min)
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 20,
  message: { error: 'Too many submission requests, try again later' },
});

// ── Routes ──

app.use('/api/auth', authLimiter, authRoutes);
// Apply stricter rate limit on public mutation endpoints
app.post('/api/kyc/submit', submitLimiter);
app.post('/api/loans/apply', submitLimiter);
app.use('/api/kyc', kycRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/pool', poolRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cadencia-api',
    network: config.algorand.network,
    mockKyc: config.flags.mockKyc,
  });
});

// ── Start ──

app.listen(config.port, () => {
  console.log(`[API] Cadencia CreditFlow API running on port ${config.port}`);
  console.log(`[API] Network: ${config.algorand.network}`);
  console.log(`[API] Mock KYC: ${config.flags.mockKyc}`);
});

module.exports = app;
