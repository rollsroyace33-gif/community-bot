// Supabase access for the scheduled_tasks table (see supabase/schema.sql).
// Note: task.state can hold secrets (e.g. the number guess answer). Never log it.
const supabase = require('../db');

const ACTIVE = ['pending', 'announced', 'running'];

function check(error, what) {
  if (error) throw new Error(`scheduled_tasks ${what}: ${error.message}`);
}

async function listActive() {
  const { data, error } = await supabase.from('scheduled_tasks').select('*').in('status', ACTIVE).order('run_at');
  check(error, 'list');
  return data || [];
}

async function get(id) {
  const { data, error } = await supabase.from('scheduled_tasks').select('*').eq('id', id).maybeSingle();
  check(error, 'get');
  return data;
}

async function create(row) {
  const { data, error } = await supabase.from('scheduled_tasks').insert(row).select().single();
  check(error, 'insert');
  return data;
}

// Update a task. With fromStatuses, it only applies while the task is still in one of
// those statuses, so two code paths can never move the same task twice (e.g. start + cancel).
// Returns the updated row, or null if nothing matched.
async function update(id, patch, fromStatuses) {
  let q = supabase.from('scheduled_tasks').update(patch).eq('id', id);
  if (fromStatuses) q = q.in('status', fromStatuses);
  const { data, error } = await q.select();
  check(error, 'update');
  return data && data.length ? data[0] : null;
}

module.exports = { ACTIVE, listActive, get, create, update };
