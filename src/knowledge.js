// Community knowledge Vexo learns ONLY from the boss in the control channel, plus the list of
// member questions Vexo could not answer (so the boss can teach the answers).
//
// Privacy: nothing about members is stored. vexo_unanswered keeps only the question text
// (rewritten by the AI without names, then scrubbed here). No user id, name or message.
const supabase = require('./db');

// ---------------------------------------------------------------- secret detection
// Used before saving anything (and before a control message is even sent to the AI).
// Returns a short reason, or null. Public wallet addresses are fine; private keys are not.
function looksSecret(text) {
  const s = String(text || '');
  // "password: x" / "seed phrase is ..." (but "we never ask for your password" is fine)
  if (/\b(password|passwd|passphrase|pwd|seed ?phrase|mnemonic|recovery ?phrase|secret ?key|private ?key)\b\s*(is|=|:|-)\s*\S+/i.test(s)) return 'a password or key';
  if (/\b(0x)?[0-9a-f]{64}\b/i.test(s)) return 'a private key';
  if (/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/.test(s)) return 'a private key';
  if (/\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/.test(s)) return 'an API key or token';
  if (/\b[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,38}\b/.test(s)) return 'a Discord token';
  // 12 / 15 / 18 / 21 / 24 short lowercase words in a row = looks like a wallet seed phrase
  const seed = /(?:^|[\s:])((?:[a-z]{3,8}\s+){11,23}[a-z]{3,8})(?:$|[\s.])/.exec(s);
  if (seed && [12, 15, 18, 21, 24].includes(seed[1].trim().split(/\s+/).length)) return 'a seed phrase';
  return null;
}

// log a repeating DB error (e.g. table not created yet) only once
const warned = new Set();
function warnOnce(what, err) {
  const msg = `${what}: ${err.message || err}`;
  if (warned.has(msg)) return;
  warned.add(msg);
  console.error(msg, '(did you run supabase/schema.sql?)');
}

// ---------------------------------------------------------------- taught facts
// Every server has its own facts. guildId is the last argument of every function (left out = HΛVØCZ).
const guilds = require('./guilds');
const factsByGuild = new Map(); // guildId -> [{ id, fact }] (active facts)

// (re)load the active facts of every server; returns HΛVØCZ's list (startup log)
async function loadFacts() {
  try {
    const { data, error } = await supabase.from('vexo_knowledge').select('id,fact,guild_id').eq('active', true).order('id');
    if (error) throw error;
    factsByGuild.clear();
    for (const row of data || []) {
      const id = guilds.gid(row.guild_id);
      if (!factsByGuild.has(id)) factsByGuild.set(id, []);
      factsByGuild.get(id).push({ id: row.id, fact: row.fact });
    }
  } catch (err) {
    warnOnce('vexo_knowledge load', err);
  }
  return getFacts();
}

const getFacts = (guildId) => factsByGuild.get(guilds.gid(guildId)) || [];
const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const findSameFact = (text, guildId) => getFacts(guildId).find((f) => normalize(f.fact) === normalize(text)) || null;

async function addFact(text, createdBy, guildId) {
  const { data, error } = await supabase
    .from('vexo_knowledge')
    .insert({ guild_id: guilds.gid(guildId), fact: text, source: 'control channel', created_by: createdBy })
    .select('id,fact')
    .single();
  if (error) throw new Error(`vexo_knowledge insert: ${error.message}`);
  await loadFacts();
  return data;
}

async function editFact(id, text, guildId) {
  const { data, error } = await supabase
    .from('vexo_knowledge')
    .update({ fact: text })
    .eq('guild_id', guilds.gid(guildId))
    .eq('id', id)
    .eq('active', true)
    .select('id,fact');
  if (error) throw new Error(`vexo_knowledge update: ${error.message}`);
  await loadFacts();
  return data && data[0];
}

