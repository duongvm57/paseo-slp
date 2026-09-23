// tests/plugin-supervision.test.mjs — the Phase A configuration seam behind
// plugin/server/supervision/state.ts + plugin/shared/supervision.ts:
// private supervision.json under the SERVED daemon home only, raw-file
// SHA-256 CAS (rechecked after awaited agent validation), exact
// Lead→Supervisor route validation through a doubled Paseo SDK surface,
// archive/closed/provider/workspace rejection, duplicate-Lead rejection,
// "off" routes skipping liveness, schema-valid-but-inert "notify", and
// broken-file evidence semantics. No daemon, no network: PaseoLike is a
// structural double; the served home is injected like the real
// detectDaemonHome seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createSupervisionState, supervisionPath } from '../plugin/server/supervision/state.ts';
import { createJev } from '../plugin/server/jev.ts';
import { makeHome, targetOf } from './helpers/plugin-doubles.mjs';

const LEAD = '11111111-1111-4111-8111-111111111111';
const LEAD2 = '22222222-2222-4222-8222-222222222222';
const SUP = '33333333-3333-4333-8333-333333333333';
const WKS = 'wks_testworkspace';

// A state instance bound to `home` as the daemon home the process serves —
// the production seam is detectDaemonHome() (PASEO_HOME export); tests
// inject it so the served-home gate is exercised, not bypassed.
const stateFor = home => createSupervisionState({ servedHome: () => ({ daemonHome: home, source: 'env' }) });
const fileOf = home => supervisionPath(join(home, 'slp-runtime'));

const get = (state, home) => state.getSupervision({ schemaVersion: 1, target: targetOf(home) });
const set = (state, home, routes, expectedSha256, paseo) =>
  state.setSupervision({ schemaVersion: 1, target: targetOf(home), routes, expectedSha256 }, paseo);

const route = (over = {}) => ({
  leadAgentId: LEAD,
  leadWorkspaceId: WKS,
  supervisorAgentId: SUP,
  mode: 'shadow',
  pendingDelayMs: 60000,
  ...over,
});

// Structural PaseoLike double — refresh returns {agent} or {agent:null} and
// records which agent IDs were refreshed.
const makePaseo = agents => {
  const paseo = {
    calls: [],
    agents: {
      ref(id) {
        const refresh = async () => {
          paseo.calls.push(id);
          return { agent: agents[id] ?? null };
        };
        return { refresh };
      },
    },
  };
  return paseo;
};

const leadAgent = (over = {}) => ({
  id: LEAD, provider: 'slp-codex-lead', workspaceId: WKS, status: 'idle', archivedAt: null, ...over,
});
const supAgent = (over = {}) => ({
  id: SUP, provider: 'slp-codex-supervisor', workspaceId: WKS, status: 'idle', archivedAt: null, ...over,
});
const livePaseo = makePaseo({ [LEAD]: leadAgent(), [SUP]: supAgent() });

// ---------------------------------------------------------------------------
// Defaults and file semantics
// ---------------------------------------------------------------------------

test('absent file reads as unconfigured: empty routes, null sha, no error', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  const view = await get(state, home);
  assert.deepEqual(view, { schemaVersion: 1, routes: [], sha256: null, error: null });
  assert.equal(existsSync(fileOf(home)), false);
});

test('routes round-trip through set/get with 0600 atomic writes and restart load', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  const stored = await set(state, home, [route()], null, livePaseo);
  assert.equal(lstatSync(fileOf(home)).mode & 0o777, 0o600);
  assert.equal(stored.error, null);
  assert.equal(stored.routes.length, 1);
  assert.equal(typeof stored.sha256, 'string');
  // No tmp siblings survive the atomic write.
  assert.deepEqual(
    readdirSync(join(home, 'slp-runtime', 'state')).filter(name => name.endsWith('.tmp')),
    [],
  );
  // Restart load: a fresh state object over the same served home reads the
  // persisted routes back (spec: "A persisted route loads when the plugin
  // starts").
  const restarted = stateFor(home);
  const view = await get(restarted, home);
  assert.equal(view.error, null);
  assert.deepEqual(view.routes, stored.routes);
  assert.equal(view.sha256, stored.sha256);
});

test('invalid file is off with a visible error — routes null, sha preserved for CAS', async t => {
  const home = makeHome(t);
  mkdirSync(dirname(fileOf(home)), { recursive: true });
  writeFileSync(fileOf(home), '{not json');
  const state = stateFor(home);
  const view = await get(state, home);
  assert.equal(view.routes, null);
  assert.equal(typeof view.sha256, 'string');
  assert.match(view.error, /not valid JSON/);
  // Schema-mismatched content fails the same way — never an empty route list.
  writeFileSync(fileOf(home), JSON.stringify({ schemaVersion: 2, routes: [] }));
  const mismatched = await get(state, home);
  assert.equal(mismatched.routes, null);
  assert.match(mismatched.error, /schema validation/);
  // A duplicate leadAgentId makes the file invalid too.
  writeFileSync(fileOf(home), JSON.stringify({
    schemaVersion: 1,
    routes: [route(), route({ supervisorAgentId: null })],
  }));
  const dup = await get(state, home);
  assert.equal(dup.routes, null);
  assert.match(dup.error, /duplicate leadAgentId/);
  // CAS still lets a stale-aware client overwrite the broken file.
  const repaired = await set(state, home, [route()], dup.sha256, livePaseo);
  assert.equal(repaired.error, null);
  assert.equal(repaired.routes.length, 1);
});

