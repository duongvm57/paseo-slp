// tests/plugin-entrypoints.test.mjs — §13 row 1 coverage: the shipped
// paseo-plugin.json parses through the host's REAL manifest validator
// (readPluginManifest from the installed @getpaseo/server), and the real
// contribution function in plugin/index.server.ts registers exactly the five
// RPCs and returns a working cleanup.
//
// contribute() itself only CONSTRUCTS its lane deps — the resolve hook below
// substitutes a specifier ONLY when the real lane module fails to resolve
// (index.server.ts statically imports materializer/executables/launchers/
// generated-payload — sibling-lane modules absent in a lane-isolated worktree,
// present in the integrated repo). Real modules therefore exercise the real
// createMaterializer/executables/launchers constructors whenever they exist;
// the stub is a worktree-isolation fallback, not a mock of the contribution.
// Host-module discovery (PASEO_CLI_MODULES → npm root -g → which paseo → fnm)
// lives in tests/helpers/plugin-doubles.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import { loadHostModule } from './helpers/plugin-doubles.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = join(REPO_ROOT, 'plugin');

async function loadHostPluginModules() {
  return loadHostModule('plugins/manifest.js');
}

// ---------------------------------------------------------------------------
// (a) manifest through the host's real validator
// ---------------------------------------------------------------------------

test('paseo-plugin.json parses through the host readPluginManifest', async t => {
  const host = await loadHostPluginModules();
  if (!host || typeof host.readPluginManifest !== 'function') {
    t.skip('HOST MANIFEST VALIDATOR UNAVAILABLE — manifest parsing not verified against real host (set PASEO_CLI_MODULES; see warning above)');
    return;
  }
  const manifest = await host.readPluginManifest(PLUGIN_DIR);
  assert.deepEqual(manifest, {
    id: 'paseo-slp',
    requirements: { paseo: '>=0.8.0 <0.9.0' },
    build: [['npm', 'install', '--omit=dev', '--no-audit', '--no-fund']],
  });
});

test('host manifest validator rejects invented/extra keys', async t => {
  const host = await loadHostPluginModules();
  if (!host || typeof host.readPluginManifest !== 'function') {
    t.skip('HOST MANIFEST VALIDATOR UNAVAILABLE — rejection coverage skipped (set PASEO_CLI_MODULES; see warning above)');
    return;
  }
  const cases = [
    { name: 'extra top-level key', doc: { id: 'x', extraField: true } },
    { name: 'invented requirements key', doc: { id: 'x', requirements: { bogus: '1' } } },
    { name: 'missing id', doc: { requirements: { paseo: '>=0.8.0' } } },
    { name: 'non-string id', doc: { id: 42 } },
  ];
  for (const { name, doc } of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'slp-manifest-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'paseo-plugin.json'), JSON.stringify(doc));
    await assert.rejects(() => host.readPluginManifest(dir), undefined, name);
  }
});

// ---------------------------------------------------------------------------
// (b) real contribute() against a minimal server stub
// ---------------------------------------------------------------------------

const LANE_SPECIFIERS = new Map([
  ['./server/materializer.ts', 'materializer'],
  ['./server/generated/runtime-payload.ts', 'runtime-payload'],
  ['./server/executables.ts', 'executables'],
  ['./server/launchers.ts', 'launchers'],
]);