// soft delete: the row stays (active = false), so a mistake can be undone in Supabase
async function forgetFact(id, guildId) {
  const { data, error } = await supabase
    .from('vexo_knowledge')
    .update({ active: false })
    .eq('guild_id', guilds.gid(guildId))
    .eq('id', id)
    .eq('active', true)
    .select('id,fact');
  if (error) throw new Error(`vexo_knowledge forget: ${error.message}`);
  await loadFacts();
  return data && data[0];
}

// /knowledge clear: forget every taught fact of one server (soft delete). Returns how many.
async function forgetAllFacts(guildId) {
  const { data, error } = await supabase
    .from('vexo_knowledge')
    .update({ active: false })
    .eq('guild_id', guilds.gid(guildId))
    .eq('active', true)
    .select('id');
  if (error) throw new Error(`vexo_knowledge clear: ${error.message}`);
  await loadFacts();
  return (data || []).length;
}

// ---------------------------------------------------------------- unanswered questions
const unansweredByGuild = new Map(); // guildId -> unresolved rows, loaded on first use

const STOP = new Set(
  'the a an is are was were be will what when where who why how which do does did can could should would of to for in on at it its this that i you we they my your our me us about any there have has tell please vexo ki kobe keno kothay kemne kivabe ar'.split(' ')
);
const words = (s) => normalize(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
// near-duplicate = at least half of the meaningful words overlap
function similar(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared) >= 0.5;
}

// strip anything personal or risky that slipped through the AI rewrite
const scrub = (q) =>
  String(q || '')
    .replace(/<[@#][!&]?\d+>/g, '')
    .replace(/@(everyone|here)/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\S+@\S+\.\S+/g, '')
    .replace(/\d{6,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

async function loadUnanswered(guildId) {
  const id = guilds.gid(guildId);
  if (unansweredByGuild.has(id)) return unansweredByGuild.get(id);
  const { data, error } = await supabase
    .from('vexo_unanswered')
    .select('id,question,times_asked')
    .eq('guild_id', id)
    .eq('resolved', false)
    .order('times_asked', { ascending: false })
    .limit(500);
  if (error) throw error;
  unansweredByGuild.set(id, data || []);
  return unansweredByGuild.get(id);
}

// Save a question Vexo couldn't answer (merged with near-duplicates). Never throws.
async function recordUnanswered(question, guildId) {
  try {
    const q = scrub(question);
    if (q.length < 5 || looksSecret(q)) return;
    const list = await loadUnanswered(guildId);
    const match = list.find((row) => similar(row.question, q));
    if (match) {
      match.times_asked += 1;
      const { error } = await supabase
        .from('vexo_unanswered')
        .update({ times_asked: match.times_asked, last_asked: new Date().toISOString() })
        .eq('guild_id', guilds.gid(guildId))
        .eq('id', match.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('vexo_unanswered')
        .insert({ guild_id: guilds.gid(guildId), question: q })
        .select('id,question,times_asked')
        .single();
      if (error) throw error;
      list.push(data);
    }
  } catch (err) {
    warnOnce('vexo_unanswered save', err);
  }
}

async function topUnanswered(limit = 10, guildId) {
  const list = await loadUnanswered(guildId);
  return [...list].sort((a, b) => b.times_asked - a.times_asked).slice(0, limit);
}

async function resolveUnanswered(ids, guildId) {
  const list = await loadUnanswered(guildId);
  const valid = ids.filter((id) => list.some((row) => row.id === id));
  if (!valid.length) return [];
  const { error } = await supabase.from('vexo_unanswered').update({ resolved: true }).eq('guild_id', guilds.gid(guildId)).in('id', valid);
  if (error) throw new Error(`vexo_unanswered resolve: ${error.message}`);
  unansweredByGuild.set(guilds.gid(guildId), list.filter((row) => !valid.includes(row.id)));
  return valid;
}
module.exports = {
  looksSecret,
  loadFacts,
  getFacts,
  findSameFact,
  addFact,
  editFact,
  forgetFact,
  forgetAllFacts,
  recordUnanswered,
  topUnanswered,
  resolveUnanswered,
};
