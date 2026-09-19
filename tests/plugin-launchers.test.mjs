// Offline §13 "Executables / shims" coverage for the launch/runtime lane:
// resolver probes (ordinary Node vs Electron, poisoned env/PATH, explicit
// refusal, missing families), launch-set publish/verify integrity, shell
// quoting, argv0-only --version, runtime tampering, grant/PASEO_AGENT_ID
// non-selection, byte-exact role injection for all four families, and
// exit/signal/backpressure behavior through the real shim subprocess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, delimiter, join } from 'node:path';
import { createExecutableResolver, RUNTIME_CONTROL_ENV_KEYS } from '../plugin/server/executables.ts';
import { createLauncherBuilder } from '../plugin/server/launchers.ts';
import { identity, install } from '../src/package.mjs';
import { roleInstructions } from '../src/role-bundle.mjs';
import { acpRolePrompt, claudeRolePrompt, injectRole, piRoleArgs } from '../src/role-transport.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const FAMILIES = ['codex', 'pi', 'devin', 'claude'];
const ROLES = ['supervisor', 'lead', 'peer'];
const sq = value => `'${String(value).replaceAll("'", "'\\''")}'`;

// The shim launches roles under the managed environment it freezes from the
// launch manifest; expected role text must be rendered with that same env.
const managedInstruction = (f, role) =>
  roleInstructions(f.candidate, role, {
    SLP_MANAGED_RUNTIME: '1',
    SLP_NODE_BIN: f.node.path,
    SLP_RUNTIME_ROOT: f.candidate,
    SLP_DAEMON_HOME: f.home,
  });

function tmp(t, prefix = 'launch-') {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/', prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const mkExe = path => {
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
};

// A ProbeRunner double: handlers map an already-realpath'd executable path to a
// result or a function producing one. Every call is captured for env/argv
// assertions.
function fakeRun(handlers) {
  const calls = [];
  const run = (file, args, options) => {
    calls.push({ file, args, env: options.env });
    const handler = handlers[file];
    if (!handler) return Promise.resolve({ code: 1, stdout: '', stderr: '', error: 'ENOENT (fake)' });
    return Promise.resolve(typeof handler === 'function' ? handler(file, args, options) : handler);
  };
  return { run, calls };
}

const nodeReport = (execPath, overrides = {}) =>
  JSON.stringify({ node: '24.14.0', electron: null, execPath, ...overrides });
const nodeOk = { handle: (file, args) => ({ code: 0, stdout: nodeReport(file), stderr: '' }) };
const versionOut = version => ({ code: 0, stdout: `${version}\n`, stderr: '' });

function resolveDeps(t, overrides = {}) {
  const dir = tmp(t);
  const home = join(dir, 'home');
  const stableRoot = join(home, 'slp-runtime');
  mkdirSync(stableRoot, { recursive: true });
  return {
    request: { daemonHome: home, stableRoot, ...overrides },
    dir,
    home,
    stableRoot,
  };
}

// ---------------------------------------------------------------------------
// Executable resolver
// ---------------------------------------------------------------------------

test('resolver: explicit nodePath is probe-verified ordinary Node', async t => {
  const { request } = resolveDeps(t);
  const node = join(tmp(t), 'my-node');
  mkExe(node);
  const { run, calls } = fakeRun({ [node]: nodeOk.handle });
  const resolver = createExecutableResolver({ run, env: { PATH: '' } });
  const result = await resolver.resolve({ ...request, nodePath: node });
  assert.equal(result.node.path, node);
  assert.equal(result.node.version, '24.14.0');
  assert.equal(calls[0].file, node);
  assert.equal(calls[0].args[0], '-e');
  for (const family of FAMILIES) assert.equal(result.binaries[family].available, false);
});

test('resolver: Electron and old Node probes are rejected, not misread as Node', async t => {
  const { request } = resolveDeps(t);
  const electron = join(tmp(t), 'electronish');
  mkExe(electron);
  const { run } = fakeRun({
    [electron]: file => ({ code: 0, stdout: nodeReport(file, { electron: '37.0.0', node: '24.0.0' }), stderr: '' }),
  });
  const resolver = createExecutableResolver({ run, env: { PATH: '' } });
  await assert.rejects(resolver.resolve({ ...request, nodePath: electron }), error => {
    assert.equal(error.code, 'EXECUTABLE_UNAVAILABLE');
    assert.match(error.message, /Electron/);
    return true;
  });
  const old = join(tmp(t), 'old-node');
  mkExe(old);
  const stale = createExecutableResolver({
    run: fakeRun({ [old]: file => ({ code: 0, stdout: nodeReport(file, { node: '20.9.0' }), stderr: '' }) }).run,
    env: { PATH: '' },
  });
  await assert.rejects(stale.resolve({ ...request, nodePath: old }), /below required major 22/);
});