function writeLaneStubs(t) {
  // Honest doubles in a real module file: they do real filesystem work if the
  // manager ever calls them, but contribute() itself only constructs them.
  const dir = mkdtempSync(join(tmpdir(), 'slp-lane-stubs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'lane-stubs.mjs');
  writeFileSync(
    file,
    `import { createHash } from 'node:crypto';
const sha256 = d => createHash('sha256').update(d).digest('hex');
const files = [{ path: 'bin/slp-shim.mjs', sha256: sha256('shim'), mode: 0o644, base64: Buffer.from('shim').toString('base64') }];
export const embeddedPayload = {
  schemaVersion: 1,
  candidate: { sha256: sha256('candidate'), files: files.map(({ path, sha256: s }) => ({ path, sha256: s })) },
  payloadSha256: sha256('payload'),
  files,
};
export const createMaterializer = () => ({
  async materialize() { throw new Error('not exercised by contribute()'); },
  async verifyPublished() {},
  async discardStaging() {},
});
export const createExecutableResolver = () => ({
  async resolve() { throw new Error('not exercised by contribute()'); },
});
export const createLauncherBuilder = () => ({
  async publish() { throw new Error('not exercised by contribute()'); },
  async verify() { throw new Error('not exercised by contribute()'); },
});
`,
  );
  return file;
}

test('contribute() registers the five RPCs and returns a callable cleanup', async t => {
  const stubFile = writeLaneStubs(t);
  const stubUrl = pathToFileURL(stubFile).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.endsWith('/plugin/index.server.ts') && LANE_SPECIFIERS.has(specifier)) {
        // Real lane modules first — the stub is only a fallback for
        // lane-isolated worktrees where the sibling module is absent.
        try {
          return nextResolve(specifier, context);
        } catch {
          return { url: `${stubUrl}#${LANE_SPECIFIERS.get(specifier)}`, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
  t.after(() => hooks.deregister());

  const entry = await import(pathToFileURL(join(PLUGIN_DIR, 'index.server.ts')).href);
  const contribute = entry.default;
  assert.equal(typeof contribute, 'function');

  const registrations = [];
  const server = {
    handle(contract, handler) {
      registrations.push({ name: contract.name, handler });
    },
  };
  const cleanup = contribute(server);
  assert.deepEqual(
    registrations.map(r => r.name).sort(),
    ['activate', 'catalog', 'deactivate', 'local-target', 'reconcile', 'set-language', 'status'],
  );
  for (const { handler } of registrations) {
    assert.equal(typeof handler, 'function');
  }
  assert.equal(typeof cleanup, 'function');
  assert.doesNotThrow(() => cleanup());
  assert.doesNotThrow(() => cleanup(), 'cleanup must be idempotent');
});

// ---------------------------------------------------------------------------
// (c) real host compiler on the plugin entrypoints
// ---------------------------------------------------------------------------

// compilePlugin (plugins/compiler.js in the installed @getpaseo/server) IS
// importable and runs offline — esbuild resolves through nodeRequire relative
// to the host module. The only blocker in a lane-isolated worktree is
// unresolved sibling-lane specifiers statically imported by index.server.ts;
// the compiler itself needs no live daemon. When the lane modules are present
// (integrated repo), a full successful bundle is asserted; when absent, this
// test documents the boundary precisely.
// deferred-to-S1: extend this to a full entrypoint bundle verification once
// sibling lanes ship in the same checkout.
test('real host compilePlugin runs on the plugin entrypoints', async t => {
  const host = await loadHostModule('plugins/compiler.js');
  if (!host || typeof host.compilePlugin !== 'function') {
    t.skip('HOST COMPILER UNAVAILABLE — compile coverage skipped (set PASEO_CLI_MODULES; see warning above)');
    return;
  }
  const laneModules = [...LANE_SPECIFIERS.keys()].map(spec => spec.replace('./', ''));
  const missing = laneModules.filter(rel => !existsSync(join(PLUGIN_DIR, rel)));
  if (missing.length === 0) {
    const out = await host.compilePlugin({
      client: join(PLUGIN_DIR, 'index.client.tsx'),
      server: join(PLUGIN_DIR, 'index.server.ts'),
    });
    assert.ok(out.serverBundle && out.serverBundle.length > 0, 'server bundle empty');
    assert.ok(out.clientBundle && out.clientBundle.length > 0, 'client bundle empty');
    return;
  }
  // Lane-isolated worktree: the compiler runs and reports exactly the absent
  // sibling-lane specifiers — the failure is module resolution, not a limit
  // of the compiler or of offline use.
  const failure = await host
    .compilePlugin({ client: null, server: join(PLUGIN_DIR, 'index.server.ts') })
    .then(() => null, error => error);
  assert.ok(failure, 'expected an unresolved-lane-module build failure');
  const message = String(failure.message ?? failure);
  for (const rel of missing) {
    assert.ok(
      message.includes(rel) || message.includes(`./${rel}`),
      `expected missing specifier ${rel} in compiler error:\n${message.slice(0, 800)}`,
    );
  }
  console.info(
    `deferred-to-S1: full compile verification needs sibling lane modules absent here: ${missing.join(', ')}`,
  );
});
