// tests/plugin-jev.test.mjs — the Jev per-daemon config/key lifecycle behind
// plugin/server/jev.ts: file layout + 0600 + atomic writes, strict input
// validation, hasKey-only views, and the injectable test-jev probe. No real
// network: the fetch seam is doubled throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createJev } from '../plugin/server/jev.ts';
import { makeHome, seqNow, targetOf } from './helpers/plugin-doubles.mjs';

const jevPath = home => join(home, 'slp-runtime', 'state', 'jev.json');
const keyPath = home => join(home, 'slp-runtime', 'state', 'jev-openrouter.key');
const getJev = (jev, home) => jev.getJev({ schemaVersion: 1, target: targetOf(home) });
const setJev = (jev, home, config) => jev.setJev({ schemaVersion: 1, target: targetOf(home), jev: config });
const setJevKey = (jev, home, key) => jev.setJevKey({ schemaVersion: 1, target: targetOf(home), key });
const testJev = (jev, home) => jev.testJev({ schemaVersion: 1, target: targetOf(home) });
const config = (over = {}) => ({
  schemaVersion: 1, enabled: true, capabilities: { routing: true },
  provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'typesafe/jev-1.13' },
  ...over,
});

test('jev config round-trips through get/set with 0600 atomic writes', async t => {
  const home = makeHome(t);
  const jev = createJev();
  // Unset → unconfigured view, no key.
  assert.equal(existsSync(jevPath(home)), false);
  assert.deepEqual((await getJev(jev, home)).jev, {
    configured: false, enabled: null, capabilities: null, provider: null,
    hasKey: false, keyPermissionsOk: null, error: null,
  });
  const stored = await setJev(jev, home, config());
  assert.equal(lstatSync(jevPath(home)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(jevPath(home), 'utf8')), config());
  assert.equal(stored.jev.configured, true);
  assert.equal(stored.jev.enabled, true);
  assert.deepEqual(stored.jev.capabilities, { routing: true });
  assert.equal(stored.jev.provider.model, 'typesafe/jev-1.13');
  // No tmp siblings survive the atomic write.
  assert.deepEqual(
    readdirSync(join(home, 'slp-runtime', 'state')).filter(name => name.endsWith('.tmp')),
    [],
  );
  // Toggling off preserves the whole document otherwise.
  await setJev(jev, home, config({ enabled: false }));
  const off = await getJev(jev, home);
  assert.equal(off.jev.enabled, false);
  assert.deepEqual(off.jev.capabilities, { routing: true });
});

test('set-jev rejects malformed input and drift-prone provider values', async t => {
  const home = makeHome(t);
  const jev = createJev();
  const cases = [
    ['unknown top key', { ...config(), extra: 1 }],
    ['wrong schemaVersion', { ...config(), schemaVersion: 2 }],
    ['non-bool capability', { ...config(), capabilities: { routing: 'yes' } }],
    ['alias model', { ...config(), provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'typesafe/jev-latest' } }],
    ['preview alias', { ...config(), provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'jev-preview' } }],
    ['first-party id shape', { ...config(), provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'jev-1.13.0' } }],
    ['http baseUrl', { ...config(), provider: { kind: 'openrouter', baseUrl: 'http://openrouter.ai', model: 'typesafe/jev-1.13' } }],
    ['undocumented baseUrl path', { ...config(), provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v2', model: 'typesafe/jev-1.13' } }],
    ['other kind', { ...config(), provider: { kind: 'openai', baseUrl: 'https://api.openai.com', model: 'typesafe/jev-1.13' } }],
    // Cross-kind confusion — each shape is pinned to its own kind.
    ['openrouter model on typesafe', { ...config(), provider: { kind: 'typesafe', baseUrl: 'https://api.typesafe.ai', model: 'typesafe/jev-1.13' } }],
    ['typesafe model on openrouter', { ...config(), provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'jev-1.13.0' } }],
    ['typesafe http baseUrl', { ...config(), provider: { kind: 'typesafe', baseUrl: 'http://api.typesafe.ai', model: 'jev-1.13.0' } }],
    ['typesafe baseUrl query', { ...config(), provider: { kind: 'typesafe', baseUrl: 'https://api.typesafe.ai/?x=1', model: 'jev-1.13.0' } }],
  ];
  for (const [name, jevConfig] of cases) {
    await assert.rejects(() => setJev(jev, home, jevConfig), /invalid set-jev input/, name);
  }
  await assert.rejects(() => jev.getJev({ schemaVersion: 1 }), /invalid get-jev input/);
  await assert.rejects(() => setJev(jev, home, { enabled: true }), /invalid set-jev input/);
  assert.equal(existsSync(jevPath(home)), false, 'a rejected write never creates the file');
});