test('resolver: invalid explicit nodePath refuses without falling back to PATH', async t => {
  const { request } = resolveDeps(t);
  const dir = tmp(t);
  const good = join(dir, 'node');
  mkExe(good);
  const { run, calls } = fakeRun({ [good]: nodeOk.handle });
  const resolver = createExecutableResolver({ run, env: { PATH: dir } });
  await assert.rejects(
    resolver.resolve({ ...request, nodePath: join(dir, 'missing-node') }),
    error => {
      assert.equal(error.code, 'EXECUTABLE_UNAVAILABLE');
      assert.match(error.message, /nodePath/);
      return true;
    },
  );
  assert.equal(calls.length, 0, 'PATH fallback must not run after an explicit failure');
});

test('resolver: PATH order, absolute-only entries, execPath consistency', async t => {
  const { request } = resolveDeps(t);
  const dir = tmp(t);
  const first = join(dir, 'd1');
  const second = join(dir, 'd2');
  mkdirSync(first);
  mkdirSync(second);
  const n1 = join(first, 'node');
  const n2 = join(second, 'node');
  mkExe(n1);
  mkExe(n2);
  const relativeCwd = 'relative-bin';
  const env = { PATH: ['', relativeCwd, first, second].join(delimiter) };
  const { run, calls } = fakeRun({ [n1]: nodeOk.handle, [n2]: nodeOk.handle });
  const resolver = createExecutableResolver({ run, env });
  const result = await resolver.resolve(request);
  assert.equal(result.node.path, n1, 'first absolute PATH dir wins');
  assert.deepEqual(calls.map(call => call.file), [n1]);

  // A probe whose reported execPath resolves elsewhere is a redirecting shim.
  const shadowed = createExecutableResolver({
    run: fakeRun({ [n1]: () => ({ code: 0, stdout: nodeReport(n2), stderr: '' }), [n2]: nodeOk.handle }).run,
    env: { PATH: first },
  });
  await assert.rejects(shadowed.resolve(request), /EXECUTABLE_UNAVAILABLE|does not match/);
});

test('resolver: prior receipt path preferred, stale prior falls back to PATH', async t => {
  const { request } = resolveDeps(t);
  const dir = tmp(t);
  const priorNode = join(dir, 'prior-node');
  const pathNode = join(dir, 'node');
  mkExe(priorNode);
  mkExe(pathNode);
  const { run } = fakeRun({ [priorNode]: nodeOk.handle, [pathNode]: nodeOk.handle });
  const resolver = createExecutableResolver({ run, env: { PATH: dir } });
  const withPrior = await resolver.resolve({ ...request, prior: { node: { path: priorNode } } });
  assert.equal(withPrior.node.path, priorNode);
  const stale = await resolver.resolve({ ...request, prior: { node: { path: join(dir, 'gone') } } });
  assert.equal(stale.node.path, pathNode);
});

test('resolver: probes strip Paseo/Electron runtime-control vars and NODE_OPTIONS', async t => {
  const { request } = resolveDeps(t);
  const dir = tmp(t);
  const node = join(dir, 'node');
  mkExe(node);
  const poisoned = {
    PATH: dir,
    NODE_OPTIONS: '--inspect-brk',
    PASEO_NODE_ENV: 'test',
    PASEO_DESKTOP_MANAGED: '1',
    PASEO_SUPERVISED: '1',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    ESBUILD_BINARY_PATH: '/evil/esbuild',
    KEEP_ME: 'yes',
  };
  const { run, calls } = fakeRun({ [node]: nodeOk.handle });
  const resolver = createExecutableResolver({ run, env: poisoned });
  await resolver.resolve(request);
  const probeEnv = calls[0].env;
  for (const key of [...RUNTIME_CONTROL_ENV_KEYS, 'NODE_OPTIONS']) {
    assert.equal(probeEnv[key], undefined, `${key} must not reach probes`);
  }
  assert.equal(probeEnv.KEEP_ME, 'yes', 'unrelated environment is preserved');
});