// ---------------------------------------------------------------------------
// CAS
// ---------------------------------------------------------------------------

test('set-supervision rejects a stale expectedSha256', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  await set(state, home, [route()], null, livePaseo);
  // Expected-absent while a file exists → conflict.
  await assert.rejects(
    () => set(state, home, [], null, livePaseo),
    error => error.code === 'IDEMPOTENCY_CONFLICT' && /changed since/.test(error.message),
  );
  // A wrong hash → conflict.
  await assert.rejects(
    () => set(state, home, [], 'f'.repeat(64), livePaseo),
    error => error.code === 'IDEMPOTENCY_CONFLICT',
  );
  // The correct token saves.
  const current = await get(state, home);
  const cleared = await set(state, home, [], current.sha256, livePaseo);
  assert.equal(cleared.error, null);
  assert.deepEqual(cleared.routes, []);
});

// ---------------------------------------------------------------------------
// Served-home binding
// ---------------------------------------------------------------------------

test('supervision state binds to the served daemon home — mismatches refuse, never touch files', async t => {
  const served = makeHome(t);
  const other = makeHome(t);
  const state = stateFor(served);
  // A target naming a DIFFERENT existing daemon home is rejected.
  const view = await get(state, other);
  assert.equal(view.routes, null);
  assert.match(view.error, /not the daemon home this plugin serves/);
  await assert.rejects(
    () => set(state, other, [], null, livePaseo),
    error => error.code === 'HOME_UNVERIFIED',
  );
  assert.equal(existsSync(fileOf(other)), false);
  // Without a PASEO_HOME export the process home is a default guess — a
  // recorded host capability gap, never a silent write.
  const guessing = createSupervisionState({ servedHome: () => ({ daemonHome: served, source: 'default' }) });
  const gap = await get(guessing, served);
  assert.equal(gap.routes, null);
  assert.match(gap.error, /host capability gap/);
  await assert.rejects(
    () => set(guessing, served, [], null, livePaseo),
    error => error.code === 'HOME_UNVERIFIED',
  );
  assert.equal(existsSync(fileOf(served)), false);
});

// ---------------------------------------------------------------------------
// Route validation through the doubled SDK
// ---------------------------------------------------------------------------

test('shadow route validation requires exact provider roles, non-archived, non-closed, matching workspace', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  const cases = [
    ['Lead provider is a peer', { [LEAD]: leadAgent({ provider: 'slp-codex-peer' }), [SUP]: supAgent() }, /exact slp-<family>-lead/],
    ['Lead provider is not SLP', { [LEAD]: leadAgent({ provider: 'claude' }), [SUP]: supAgent() }, /exact slp-<family>-lead/],
    ['Lead archived', { [LEAD]: leadAgent({ archivedAt: '2026-09-20T00:00:00Z' }), [SUP]: supAgent() }, /archived/],
    ['Lead closed', { [LEAD]: leadAgent({ status: 'closed' }), [SUP]: supAgent() }, /closed/],
    ['Lead workspace mismatch', { [LEAD]: leadAgent({ workspaceId: 'wks_other' }), [SUP]: supAgent() }, /workspace/],
    ['Lead missing on daemon', { [SUP]: supAgent() }, /not found/],
    ['Supervisor provider is a lead', { [LEAD]: leadAgent(), [SUP]: supAgent({ provider: 'slp-pi-lead' }) }, /exact slp-<family>-supervisor/],
    ['Supervisor archived', { [LEAD]: leadAgent(), [SUP]: supAgent({ archivedAt: 'x' }) }, /archived/],
    ['Supervisor missing', { [LEAD]: leadAgent() }, /Supervisor.*not found/],
  ];
  for (const [name, agents, pattern] of cases) {
    await assert.rejects(
      () => set(state, home, [route()], null, makePaseo(agents)),
      error => error.code === 'INVALID_REQUEST' && pattern.test(error.message),
      name,
    );
    assert.equal(existsSync(fileOf(home)), false, name);
  }
});

test('duplicate leadAgentId is rejected at write', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  await assert.rejects(
    () => set(state, home, [route(), route({ supervisorAgentId: null, leadAgentId: LEAD })], null, livePaseo),
    error => error.code === 'INVALID_REQUEST' && /duplicate leadAgentId/.test(error.message),
  );
  // Distinct Leads in one save are fine.
  const paseo = makePaseo({
    [LEAD]: leadAgent(),
    [LEAD2]: leadAgent({ id: LEAD2 }),
    [SUP]: supAgent(),
  });
  const stored = await set(state, home, [route(), route({ leadAgentId: LEAD2, supervisorAgentId: null })], null, paseo);
  assert.equal(stored.routes.length, 2);
});

