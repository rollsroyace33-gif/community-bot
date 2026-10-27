const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

module.exports = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false },
});