test('resolver: family binaries resolve explicit > prior > PATH; missing stays unavailable', async t => {
  const { request, stableRoot } = resolveDeps(t);
  const dir = tmp(t);
  const node = join(dir, 'node');
  mkExe(node);
  const explicitCodex = join(dir, 'my-codex');
  const priorPi = join(dir, 'prior-pi');
  mkExe(explicitCodex);
  mkExe(priorPi);
  const pathDir = join(dir, 'pathbin');
  mkdirSync(pathDir);
  const pathDevin = join(pathDir, 'devin');
  mkExe(pathDevin);
  const { run } = fakeRun({
    [node]: nodeOk.handle,
    [explicitCodex]: versionOut('codex 9.9.9'),
    [priorPi]: versionOut('pi 1.2.3'),
    [pathDevin]: versionOut('devin 4.5.6'),
  });
  const resolver = createExecutableResolver({ run, env: { PATH: pathDir } });
  const result = await resolver.resolve({
    ...request,
    nodePath: node,
    binaries: { codex: explicitCodex },
    prior: { binaries: { pi: { available: true, path: priorPi, version: 'pi 1.2.3' } } },
  });
  assert.deepEqual(result.binaries.codex, { available: true, path: explicitCodex, version: 'codex 9.9.9' });
  assert.deepEqual(result.binaries.pi, { available: true, path: priorPi, version: 'pi 1.2.3' });
  assert.deepEqual(result.binaries.devin, { available: true, path: pathDevin, version: 'devin 4.5.6' });
  assert.deepEqual(result.binaries.claude, { available: false, path: null, version: null });

  // Explicit binary that is actually the Node executable is an error.
  await assert.rejects(
    resolver.resolve({ ...request, nodePath: node, binaries: { codex: node } }),
    /Node\.js executable|usable codex/,
  );
  // A PATH binary resolving inside the SLP runtime root is skipped.
  const inside = join(stableRoot, 'launchers', 'fake-set');
  mkdirSync(inside, { recursive: true });
  const inner = join(inside, 'claude');
  mkExe(inner);
  const innerRun = createExecutableResolver({
    run: fakeRun({ [node]: nodeOk.handle, [inner]: versionOut('claude 0.0') }).run,
    env: { PATH: inside },
  });
  const res = await innerRun.resolve({ ...request, nodePath: node });
  assert.equal(res.binaries.claude.available, false);
});

test('resolver: explicit invalid family binary is a conflict, not silent unavailability', async t => {
  const { request } = resolveDeps(t);
  const node = join(tmp(t), 'node');
  mkExe(node);
  const { run } = fakeRun({ [node]: nodeOk.handle });
  const resolver = createExecutableResolver({ run, env: { PATH: '' } });
  await assert.rejects(
    resolver.resolve({ ...request, nodePath: node, binaries: { claude: '/nonexistent/claude' } }),
    error => {
      assert.equal(error.code, 'EXECUTABLE_UNAVAILABLE');
      assert.match(error.message, /binaries\.claude/);
      return true;
    },
  );
});

test('resolver: win32 is fail-closed UNSUPPORTED_PLATFORM', async t => {
  const { request } = resolveDeps(t);
  const resolver = createExecutableResolver({ platform: 'win32', env: { PATH: '' } });
  await assert.rejects(resolver.resolve(request), error => {
    assert.equal(error.code, 'UNSUPPORTED_PLATFORM');
    return true;
  });
});

test('resolver: real probe of process.execPath parses and resolves it', async t => {
  // No fake run: this exercises defaultRun (timeout/maxBuffer/error mapping),
  // NODE_PROBE_SCRIPT and executableRealpath against the live Node binary.
  const { request } = resolveDeps(t);
  const resolver = createExecutableResolver({ env: { PATH: '' } });
  const result = await resolver.resolve({ ...request, nodePath: process.execPath });
  assert.equal(result.node.path, realpathSync(process.execPath));
  assert.equal(result.node.version, process.versions.node);
  for (const family of FAMILIES) assert.equal(result.binaries[family].available, false);
});

test('resolver: oversized version strings are bounded, never recorded', async t => {
  const { request } = resolveDeps(t);
  const dir = tmp(t);
  const node = join(dir, 'node');
  mkExe(node);
  const codex = join(dir, 'codex');
  mkExe(codex);
  const huge = `codex ${'9'.repeat(1000)}`;
  const { run } = fakeRun({ [node]: nodeOk.handle, [codex]: versionOut(huge) });
  const resolver = createExecutableResolver({ run, env: { PATH: dir } });
  // A PATH-resolved binary emitting a degenerate --version is skipped →
  // unavailable, so nothing oversized reaches the recorded resolution.
  const result = await resolver.resolve({ ...request, nodePath: node });
  assert.deepEqual(result.binaries.codex, { available: false, path: null, version: null });
  // An explicit binary with an oversized --version is a conflict, not silence.
  await assert.rejects(
    resolver.resolve({ ...request, nodePath: node, binaries: { codex } }),
    error => {
      assert.equal(error.code, 'EXECUTABLE_UNAVAILABLE');
      assert.match(error.message, /256/);
      return true;
    },
  );
  // The same bound covers the Node probe report's version field.
  const giant = createExecutableResolver({
    run: fakeRun({
      [node]: file => ({ code: 0, stdout: nodeReport(file, { node: `24.${'1'.repeat(300)}` }), stderr: '' }),
    }).run,
    env: { PATH: '' },
  });
  await assert.rejects(giant.resolve({ ...request, nodePath: node }), /256/);
});

