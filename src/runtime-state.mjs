import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { hash, readJson, verifyInstall } from './package.mjs';
import { isManagedRuntime, managedHome } from './managed-home.mjs';

// H13: the plugin's RPC surface (status, local-target, ...) is reachable only
// through the Manager UI or a hand-rolled WS frame — no `paseo plugin invoke`
// CLI or MCP tool exists. These probes recompute the file-derivable parts of
// the daemon's views from <daemonHome>/slp-runtime/state and config.json.
// Everything not derivable from local files is reported as a gap, never
// guessed; mutations stay Human-authority and are not exposed here. Retire
// when the host ships `paseo plugin invoke` or MCP `invoke_plugin_rpc`.

// Same detection as the plugin's local-target RPC: the daemon home this
// process would serve. Explicit flag wins; a managed session falls back to
// its bound SLP_DAEMON_HOME/PASEO_HOME (fail closed, never ~/.paseo); an
// unmanaged process mirrors the host default chain.
export function localTarget(explicit) {
  if (explicit != null) {
    if (!isAbsolute(explicit)) throw new Error('Absolute path required for --paseo-home');
    return { daemonHome: explicit, source: 'flag' };
  }
  if (isManagedRuntime()) return { daemonHome: managedHome(), source: 'managed-env' };
  if (process.env.PASEO_HOME) return { daemonHome: process.env.PASEO_HOME, source: 'env' };
  return { daemonHome: join(homedir(), '.paseo'), source: 'default' };
}