test('validator parity with src/jev.mjs — prefixed baseUrl + defaults fill identically', async t => {
  const home = makeHome(t);
  const jev = createJev();
  // The documented prefixed form is accepted on the plugin side as well.
  await setJev(jev, home, config({ provider: { kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'typesafe/jev-1.13' } }));
  assert.equal((await getJev(jev, home)).jev.provider.baseUrl, 'https://openrouter.ai/api/v1');
  // A hand-written jev.json that omits baseUrl is valid for BOTH surfaces:
  // the CLI defaults it, and the plugin view must not call it broken.
  writeFileSync(jevPath(home), JSON.stringify({
    schemaVersion: 1, enabled: true, capabilities: {},
    provider: { kind: 'openrouter', model: 'typesafe/jev-1.13' },
  }));
  const view = (await getJev(jev, home)).jev;
  assert.equal(view.configured, true);
  assert.equal(view.error, null);
  assert.equal(view.provider.baseUrl, 'https://openrouter.ai', 'absent baseUrl defaults like the CLI');
  assert.deepEqual(view.capabilities, { routing: false }, 'absent capability defaults off like the CLI');
});

test('a corrupt jev.json surfaces as an error view, never silently OFF', async t => {
  const home = makeHome(t);
  const jev = createJev();
  mkdirSync(dirname(jevPath(home)), { recursive: true });
  writeFileSync(jevPath(home), '{corrupt');
  const view = (await getJev(jev, home)).jev;
  assert.equal(view.configured, true, 'a broken file is configured-but-broken evidence');
  assert.match(view.error, /not valid JSON/);
  writeFileSync(jevPath(home), JSON.stringify({ schemaVersion: 1, enabled: 'yes' }));
  assert.match((await getJev(jev, home)).jev.error, /schema validation/);
});

test('key lifecycle: write 0600, hasKey-only view, toggle-off keeps the key, remove', async t => {
  const home = makeHome(t);
  const jev = createJev();
  await setJev(jev, home, config());
  const secret = 'sk-or-v1-plugin-test-key-000000';
  await setJevKey(jev, home, secret);
  assert.equal(lstatSync(keyPath(home)).mode & 0o777, 0o600);
  assert.equal(readFileSync(keyPath(home), 'utf8'), `${secret}\n`);
  const view = (await getJev(jev, home)).jev;
  assert.equal(view.hasKey, true);
  assert.equal(view.keyPermissionsOk, true);
  assert.ok(!JSON.stringify(view).includes(secret), 'the view never echoes key material');
  // Toggling every capability off must not delete the stored key.
  await setJev(jev, home, config({ enabled: false, capabilities: { routing: false } }));
  assert.equal(existsSync(keyPath(home)), true);
  assert.equal((await getJev(jev, home)).jev.hasKey, true);
  // Removal is explicit.
  await setJevKey(jev, home, null);
  assert.equal(existsSync(keyPath(home)), false);
  assert.equal((await getJev(jev, home)).jev.hasKey, false);
});

test('set-jev-key rejects whitespace keys and malformed input', async t => {
  const home = makeHome(t);
  const jev = createJev();
  await assert.rejects(() => setJevKey(jev, home, 'key with spaces'), /whitespace/);
  await assert.rejects(() => setJevKey(jev, home, ''), /invalid set-jev-key input/);
  await assert.rejects(() => jev.setJevKey({ schemaVersion: 1, target: targetOf(home) }), /invalid set-jev-key input/);
  assert.equal(existsSync(keyPath(home)), false);
});

test('test-jev probes the stored key — no key/config fail fast, network is doubled', async t => {
  const home = makeHome(t);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ data: { label: 'sk-or-v1-abc…123', is_free_tier: false } }) };
  };
  const jev = createJev({ fetchImpl });
  // Unconfigured → fail result, never a throw, never a call.
  const unconfigured = await testJev(jev, home);
  assert.equal(unconfigured.ok, false);
  assert.match(unconfigured.detail, /not configured/);
  await setJev(jev, home, config());
  const noKey = await testJev(jev, home);
  assert.equal(noKey.ok, false);
  assert.match(noKey.detail, /no key stored/);
  assert.equal(calls.length, 0, 'no network before a stored key exists');
  await setJevKey(jev, home, 'sk-or-v1-probe-key');
  const probed = await testJev(jev, home);
  assert.equal(probed.ok, true);
  assert.match(probed.detail, /key accepted/);
  assert.ok(probed.latencyMs >= 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/auth/key');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-or-v1-probe-key');
});