// ---------------------------------------------------------------------------
// Launch-set builder
// ---------------------------------------------------------------------------

const UNAVAILABLE = { available: false, path: null, version: null };
const fakeBinary = (path, version = '9.9.9-fake') => ({ available: true, path, version });

async function fixtureRuntime(t, options = {}) {
  const dir = tmp(t, 'launch dir-');
  const home = join(dir, 'home');
  const stableRoot = join(home, 'slp-runtime');
  const sha = identity(root).sha256;
  const candidate = join(stableRoot, sha);
  install(root, candidate);
  const fakeDir = join(dir, 'provider-bin');
  mkdirSync(fakeDir, { recursive: true });
  const capture = { dir };
  const binaries = {};
  for (const family of FAMILIES) {
    if (options.missing === family) {
      binaries[family] = UNAVAILABLE;
      continue;
    }
    binaries[family] = fakeBinary(writeFakeBinary(fakeDir, family, dir));
  }
  const node = options.node ?? { path: process.execPath, version: process.versions.node };
  const launchers = createLauncherBuilder();
  const set = await launchers.publish({
    daemonHome: home,
    stableRoot,
    operationId: options.operationId ?? 'op-fixture-1',
    candidate: { sha256: sha, runtimePath: candidate },
    node,
    binaries,
  });
  const manifestPath = join(set.directory, 'launch.json');
  return { dir, home, stableRoot, sha, candidate, set, manifestPath, binaries, node, launchers, capture };
}

// A fake family executable: records argv and selected env, answers --version,
// sleeps on `hold`, exits 3 on `exit3`, otherwise echoes stdin (protocol mode).
function writeFakeBinary(dir, family, workdir) {
  const path = join(dir, family);
  const argvCapture = join(workdir, `${family}.argv`);
  const envCapture = join(workdir, `${family}.env`);
  const keys = [
    'SLP_SESSION_OPEN_GRANT', 'SLP_CODEX_BIN', 'SLP_PI_BIN', 'SLP_DEVIN_BIN', 'SLP_CLAUDE_BIN',
    'SLP_RUNTIME_ROOT', 'SLP_NODE_BIN', 'SLP_DAEMON_HOME', 'PASEO_HOME', 'SLP_MANAGED_RUNTIME',
    'PASEO_AGENT_ID', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS',
  ];
  writeFileSync(path, `#!/bin/sh
printf '%s\\0' "$@" > ${sq(argvCapture)}
{
for k in ${keys.join(' ')}; do
  if printenv "$k" >/dev/null 2>&1; then printf '%s=%s\\n' "$k" "$(printenv "$k")"; else printf '%s=<unset>\\n' "$k"; fi
done
} > ${sq(envCapture)}
for a in "$@"; do
  if [ "$a" = "hold" ]; then exec sleep 60; fi
  if [ "$a" = "exit3" ]; then exit 3; fi
done
if [ "$1" = "--version" ]; then printf '${family} 9.9.9-fake\\n'; exit 0; fi
cat
`);
  chmodSync(path, 0o755);
  return path;
}

const readArgv = path => {
  const parts = readFileSync(path).toString('utf8').split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
};
const readEnv = path =>
  Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }));

test('launchers: publish writes manifest + 3 devin quoted launchers, verify round-trips', async t => {
  const f = await fixtureRuntime(t);
  assert.equal(basename(f.set.directory), f.set.launchSetSha256);
  assert.equal(f.set.launchManifestSha256, f.set.launchSetSha256);
  const manifest = JSON.parse(readFileSync(f.manifestPath).toString('utf8'));
  assert.equal(manifest.schemaVersion, 1);
  // The manifest keeps the full four-family resolution record — the shipped
  // devin shim validates the complete sets — but only devin gets launchers.
  assert.deepEqual(manifest.families.sort(), [...FAMILIES].sort());
  assert.deepEqual(manifest.launcherFamilies, ['devin']);
  const names = readdirSync(f.set.directory).sort();
  assert.equal(names.length, 4);
  assert.deepEqual(f.set.files.map(file => basename(file.path)),
    ROLES.map(role => `slp-devin-${role}`));
  for (const file of f.set.files) assert.equal(file.mode, 0o755);
  const verified = await f.launchers.verify(f.set.directory);
  assert.equal(verified.launchSetSha256, f.set.launchSetSha256);
  // Deterministic: a second publish of identical inputs reuses the same set.
  const again = await f.launchers.publish({
    daemonHome: f.home,
    stableRoot: f.stableRoot,
    operationId: 'op-fixture-2',
    candidate: { sha256: f.sha, runtimePath: f.candidate },
    node: f.node,
    binaries: f.binaries,
  });
  assert.equal(again.launchSetSha256, f.set.launchSetSha256);
  // Exact launcher bytes: NODE_OPTIONS unset for the shim's own node boot,
  // fixed args single-quoted, -- separator, "$@" verbatim.
  const launcher = readFileSync(join(f.set.directory, 'slp-devin-peer'), 'utf8');
  const expected =
    '#!/bin/sh\n' +
    'unset NODE_OPTIONS\n' +
    `exec ${sq(f.node.path)} ${sq(join(f.candidate, 'bin', 'slp-shim.mjs'))} ` +
    `${sq(f.manifestPath)} ${sq(f.set.launchManifestSha256)} 'devin' 'peer' -- "$@"\n`;
  assert.equal(launcher, expected);
});