const readStateFile = (path, { jsonFile }) => {
  try {
    const bytes = readFileSync(path, 'utf8');
    return jsonFile ? JSON.parse(bytes) : bytes;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    // Corrupt plugin-owned state is evidence, not absence — fail closed.
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
};

// slp-owned config entries: provider ids slp-<family>-<role> under
// agents.providers, profile ids slp-<role> under daemon.agentProfiles, and
// daemon.mcp.injectIntoAgents. Presence-only — byte equality against the
// injected projection is a daemon-side concern.
function ownedConfigScan(config) {
  const providers = Object.keys(config?.agents?.providers ?? {}).filter(id => id.startsWith('slp-'));
  const profiles = (Array.isArray(config?.daemon?.agentProfiles) ? config.daemon.agentProfiles : [])
    .map(profile => profile?.id).filter(id => typeof id === 'string' && id.startsWith('slp-'));
  return { providers, profiles, injectIntoAgents: config?.daemon?.mcp?.injectIntoAgents === true };
}

export function runtimeStatus(explicit) {
  const { daemonHome, source } = localTarget(explicit);
  const home = existsSync(daemonHome) ? realpathSync(daemonHome) : resolve(daemonHome);
  const stableRoot = join(home, 'slp-runtime');
  const stateDir = join(stableRoot, 'state');
  const gaps = [];
  const receipt = readStateFile(join(stateDir, 'receipt.json'), { jsonFile: true });
  const roleRouting = readStateFile(join(stateDir, 'role-routing.json'), { jsonFile: true });
  const communicationLanguage = readStateFile(join(stateDir, 'communication-language'), { jsonFile: false });
  const config = (() => {
    try { return readJson(join(home, 'config.json')); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      gaps.push(`config.json unreadable (${error.message}) — orphan/drift scan skipped`);
      return undefined;
    }
  })();
  // null = config absent (nothing to scan); undefined = present but unreadable.
  const ownedScan = config == null ? config : ownedConfigScan(config);

  if (!receipt) {
    // Mirror the daemon heuristic: no receipt + orphaned slp-* entries in
    // config means an interrupted activation — RECOVERY_REQUIRED, not clean.
    const orphaned = ownedScan
      ? [...ownedScan.providers, ...ownedScan.profiles]
      : [];
    return {
      derivedFrom: 'local-files', daemonHome: home, homeSource: source, stableRoot,
      state: ownedScan === null ? 'INACTIVE'
        : ownedScan === undefined ? 'UNKNOWN'
        : orphaned.length ? 'RECOVERY_REQUIRED' : 'INACTIVE',
      receipt: null, roleRouting, communicationLanguage,
      ...(orphaned.length ? { orphanedEntries: orphaned } : {}),
      gaps: [...gaps,
        'no receipt — live conflicts, family availability and managedProfiles are daemon-computed views'],
    };
  }

  const checks = {};
  checks.targetMatch = receipt.target?.daemonHome === home;
  const binding = receipt.binding;
  if (binding) {
    // Runtime integrity: the bound runtime dir must still verify and carry
    // the recorded candidate hash.
    checks.runtime = (() => {
      const runtimePath = binding.runtimePath;
      if (typeof runtimePath !== 'string' || !existsSync(runtimePath)) {
        return { ok: false, detail: `runtimePath ${runtimePath} missing` };
      }
      try {
        const manifest = verifyInstall(runtimePath);
        const match = manifest.candidate.sha256 === binding.candidateSha256;
        return { ok: match, candidateSha256: manifest.candidate.sha256,
          ...(match ? {} : { detail: `candidate ${manifest.candidate.sha256} != binding ${binding.candidateSha256}` }) };
      } catch (error) {
        return { ok: false, detail: error.message };
      }
    })();
    // Launcher bytes the receipt recorded, re-hashed from disk.
    checks.launchers = (binding.launcherFiles ?? []).map(file => {
      if (!existsSync(file.path)) return { path: file.path, ok: false, detail: 'missing' };
      const actual = hash(readFileSync(file.path));
      return { path: file.path, ok: actual === file.sha256,
        ...(actual === file.sha256 ? {} : { detail: 'sha256 drift' }) };
    });
    // Config drift, presence-only: entries the activation injected must still
    // be present. Value comparison stays a daemon concern.
    if (ownedScan) {
      const expected = Object.entries(binding.owned?.providers ?? {})
        .filter(([, entry]) => entry.present).map(([id]) => id);
      checks.configDrift = {
        missingProviders: expected.filter(id => !ownedScan.providers.includes(id)),
        missingProfiles: (binding.owned?.profiles ?? [])
          .map(entry => entry.value?.id).filter(id => id && !ownedScan.profiles.includes(id)),
      };
    }
  }
  if (!ownedScan) gaps.push('config.json absent — config-drift presence check skipped');
  gaps.push('live conflict recomputation and family availability probes are daemon-computed — recorded binary paths are receipt data, not fresh probes');

  return {
    derivedFrom: 'local-files', daemonHome: home, homeSource: source, stableRoot,
    state: receipt.state,
    receipt: {
      revision: receipt.revision, state: receipt.state, pluginId: receipt.pluginId,
      target: receipt.target, createdAt: receipt.createdAt, updatedAt: receipt.updatedAt,
      activeOperationId: receipt.activeOperationId,
      binding: binding ? {
        candidateSha256: binding.candidateSha256, payloadSha256: binding.payloadSha256,
        runtimePath: binding.runtimePath, nodePath: binding.node?.path ?? binding.nodePath,
        baseline: binding.baseline, activatedAt: binding.activatedAt, verifiedAt: binding.verifiedAt,
        launcherCount: (binding.launcherFiles ?? []).length,
        binaries: Object.fromEntries(Object.entries(binding.binaries ?? {})
          .map(([family, value]) => [family, { path: value?.path ?? value, exists: existsSync(value?.path ?? value) }])),
        ownedProviders: Object.entries(binding.owned?.providers ?? {})
          .filter(([, entry]) => entry.present).map(([id]) => id),
        managedProfiles: (binding.owned?.profiles ?? []).map(entry => ({
          id: entry.value?.id, provider: entry.value?.provider ?? null,
          model: entry.value?.model ?? null, modeId: entry.value?.modeId ?? null,
          thinkingOptionId: entry.value?.thinkingOptionId ?? null,
          featureValues: entry.value?.featureValues ?? null,
        })),
      } : null,
      operations: (receipt.operations ?? []).map(op => ({
        operationId: op.operationId, kind: op.kind, phase: op.phase, outcome: op.outcome,
        conflicts: (op.conflicts ?? []).length,
        acceptedAt: op.acceptedAt, completedAt: op.completedAt ?? null,
      })),
      retainedCount: (receipt.retained ?? []).length,
    },
    roleRouting, communicationLanguage,
    checks, gaps,
  };
}
