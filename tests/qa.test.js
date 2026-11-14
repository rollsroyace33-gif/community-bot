// HΛVØCZ Q&A answer-style test. Run: node tests/qa.test.js  (or npm run test:qa)
//
// Part 1 (offline, always): feeds badly formatted AI output through the real reply pipeline and
//   checks it comes out as plain prose, without robotic phrases, under 1800 characters.
// Part 2 (live): asks the REAL model (OPENAI_API_KEY / ANTHROPIC_API_KEY from your .env) the six test
//   questions, prints Vexo's answers and checks them. About 7 small AI calls. Skipped if no key is set.
//   Supabase is faked: nothing is read from or written to your database, and no key is ever printed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// fake Discord / Supabase settings; AI settings come from your .env (dotenv never overrides these)
Object.assign(process.env, {
  DISCORD_TOKEN: 'x', CLIENT_ID: 'x', GUILD_ID: 'g', HOME_GUILD_ID: 'g', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x',
});
const src = (p) => require.resolve(`../src/${p}`);

// fake Supabase: no taught facts, and nothing is written anywhere
const noop = () => api;
const api = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: [], error: null }) : noop) });
const fakeDb = { from: () => api, rpc: async () => ({ data: 0, error: null }) };
require.cache[src('db.js')] = { id: src('db.js'), filename: src('db.js'), loaded: true, exports: fakeDb };

const config = require(src('config.js'));
const ai = require(src('ai.js'));

// ---------------------------------------------------------------- checks
const LIST = /^\s*(?:[-*•▪◦]|\d{1,2}[.)])\s+/m;
const HEADING = /^\s*#{1,6}\s/m;
const BOLD = /\*\*|__/;
const ROBOTIC = /i won'?t make it up|i don'?t have that info yet/i;
const PHASE_FORMAT = /\bPhase\s+[IVXLC]+\s*[-–—:]/; // "Phase I - The Foundation" style
const FILLER_CLOSER = /(exciting times ahead|happy \w+ing|buckle up)[.!]?\s*\S*$/i;
const sentences = (t) => t.split(/(?<=[.!?…])\s+/).filter((s) => /\w/.test(s)).length;