test('launchers: publish refuses symlink or non-directory staging paths', async t => {
  const f = await fixtureRuntime(t);
  const launchers = createLauncherBuilder();
  // A different node version changes the manifest digest, so publish cannot
  // take the verified-set early return and must reach the staging path.
  const request = {
    daemonHome: f.home,
    stableRoot: f.stableRoot,
    operationId: 'op-symlink',
    candidate: { sha256: f.sha, runtimePath: f.candidate },
    node: { path: f.node.path, version: '0.0.0-staging' },
    binaries: f.binaries,
  };
  // A symlink at .staging/<opId> is never traversed or removed.
  const outside = join(f.dir, 'outside');
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(f.stableRoot, '.staging'), { recursive: true });
  symlinkSync(outside, join(f.stableRoot, '.staging', 'op-symlink'));
  await assert.rejects(launchers.publish(request), error => {
    assert.equal(error.code, 'RUNTIME_INTEGRITY');
    return true;
  });
  assert.ok(existsSync(outside), 'symlink target untouched');
  // Same rule for a pre-placed symlink at the launch-set leaf.
  const opDir = join(f.stableRoot, '.staging', 'op-leaf');
  mkdirSync(opDir, { recursive: true });
  symlinkSync(outside, join(opDir, 'launch-set'));
  await assert.rejects(
    launchers.publish({ ...request, operationId: 'op-leaf' }),
    error => {
      assert.equal(error.code, 'RUNTIME_INTEGRITY');
      return true;
    },
  );
});

test('launchers: verify rejects tampering, extras and mode drift', async t => {
  const f = await fixtureRuntime(t);
  const one = join(f.set.directory, 'slp-devin-lead');
  appendFileSync(one, '# tampered\n');
  await assert.rejects(f.launchers.verify(f.set.directory), error => {
    assert.equal(error.code, 'RUNTIME_INTEGRITY');
    return true;
  });
  const f2 = await fixtureRuntime(t);
  writeFileSync(join(f2.set.directory, 'extra'), 'x');
  await assert.rejects(f2.launchers.verify(f2.set.directory), /unexpected launch-set member/);
  const f3 = await fixtureRuntime(t);
  appendFileSync(f3.manifestPath, '\n');
  await assert.rejects(f3.launchers.verify(f3.set.directory), /does not match its manifest digest/);
  const f4 = await fixtureRuntime(t);
  chmodSync(join(f4.set.directory, 'slp-devin-peer'), 0o644);
  await assert.rejects(f4.launchers.verify(f4.set.directory), /mode 644/);
});

test('launchers: verify rejects symlink members and special mode bits', async t => {
  // A member replaced by a symlink — even to byte-identical content outside
  // the immutable directory — is not a regular file and must be rejected.
  const f = await fixtureRuntime(t);
  const member = join(f.set.directory, 'slp-devin-peer');
  const bytes = readFileSync(member);
  const outside = join(f.dir, 'launcher-copy');
  writeFileSync(outside, bytes, { mode: 0o755 });
  rmSync(member);
  symlinkSync(outside, member);
  await assert.rejects(f.launchers.verify(f.set.directory), error => {
    assert.equal(error.code, 'RUNTIME_INTEGRITY');
    return true;
  });
  // Special bits (setuid here) must not be masked away: 04755 != 0755.
  const f2 = await fixtureRuntime(t);
  chmodSync(join(f2.set.directory, 'slp-devin-supervisor'), 0o4755);
  await assert.rejects(f2.launchers.verify(f2.set.directory), error => {
    assert.equal(error.code, 'RUNTIME_INTEGRITY');
    return true;
  });
});