test('off routes skip liveness validation; notify is schema-valid and stored but inert', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  // mode: "off" — no SDK calls at all (a route to an archived/departed Lead
  // must still be parkable; spec validates only at enable time).
  const parked = await set(state, home, [route({ mode: 'off' })], null, makePaseo({}));
  assert.equal(parked.error, null);
  assert.equal(parked.routes[0].mode, 'off');
  // "notify" stores without error — schema-valid but unimplemented; the
  // schema requires a Supervisor ID for it.
  const notify = await set(state, home, [route({ mode: 'notify' })], parked.sha256, livePaseo);
  assert.equal(notify.routes[0].mode, 'notify');
  // notify without a Supervisor fails schema validation.
  await assert.rejects(
    () => set(state, home, [route({ mode: 'notify', supervisorAgentId: null })], notify.sha256, livePaseo),
    /invalid set-supervision input/,
  );
});

test('schema rejects malformed routes before any validation or write', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  const cases = [
    ['bad lead id', route({ leadAgentId: 'not-a-uuid' })],
    ['missing workspace', route({ leadWorkspaceId: '' })],
    ['self-supervision', route({ supervisorAgentId: LEAD })],
    ['unknown mode', route({ mode: 'loud' })],
    ['unknown key', { ...route(), extra: 1 }],
    ['negative delay', route({ pendingDelayMs: -1 })],
    ['unbounded delay', route({ pendingDelayMs: 86400001 })],
  ];
  for (const [name, bad] of cases) {
    await assert.rejects(
      () => set(state, home, [bad], null, livePaseo),
      /invalid set-supervision input/,
      name,
    );
  }
  assert.equal(existsSync(fileOf(home)), false);
});

test('a second writer landing during agent validation is caught by the recheck', async t => {
  const home = makeHome(t);
  const state = stateFor(home);
  // Slow refresh double: a concurrent writer saves while validation awaits.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slowPaseo = {
    agents: {
      ref: id => ({
        refresh: async () => { await gate; return { agent: { [LEAD]: leadAgent(), [SUP]: supAgent() }[id] ?? null }; },
      }),
    },
  };
  const pending = set(state, home, [route()], null, slowPaseo);
  await new Promise(resolve => setImmediate(resolve));
  const winner = await set(state, home, [route({ supervisorAgentId: null })], null, livePaseo);
  release();
  await assert.rejects(() => pending, error => error.code === 'IDEMPOTENCY_CONFLICT');
  const view = await get(state, home);
  assert.equal(view.sha256, winner.sha256);
});

// ---------------------------------------------------------------------------
// Jev CAS seam (spec: get-jev/set-jev carry a raw-file hash before the
// capability toggle so a stale save cannot overwrite another client's
// supervision choice)
// ---------------------------------------------------------------------------

test('set-jev requires the raw-file CAS token and preserves unrelated capability keys', async t => {
  const home = makeHome(t);
  const jev = createJev();
  const base = {
    schemaVersion: 1, enabled: true, capabilities: { routing: true },
    provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'typesafe/jev-1.13' },
  };
  const first = await jev.setJev({ schemaVersion: 1, target: targetOf(home), jev: base, expectedSha256: null });
  assert.equal(typeof first.jev.sha256, 'string');
  // A stale save is refused rather than overwriting.
  await assert.rejects(
    () => jev.setJev({
      schemaVersion: 1, target: targetOf(home),
      jev: { ...base, capabilities: { routing: true, supervision: true } },
      expectedSha256: null,
    }),
    error => error.code === 'IDEMPOTENCY_CONFLICT',
  );
  // A fresh-token save stores every key verbatim — the catchall record
  // carries capabilities this client does not own.
  const second = await jev.setJev({
    schemaVersion: 1, target: targetOf(home),
    jev: { ...base, capabilities: { routing: true, supervision: true } },
    expectedSha256: first.jev.sha256,
  });
  assert.deepEqual(second.jev.capabilities, { routing: true, supervision: true });
  // The stored file keeps them too.
  assert.deepEqual(
    JSON.parse(readFileSync(join(home, 'slp-runtime', 'state', 'jev.json'), 'utf8')).capabilities,
    { routing: true, supervision: true },
  );
});

// ---------------------------------------------------------------------------
// Fixture sanity — the sanitized family fixtures stay loadable and shaped
// like the host evidence they were taken from.
// ---------------------------------------------------------------------------

test('sanitized provider fixtures parse and carry send_agent_prompt evidence', async t => {
  const dir = new URL('./fixtures/supervision/', import.meta.url).pathname;
  const families = ['codex', 'devin', 'pi', 'claude'];
  for (const family of families) {
    const fixture = JSON.parse(readFileSync(join(dir, `${family}.send-agent-prompt.json`), 'utf8'));
    assert.equal(typeof fixture, 'object', family);
    // Every fixture names the tool and shows where the record came from —
    // no credentials or real agent content may appear (fixtures are
    // sanitized: synthetic ids only).
    assert.match(JSON.stringify(fixture), /send_agent_prompt/, family);
    assert.doesNotMatch(JSON.stringify(fixture), /sk-[a-zA-Z0-9_-]{10}|sk-or-|ya29\.|ghp_/, family);
  }
});