// main roadmap stages, read from knowledge.md ("### Phase IV - The Ecosystem" -> "Ecosystem")
const knowledgeText = fs.readFileSync(path.join(__dirname, '..', 'knowledge.md'), 'utf8');
const STAGES = [...knowledgeText.matchAll(/^###\s*Phase\s+[IVXLC]+\s*-\s*(.+)$/gm)].map((m) => m[1].trim());
// A stage counts as mentioned if one of its name words appears, in any close form:
// "Revenue Engine" ~ "revenue", "Continuous Evolution" ~ "evolving", "The Art" ~ "artwork".
function stageStems(name) {
  const words = name.replace(/HΛVØCZ/g, '').split(/\s+/).filter((w) => w.length >= 3 && !/^the$/i.test(w));
  return words.flatMap((w) => {
    const word = w.toLowerCase();
    const stems = [word.slice(0, Math.max(3, word.length - 3))];
    if (word.endsWith('ution')) stems.push(word.slice(0, -5) + 'v'); // evolution -> evolv(e/ing)
    return stems;
  });
}
const mentionsStage = (text, name) => stageStems(name).some((s) => new RegExp(`\\b${s}`, 'i').test(text));

function styleProblems(answer) {
  const p = [];
  if (LIST.test(answer)) p.push('has a list');
  if (HEADING.test(answer)) p.push('has a heading');
  if (BOLD.test(answer)) p.push('has bold text');
  if (ROBOTIC.test(answer)) p.push('robotic phrase');
  if (PHASE_FORMAT.test(answer)) p.push('"Phase N - ..." formatting');
  if (FILLER_CLOSER.test(answer)) p.push('filler closer');
  if (answer.length >= 1800) p.push(`too long (${answer.length})`);
  return p;
}

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

(async () => {
  const realFetch = global.fetch;

  // ================================================================ part 1: offline
  console.log('== Part 1: formatting safety net (offline, scripted AI) ==');
  let scripted = '';
  let bodies = [];
  global.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: scripted } }], content: [{ type: 'text', text: scripted }] }) };
  };

  scripted = [
    '## The HΛVØCZ Roadmap',
    '1. **Phase I - The Foundation**: build the community',
    '2. **Phase II - The Art**: create the 1,222 NFTs',
    '- *Phase III*: the mint',
    '',
    "I don't have that info yet, and I won't make it up! Exact dates aren't out yet. Exciting times ahead! 🚀",
  ].join('\n');
  const fixed = await ai.converse("what's the roadmap?");
  console.log(`      in : ${JSON.stringify(scripted).slice(0, 110)}…`);
  console.log(`      out: ${JSON.stringify(fixed)}`);
  check(styleProblems(fixed).length === 0, `markdown + robotic phrases cleaned (${styleProblems(fixed).join(', ') || 'clean'})`);
  check(/Foundation/.test(fixed) && /mint/.test(fixed) && /dates aren't out yet/.test(fixed), 'content kept, only the format changed');

  scripted = 'The HΛVØCZ journey keeps going. '.repeat(120);
  bodies = [];
  const long = await ai.converse('give me everything');
  check(long.length < 1800 && /[.!?…]$/.test(long), `over-long answer tightened to ${long.length} chars, ends cleanly`);
  const tokens = bodies[0].max_completion_tokens ?? bodies[0].max_tokens; // first call = the answer itself
  check(tokens >= 350 && tokens <= 450, `answer call max tokens = ${tokens}`);

  // ================================================================ part 2: live
  global.fetch = realFetch;
  const key = config.ai.provider === 'anthropic' ? config.ai.anthropicKey : config.ai.openaiKey;
  console.log(`\n== Part 2: live answers (${config.ai.provider}, ${config.ai.provider === 'anthropic' ? config.ai.anthropicModel : config.ai.openaiModel}) ==`);
  if (!key) {
    console.log('SKIP  no AI key in .env, live answers not tested');
  } else {
    console.log(`      roadmap stages in knowledge.md: ${STAGES.join(' · ')}`);
    const ask = async (q) => {
      try {
        const a = await ai.converse(q);
        console.log(`\n> ${q}\n${a}\n  [${a.length} chars, ${sentences(a)} sentences]`);
        return a;
      } catch (err) {
        console.log(`\n> ${q}\n  AI ERROR: ${err.message.slice(0, 200)}`);
        return '';
      }
    };

    const answers = {};
    for (const q of ["What's the roadmap?", 'What is HΛVØCZ?', 'When is the mint?', "What's staking?", 'Where do we use those points?', "What's the weather today?"]) {
      answers[q] = await ask(q);
    }
    const roadmap2 = await ask("What's the roadmap?");
    console.log('');

    for (const [q, a] of Object.entries(answers)) {
      const p = styleProblems(a);
      check(a && p.length === 0, `"${q}" plain prose, no robotic phrase, < 1800 chars${p.length ? ` (${p.join(', ')})` : ''}`);
    }
    const missing = STAGES.filter((s) => !mentionsStage(answers["What's the roadmap?"], s));
    check(!missing.length, `roadmap mentions every stage${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
    const n = sentences(answers["What's the roadmap?"]);
    const len = answers["What's the roadmap?"].length;
    check(n >= 4 && n <= 8 && len <= 1000, `roadmap is a brief overview, not a dump (${n} sentences, ${len} chars; target 4-7, ~500-750)`);
    check(!/\b(stake|staking)\s+(their |your )?(nfts?|tokens?)\b|lock(ing)? up/i.test(answers["What's staking?"]), 'staking answer invents no mechanics (what gets staked / locking)');
    check(!/^the hΛvØcz roadmap (outlines|consists|is divided)/i.test(answers["What's the roadmap?"]), 'no encyclopedia intro');
    for (const q of ['When is the mint?', "What's staking?", 'Where do we use those points?']) {
      const s = sentences(answers[q]);
      check(s >= 1 && s <= 4, `"${q}" is focused (${s} sentences; target 1-3)`);
    }
    check(/not (been )?(announced|out|set|revealed)|isn'?t (out|announced|set)|yet/i.test(answers['When is the mint?']), 'mint answer says the date is not out yet (no invented date)');
    const w = answers["What's the weather today?"];
    // "Weather? Ha." counts as 2 "sentences", so allow 4 short ones
    check(w && !/phase|roadmap|mint/i.test(w) && sentences(w) <= 4 && w.length <= 300, 'weather question gets a short casual reply, no HΛVØCZ brief');
    check(roadmap2 && roadmap2 !== answers["What's the roadmap?"], 'asking the roadmap twice gives different wording');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('test crashed:', err.message);
  process.exit(1);
});
