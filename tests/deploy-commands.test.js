// Slash command registration: global and home-guild are two separate steps; one failing never blocks the other.
// Run: node tests/deploy-commands.test.js
// Fully offline: Discord's REST API is faked. Nothing is sent anywhere.
const assert = require('assert');

const HOME = '100000000000000001';
Object.assign(process.env, { DISCORD_TOKEN: 'x', CLIENT_ID: '555', GUILD_ID: HOME, HOME_GUILD_ID: HOME, SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_KEY: 'x', OPENAI_API_KEY: 'x' });
const deploy = require('../src/deploy-commands');
const config = require('../src/config');

// a fake REST client: records every call; `fail` decides which route answers with which Discord error
function fakeRest(fail = {}) {
  const calls = [];
  return {
    calls,
    async put(route, { body }) {
      calls.push({ route, names: body.map((c) => c.name) });
      const kind = route.includes('/guilds/') ? 'home' : 'global';
      if (fail[kind]) {
        const err = new Error(fail[kind].message);
        err.code = fail[kind].code;
        err.rawError = { message: fail[kind].message };
        throw err;
      }
      return [];
    },
  };
}
const MISSING_ACCESS = { code: 50001, message: 'Missing Access' };
const client = (inHome) => ({ isReady: () => true, guilds: { cache: { has: (id) => inHome && id === HOME } } });
const capture = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(`LOG ${l}`), err: (l) => lines.push(`ERR ${l}`) };
};

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

(async () => {
  const { globalBody, homeBody } = deploy.bodies();
  const globalNames = globalBody.map((c) => c.name);

  await test('every customer-facing command is in the global list; only /admin is home-only', () => {
    for (const n of ['nftradar', 'solradar', 'giveaway', 'setup', 'status', 'help', 'automod']) assert.ok(globalNames.includes(n), `/${n} is global`);
    assert.deepEqual(homeBody.map((c) => c.name), ['admin']);
    assert.ok(!globalNames.includes('admin'));
    assert.ok(globalBody.every((c) => c.contexts[0] === 0), 'server-only, no DMs');
  });

  await test('home guild answers "Missing Access": global commands are still registered, one short skip line', async () => {
    const rest = fakeRest({ home: MISSING_ACCESS });
    const r = await deploy.registerCommands(null, { rest });
    assert.equal(r.global.ok, true);
    assert.equal(r.global.count, globalBody.length);
    assert.equal(r.home.skipped, 'not reachable');
    const c = capture();
    deploy.logResult(r, c.log, c.err);
    assert.deepEqual(c.lines, [`LOG [commands] global: registered ${globalBody.length} command(s) for all servers`, 'LOG [commands] home guild not reachable, skipped /admin commands']);
  });

  await test('the bot is not in the home server: the home step is skipped without even trying', async () => {
    const rest = fakeRest();
    const r = await deploy.registerCommands(client(false), { rest });
    assert.equal(rest.calls.length, 1, 'only the global call');
    assert.ok(!rest.calls[0].route.includes('/guilds/'));
    assert.equal(r.global.ok, true);
    assert.ok(r.home.skipped);
  });

  await test('the bot is in the home server: both steps succeed, one line each', async () => {
    const rest = fakeRest();
    const r = await deploy.registerCommands(client(true), { rest });
    assert.equal(rest.calls.length, 2);
    assert.ok(rest.calls[1].route.includes(`/guilds/${HOME}/`));
    assert.deepEqual(rest.calls[1].names, ['admin']);
    const c = capture();
    deploy.logResult(r, c.log, c.err);
    assert.deepEqual(c.lines, [`LOG [commands] global: registered ${globalBody.length} command(s) for all servers`, 'LOG [commands] home guild: registered 1 command(s) (/admin)']);
  });

  await test('the global step fails: the home step still runs, and the failure is one clear line', async () => {
    const rest = fakeRest({ global: { code: 0, message: 'Service Unavailable\n<html>long page</html>' } });
    const r = await deploy.registerCommands(client(true), { rest });
    assert.equal(r.global.ok, false);
    assert.equal(r.home.ok, true);
    const c = capture();
    deploy.logResult(r, c.log, c.err);
    assert.equal(c.lines.length, 2);
    assert.equal(c.lines[0], `ERR [commands] global: FAILED to register ${globalBody.length} command(s): Service Unavailable (run "npm run deploy" to retry)`);
  });

  await test('another home error (not "not reachable") is reported as a failure, global unaffected', async () => {
    const r = await deploy.registerCommands(null, { rest: fakeRest({ home: { code: 50035, message: 'Invalid Form Body' } }) });
    assert.equal(r.global.ok, true);
    const c = capture();
    deploy.logResult(r, c.log, c.err);
    assert.equal(c.lines[1], 'ERR [commands] home guild: FAILED to register 1 command(s): Invalid Form Body');
  });

  await test('no home server id set: only the global step', async () => {
    const saved = config.homeGuildId;
    config.homeGuildId = '';
    const rest = fakeRest();
    const r = await deploy.registerCommands(null, { rest });
    config.homeGuildId = saved;
    assert.equal(rest.calls.length, 1);
    assert.equal(r.global.ok, true);
    assert.ok(r.home.skipped);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