test('launchers: verify rejects symlinked set dir, symlinked ancestors, wrong-identity real dir', async t => {
  const f = await fixtureRuntime(t);
  // A second real set in the same stable root (different manifest → new digest).
  const other = await f.launchers.publish({
    daemonHome: f.home,
    stableRoot: f.stableRoot,
    operationId: 'op-other',
    candidate: { sha256: f.sha, runtimePath: f.candidate },
    node: { path: f.node.path, version: '2.0.0-other' },
    binaries: f.binaries,
  });
  assert.notEqual(other.directory, f.set.directory);

  // (a) The set directory itself replaced by a symlink to the other set:
  // verify must reject, never silently verify the wrong identity.
  rmSync(other.directory, { recursive: true });
  symlinkSync(f.set.directory, other.directory);
  await assert.rejects(f.launchers.verify(other.directory), error => {
    assert.equal(error.code, 'RUNTIME_INTEGRITY');
    return true;
  });
  rmSync(other.directory); // removes the link itself; the target is untouched
  assert.ok(existsSync(f.manifestPath));

  // (b) A symlinked ancestor is rejected just the same — launchers/ here.
  const sr2 = join(f.dir, 'second-root');
  const outsideLaunchers = join(f.dir, 'outside-launchers');
  mkdirSync(join(outsideLaunchers, 'a'.repeat(64)), { recursive: true });
  mkdirSync(sr2);
  symlinkSync(outsideLaunchers, join(sr2, 'launchers'));
  await assert.rejects(
    f.launchers.verify(join(sr2, 'launchers', 'a'.repeat(64))),
    error => {
      assert.equal(error.code, 'RUNTIME_INTEGRITY');
      return true;
    },
  );
  // And a symlinked stable root one level above that.
  const home2 = join(f.dir, 'home2');
  const outsideRoot = join(f.dir, 'outside-root');
  mkdirSync(join(outsideRoot, 'launchers', 'b'.repeat(64)), { recursive: true });
  mkdirSync(home2);
  symlinkSync(outsideRoot, join(home2, 'slp-runtime'));
  await assert.rejects(
    f.launchers.verify(join(home2, 'slp-runtime', 'launchers', 'b'.repeat(64))),
    error => {
      assert.equal(error.code, 'RUNTIME_INTEGRITY');
      return true;
    },
  );

  // (c) A REAL directory holding a valid set under the wrong name is also
  // rejected: the returned identity is bound to the directory basename.
  const f2 = await fixtureRuntime(t);
  const wrong = join(f2.stableRoot, 'launchers', 'f'.repeat(64));
  renameSync(f2.set.directory, wrong);
  await assert.rejects(f2.launchers.verify(wrong), error => {
    assert.equal(error.code, 'RUNTIME_INTEGRITY');
    return true;
  });
});

test('launchers: publish is fail-closed on win32', async t => {
  const f = await fixtureRuntime(t);
  const win = createLauncherBuilder({ platform: 'win32' });
  await assert.rejects(
    win.publish({
      daemonHome: f.home,
      stableRoot: f.stableRoot,
      operationId: 'op-win',
      candidate: { sha256: f.sha, runtimePath: f.candidate },
      node: f.node,
      binaries: f.binaries,
    }),
    error => {
      assert.equal(error.code, 'UNSUPPORTED_PLATFORM');
      return true;
    },
  );
  await assert.rejects(win.verify(f.set.directory), error => {
    assert.equal(error.code, 'UNSUPPORTED_PLATFORM');
    return true;
  });
});

