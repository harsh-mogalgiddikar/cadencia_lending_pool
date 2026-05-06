/**
 * Supabase client — uses service-role key for full backend access.
 * NEVER expose this client or key to the frontend.
 *
 * Uses a Proxy for lazy initialization: the real client is only created
 * on first property access, so a missing SUPABASE_URL will NOT crash
 * the server on startup — the healthcheck can still pass.
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!config.supabase.url || !config.supabase.serviceKey) {
    throw new Error(
      '[Supabase] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. ' +
      'Add them to your Railway environment variables.'
    );
  }
  _client = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false },
  });
  return _client;
}

// Transparent proxy — supabase.from(...) works exactly as before
// but the real client is only created on first use.
module.exports = new Proxy({}, {
  get(_target, prop) {
    return getClient()[prop];
  },
});
