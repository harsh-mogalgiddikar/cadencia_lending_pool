/**
 * Supabase client — uses service-role key for full backend access.
 * NEVER expose this client or key to the frontend.
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: { persistSession: false },
  }
);

module.exports = supabase;