test('typesafe kind: config round-trip, jev-typesafe.key lifecycle, /v1/models probe', async t => {
  const home = makeHome(t);
  const calls = [];
  const jev = createJev({ fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ data: [{ id: 'jev-1.13.0' }] }) }; } });
  const tsConfig = over => config({ provider: { kind: 'typesafe', model: 'jev-1.13.0', ...over } });
  // Absent baseUrl defaults to the first-party origin — same parity rule as
  // the openrouter default.
  const stored = await setJev(jev, home, tsConfig());
  assert.equal(stored.jev.provider.baseUrl, 'https://api.typesafe.ai');
  assert.equal(stored.jev.provider.model, 'jev-1.13.0');
  // A custom endpoint mounts under an origin+path prefix (Human-requested).
  await setJev(jev, home, tsConfig({ baseUrl: 'https://jev.internal.example.com/proxy' }));
  assert.equal((await getJev(jev, home)).jev.provider.baseUrl, 'https://jev.internal.example.com/proxy');
  // The key lives in the kind-named file, not jev-openrouter.key.
  await setJevKey(jev, home, 'ts-probe-key');
  assert.equal(existsSync(join(home, 'slp-runtime', 'state', 'jev-typesafe.key')), true);
  assert.equal(existsSync(keyPath(home)), false, 'openrouter key file untouched');
  // The probe follows the configured baseUrl mount — a proxy serves its API
  // under the prefix, so {baseUrl}/v1/models is the documented check.
  const result = await testJev(jev, home);
  assert.equal(result.ok, true);
  assert.equal(calls.at(-1).url, 'https://jev.internal.example.com/proxy/v1/models');
  assert.equal(calls.at(-1).init.headers.authorization, 'Bearer ts-probe-key');
  // Bad key → the documented 401 surfaces as a failed probe, never a throw.
  const bad = createJev({ fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  const denied = await testJev(bad, home);
  assert.equal(denied.ok, false);
  assert.match(denied.detail, /HTTP 401/);
});

test('test-jev reports HTTP and network failures without throwing or leaking', async t => {
  const home = makeHome(t);
  const secret = 'sk-or-v1-d0n0tleakme-plugin';
  const http = status => async () => ({ ok: false, status, json: async () => ({}) });
  for (const status of [401, 402, 500]) {
    const jev = createJev({ fetchImpl: http(status) });
    await setJev(jev, home, config());
    await setJevKey(jev, home, secret);
    const result = await testJev(jev, home);
    assert.equal(result.ok, false);
    assert.match(result.detail, new RegExp(`HTTP ${status}`));
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  const jev = createJev({ fetchImpl: async () => { throw new TypeError('socket hangup'); } });
  const result = await testJev(jev, home);
  assert.equal(result.ok, false);
  assert.match(result.detail, /socket hangup/);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('a label carrying credential-shaped text is scrubbed from the detail', async t => {
  const home = makeHome(t);
  const reflected = 'sk-or-v1-reflectedsecret0000';
  const jev = createJev({
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { label: `acct ${reflected} label` } }) }),
    now: seqNow(),
  });
  await setJev(jev, home, config());
  await setJevKey(jev, home, 'sk-or-v1-probe-key');
  const result = await testJev(jev, home);
  assert.equal(result.ok, true);
  assert.ok(!result.detail.includes(reflected), 'remote label text is sanitized');
  assert.match(result.detail, /<redacted>/);
  assert.equal(result.latencyMs, 1000, 'deps.now wires into the latency measurement');
  // Flag-preserving rebuild: a lowercase `bearer <token>` in remote text must
  // still scrub — a plain 'g' rebuild would drop the pattern's /i.
  const bearerJev = createJev({
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { label: 'bearer abcdefghijklmnopqrstuvwxyz012345' } }) }),
  });
  const bearerResult = await testJev(bearerJev, home);
  assert.ok(!bearerResult.detail.includes('abcdefghijklmnopqrstuvwxyz012345'), 'lowercase bearer token is scrubbed');
  assert.match(bearerResult.detail, /<redacted>/);
});

test('get/set-jev verify the daemon home like every other mutation', async t => {
  const home = makeHome(t);
  const jev = createJev();
  await assert.rejects(
    () => getJev(jev, join(home, 'missing')),
    error => error.code === 'HOME_UNVERIFIED',
  );
  // §8.1 parity with manager.ts: a symlinked slp-runtime redirects writes —
  // the real-directory check refuses it before any credential write.
  const outside = join(home, '..', `outside-${Date.now()}`);
  mkdirSync(outside, { recursive: true });
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(home, 'slp-runtime'), 'dir');
  await assert.rejects(
    () => getJev(jev, home),
    error => error.code === 'HOME_UNVERIFIED' && /not a real directory/.test(error.message),
  );
});