test('launchers: POSIX single-quote escaping survives spaces and quotes end-to-end', async t => {
  const dir = tmp(t, "quote'd dir-");
  const home = join(dir, 'home');
  const stableRoot = join(home, 'slp-runtime');
  const sha = identity(root).sha256;
  const candidate = join(stableRoot, sha);
  install(root, candidate);
  const weirdDir = join(dir, "we'ird node");
  mkdirSync(weirdDir, { recursive: true });
  const fakeNode = join(weirdDir, 'node bin');
  const argvCapture = join(dir, 'captured.argv');
  const optionsFlag = join(dir, 'node-options.flag');
  writeFileSync(
    fakeNode,
    `#!/bin/sh\nprintf '%s\\0' "$@" > ${sq(argvCapture)}\n` +
      `if printenv NODE_OPTIONS >/dev/null 2>&1; then printf set > ${sq(optionsFlag)}; else printf unset > ${sq(optionsFlag)}; fi\n`,
  );
  chmodSync(fakeNode, 0o755);
  const launchers = createLauncherBuilder();
  const set = await launchers.publish({
    daemonHome: home,
    stableRoot,
    operationId: 'op-quote',
    candidate: { sha256: sha, runtimePath: candidate },
    node: { path: fakeNode, version: '99.0.0' },
    binaries: Object.fromEntries(FAMILIES.map(family => [family, UNAVAILABLE])),
  });
  const userArgs = ['two words', "it's", '--', ''];
  const result = spawnSync(join(set.directory, 'slp-devin-peer'), userArgs, {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', NODE_OPTIONS: '--require /nonexistent/evil.cjs' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(optionsFlag, 'utf8'), 'unset', 'launcher unsets NODE_OPTIONS before node boots');
  const expected = [
    join(candidate, 'bin', 'slp-shim.mjs'),
    join(set.directory, 'launch.json'),
    set.launchManifestSha256,
    'devin',
    'peer',
    '--',
    ...userArgs,
  ];
  assert.deepEqual(readArgv(argvCapture), expected);
});

// ---------------------------------------------------------------------------
// Shim subprocess behavior (real Node + real candidate + fake family binaries)
// ---------------------------------------------------------------------------

const shimEnv = { PATH: '/usr/bin:/bin' };

function runShim(fixture, family, role, args, options = {}) {
  const shim = join(fixture.candidate, 'bin', 'slp-shim.mjs');
  return runNode([shim, fixture.manifestPath, fixture.set.launchManifestSha256, family, role, '--', ...args], options);
}

function runNode(args, options = {}) {
  const child = spawn(process.execPath, args, {
    env: options.env ?? shimEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  if (options.input !== undefined) {
    child.stdin.write(options.input);
    child.stdin.end();
  } else if (options.stdin !== false) {
    child.stdin.end();
  }
  const done = new Promise(resolvePromise =>
    child.on('close', (code, signal) =>
      resolvePromise({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })));
  return { child, done };
}

test('shim: missing args prints usage and exits nonzero', async () => {
  const { done } = runNode([join(root, 'bin', 'slp-shim.mjs')]);
  const result = await done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /usage: slp-shim\.mjs/);
});

test('shim: argv0 --version answers the real provider version with no provider env', async t => {
  const f = await fixtureRuntime(t);
  const { done } = runShim(f, 'codex', 'peer', ['--version'], { env: { PATH: '/usr/bin:/bin' } });
  const result = await done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'codex 9.9.9-fake\n');
  assert.ok(!result.stdout.includes(process.versions.node), 'no Node-version false positive');
  // The launcher executable alone reaches the same path (Paseo's argv0 probe).
  const viaLauncher = spawnSync(join(f.set.directory, 'slp-devin-peer'), ['--version'], {
    env: { PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  assert.equal(viaLauncher.status, 0);
  assert.equal(viaLauncher.stdout, 'devin 9.9.9-fake\n');
});

test('shim: frozen env comes from the manifest; grant/PASEO_AGENT_ID cannot select a binding', async t => {
  const f = await fixtureRuntime(t);
  const env = {
    PATH: '/usr/bin:/bin',
    SLP_SESSION_OPEN_GRANT: 'forged-grant',
    SLP_RUNTIME_ROOT: '/evil/runtime',
    SLP_CODEX_BIN: '/evil/codex',
    PASEO_AGENT_ID: 'agent-context-1',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--inspect',
  };
  const { done } = runShim(f, 'codex', 'peer', ['exit3'], { env });
  const result = await done;
  assert.equal(result.code, 3);
  const captured = readEnv(join(f.dir, 'codex.env'));
  assert.equal(captured.SLP_SESSION_OPEN_GRANT, '', 'grant resets to the empty sentinel');
  assert.equal(captured.SLP_RUNTIME_ROOT, f.candidate, 'runtime root is the manifest binding');
  assert.equal(captured.SLP_CODEX_BIN, f.binaries.codex.path);
  assert.equal(captured.SLP_NODE_BIN, f.node.path);
  assert.equal(captured.SLP_DAEMON_HOME, f.home);
  assert.equal(captured.PASEO_HOME, f.home);
  assert.equal(captured.SLP_MANAGED_RUNTIME, '1');
  assert.equal(captured.PASEO_AGENT_ID, 'agent-context-1', 'context preserved, never a selector');
  assert.equal(captured.ELECTRON_RUN_AS_NODE, '<unset>');
  assert.equal(captured.NODE_OPTIONS, '<unset>');
  assert.equal(captured.SLP_PI_BIN, '<unset>', 'only this family gets a bin variable');
});

test('shim: runtime tampering and manifest mismatch block the launch', async t => {
  const f = await fixtureRuntime(t);
  appendFileSync(join(f.candidate, 'src', 'common.md'), '\ntampered\n');
  const { done } = runShim(f, 'pi', 'peer', ['chat']);
  const result = await done;
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /candidate|integrity|changed/i);

  const f2 = await fixtureRuntime(t);
  appendFileSync(f2.manifestPath, ' ');
  const second = await runShim(f2, 'codex', 'peer', ['exit3']).done;
  assert.notEqual(second.code, 0);
  assert.match(second.stderr, /digest mismatch/);
});

test('shim: invalid family/role, missing separator and unavailable binary all fail closed', async t => {
  const f = await fixtureRuntime(t, { missing: 'pi' });
  const badRole = await runShim(f, 'codex', 'bogus', []).done;
  assert.equal(badRole.code, 1);
  assert.match(badRole.stderr, /invalid role/);
  const badFamily = await runShim(f, 'emacs', 'peer', []).done;
  assert.equal(badFamily.code, 1);
  const shim = join(f.candidate, 'bin', 'slp-shim.mjs');
  const noSep = await runNode([shim, f.manifestPath, f.set.launchManifestSha256, 'codex', 'peer', '--version']).done;
  assert.equal(noSep.code, 1);
  assert.match(noSep.stderr, /usage/);
  const missing = await runShim(f, 'pi', 'peer', ['chat']).done;
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /EXECUTABLE_UNAVAILABLE|no verified executable/);
});

test('shim: codex app-server protocol gets byte-exact role injection', async t => {
  const f = await fixtureRuntime(t);
  const instruction = managedInstruction(f, 'peer');
  const message = { jsonrpc: '2.0', id: 1, method: 'thread/start', params: { developerInstructions: 'host text' } };
  const { done } = runShim(f, 'codex', 'peer', ['app-server'], { input: JSON.stringify(message) + '\n' });
  const result = await done;
  assert.equal(result.code, 0, result.stderr);
  const expected = JSON.stringify(injectRole(message, instruction)) + '\n';
  assert.equal(result.stdout, expected, 'transformed frame is byte-exact');
  assert.deepEqual(readArgv(join(f.dir, 'codex.argv')), ['app-server']);
});

test('shim: pi role args are inserted before -- with byte-exact instruction', async t => {
  const f = await fixtureRuntime(t);
  const args = ['chat', '--', 'user words'];
  const { done } = runShim(f, 'pi', 'peer', args);
  const result = await done;
  assert.equal(result.code, 0, result.stderr);
  const instruction = managedInstruction(f, 'peer');
  assert.deepEqual(readArgv(join(f.dir, 'pi.argv')), piRoleArgs(args, instruction));
});

test('shim: devin acp session/prompt carries the role text block first', async t => {
  const f = await fixtureRuntime(t);
  const instruction = managedInstruction(f, 'lead');
  const message = { method: 'session/prompt', params: { sessionId: 's1', prompt: [{ type: 'text', text: 'do work' }] } };
  const { done } = runShim(f, 'devin', 'lead', [], { input: JSON.stringify(message) + '\n' });
  const result = await done;
  assert.equal(result.code, 0, result.stderr);
  const expected = acpRolePrompt(message, instruction, new Set());
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(expected.params.prompt[0].text, instruction);
  assert.deepEqual(readArgv(join(f.dir, 'devin.argv')), ['acp'], 'empty args default to acp');
});

test('shim: claude stream-json initialize appends role; auth status stays passthrough', async t => {
  const f = await fixtureRuntime(t);
  const instruction = managedInstruction(f, 'supervisor');
  const init = { type: 'control_request', request_id: 'r1', request: { subtype: 'initialize', appendSystemPrompt: 'base' } };
  const protocol = runShim(f, 'claude', 'supervisor',
    ['--input-format', 'stream-json', '--output-format', 'stream-json'],
    { input: JSON.stringify(init) + '\n' });
  const result = await protocol.done;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), claudeRolePrompt(init, instruction));

  const admin = await runShim(f, 'claude', 'supervisor', ['auth', 'status']).done;
  assert.equal(admin.code, 0, admin.stderr);
  assert.deepEqual(readArgv(join(f.dir, 'claude.argv')), ['auth', 'status']);
});

test('shim: exit codes, signal forwarding and line backpressure hold', async t => {
  const f = await fixtureRuntime(t);
  const exited = await runShim(f, 'codex', 'peer', ['exit3']).done;
  assert.equal(exited.code, 3, 'native exit code forwards through wrapper and shim');

  // SIGTERM to the launcher forwards to the family process; the shim exits 143.
  // Wait for the fake binary's argv marker instead of a fixed sleep.
  const marker = join(f.dir, 'codex.argv');
  rmSync(marker, { force: true });
  const held = runShim(f, 'codex', 'peer', ['app-server', 'hold'], { stdin: false });
  const deadline = Date.now() + 5000;
  while (!existsSync(marker)) {
    if (Date.now() > deadline) throw new Error('fake binary never wrote its argv marker');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  held.child.kill('SIGTERM');
  const sig = await held.done;
  assert.equal(sig.code, 143);
  assert.equal(sig.signal, null);

  // A burst of frames exercises the write/drain loop; order and count survive.
  const lines = Array.from({ length: 1500 }, (_, i) => JSON.stringify({ method: 'noop', i }));
  const burst = runShim(f, 'codex', 'peer', ['app-server'], { input: lines.join('\n') + '\n' });
  const out = await burst.done;
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(out.stdout.trim().split('\n'), lines);
});
