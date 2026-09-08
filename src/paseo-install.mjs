import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { json, readJson, hash, identity, install, verifyInstall, files } from './package.mjs';

export const roles = ['supervisor', 'lead', 'peer'];
export const profileId = role => `slp-${role}`;
export const providerId = role => `slp-codex-${role}`;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function configFile(home) {
  if (!isAbsolute(home)) throw new Error('Absolute Paseo home required');
  const path = join(home, 'config.json');
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error('Paseo config must be a regular file');
  const bytes = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const config = bytes === null ? { version: 1 } : JSON.parse(bytes);
  for (const value of [config, config.agents ?? {}, config.agents?.providers ?? {}, config.daemon ?? {}, config.daemon?.mcp ?? {}]) {
    if (!record(value)) throw new Error('Invalid Paseo configuration object');
  }
  if (!Array.isArray(config.daemon?.agentProfiles ?? [])) throw new Error('Invalid Paseo agentProfiles');
  return { path, bytes, config };
}

export function configurationPlan(destination, config) {
  const providers = {}, profiles = [];
  const existing = config.daemon?.agentProfiles ?? [];
  for (const role of roles) {
    const id = providerId(role);
    if (Object.hasOwn(config.agents?.providers ?? {}, id) || existing.some(p => p.id === profileId(role))) {
      throw new Error(`SLP entry already exists: ${role}; uninstall its owning installation first`);
    }
    providers[id] = { extends: 'codex', label: `SLP ${role}`, command: [process.execPath, join(destination, 'bin/codex-role.mjs'), role] };
    profiles.push({ id: profileId(role), name: `SLP ${role[0].toUpperCase() + role.slice(1)}`,
      provider: id,
      notes: `SLP ${role}; installed role instructions load automatically. ${role === 'peer' ? 'One bounded outcome; no orchestration.' : 'Use Paseo delegation and finish notifications.'}` });
  }
  return { providers, profiles };
}

function writeConfig(file, next) {
  // Recheck immediately before replacing; preserve config permissions and unrelated fields.
  const current = existsSync(file.path) ? readFileSync(file.path, 'utf8') : null;
  if (current !== file.bytes) throw new Error('Paseo config changed during installation; retry');
  const temp = `${file.path}.slp-${process.pid}.tmp`;
  let created = false;
  try {
    writeFileSync(temp, json(next), { flag: 'wx', mode: file.bytes === null ? 0o600 : lstatSync(file.path).mode & 0o777 });
    created = true;
    renameSync(temp, file.path);
  } finally { if (created) rmSync(temp, { force: true }); }
}

export function installPaseo(source, destination, home, apply = false) {
  destination = resolve(destination);
  const homeWithinInstall = relative(destination, resolve(home));
  if (!homeWithinInstall || (!homeWithinInstall.startsWith('..') && !isAbsolute(homeWithinInstall))) throw new Error('Paseo home must be outside the installation directory');
  const file = configFile(home);
  if (existsSync(destination)) {
    const manifest = verifyInstall(destination);
    if (manifest.candidate.sha256 !== identity(source).sha256) throw new Error('Different candidate already installed; detach the previous installation before upgrading');
    const binding = readJson(join(destination, 'paseo-binding.json'));
    if (binding.configPath !== file.path) throw new Error('Installation belongs to a different Paseo home');
    for (const [id, expected] of Object.entries(binding.providers)) {
      if (!isDeepStrictEqual(file.config.agents?.providers?.[id], expected)) throw new Error(`Modified provider ${id}; preserve installation`);
    }
    for (const expected of binding.profiles) {
      const matches = file.config.daemon?.agentProfiles?.filter(p => p.id === expected.id) ?? [];
      if (matches.length !== 1 || matches[0].provider !== expected.provider) throw new Error(`Missing or rebound profile ${expected.id}`);
    }
    if (file.config.daemon?.mcp?.enabled !== true || file.config.daemon?.mcp?.injectIntoAgents !== true) throw new Error('SLP requires Paseo MCP enabled and injected');
    return { destination, configPath: file.path, applied: false, alreadyInstalled: true, reloadRequired: true };
  }
  const proposal = configurationPlan(destination, file.config);
  const result = { destination, configPath: file.path, applied: apply, ...proposal,
    mcp: { enabled: true, injectIntoAgents: true }, reloadRequired: true };
  if (!apply) return result;
  const candidate = install(source, destination).candidate;
  const next = structuredClone(file.config);
  next.agents ??= {};
  next.agents.providers = { ...next.agents.providers, ...proposal.providers };
  next.daemon ??= {};
  next.daemon.agentProfiles = [...(next.daemon.agentProfiles ?? []), ...proposal.profiles];
  const mcpBefore = Object.fromEntries(['enabled', 'injectIntoAgents'].map(key => [key, next.daemon.mcp?.[key] ?? null]));
  next.daemon.mcp = { ...next.daemon.mcp, enabled: true, injectIntoAgents: true };
  try {
    // Only owned entries and two shared MCP flags are recorded, never credentials.
    const binding = json({ configPath: file.path, ...proposal, mcpBefore });
    writeFileSync(join(destination, 'paseo-binding.json'), binding, { flag: 'wx', mode: 0o600 });
    const manifest = readJson(join(destination, 'installed.json'));
    writeFileSync(join(destination, 'installed.json'), json({ ...manifest, paseoBindingSha256: hash(binding) }));
    mkdirSync(home, { recursive: true });
    writeConfig(file, next);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  return { ...result, candidate };
}

export function uninstallPaseo(destination, apply = false) {
  verifyInstall(destination);
  const bindingPath = join(destination, 'paseo-binding.json');
  const binding = readJson(bindingPath);
  const file = configFile(resolve(binding.configPath, '..'));
  const next = structuredClone(file.config);
  for (const [id, expected] of Object.entries(binding.providers)) {
    if (!isDeepStrictEqual(next.agents?.providers?.[id], expected)) throw new Error(`Modified provider ${id}; preserve installation`);
    delete next.agents.providers[id];
  }
  for (const expected of binding.profiles) {
    const matches = next.daemon?.agentProfiles?.filter(p => p.id === expected.id) ?? [];
    if (matches.length !== 1 || !isDeepStrictEqual(matches[0], expected)) throw new Error(`Modified profile ${expected.id}; preserve installation`);
  }
  next.daemon.agentProfiles = next.daemon.agentProfiles.filter(p => !binding.profiles.some(owned => owned.id === p.id));
  for (const [key, before] of Object.entries(binding.mcpBefore)) {
    if (next.daemon.mcp?.[key] !== true) throw new Error(`Modified MCP setting ${key}; preserve installation`);
    if (before === null) delete next.daemon.mcp[key]; else next.daemon.mcp[key] = before;
  }
  // Validate removal before detaching host entries, including user-added files.
  const candidate = verifyInstall(destination).candidate;
  const expectedPaths = [...candidate.files.map(f => f.path), 'installed.json', 'paseo-binding.json'].sort();
  if (!isDeepStrictEqual(files(destination).sort(), expectedPaths)) throw new Error('Extra files: preserve directory for manual review');
  if (apply) {
    writeConfig(file, next);
    rmSync(destination, { recursive: true });
  }
  return { destination, configPath: file.path, applied: apply, reloadRequired: true };
}

export function initWorkspace(source, repository, apply = false) {
  if (!isAbsolute(repository) || !lstatSync(repository).isDirectory()) throw new Error('Absolute workspace directory required');
  const path = join(repository, 'WORKSPACE_PROTOCOL.md');
  if (existsSync(path)) return { path, preserved: true, applied: false };
  const bytes = readFileSync(join(source, 'src/templates/WORKSPACE_PROTOCOL.md'));
  if (apply) writeFileSync(path, bytes, { flag: 'wx' });
  return { path, sha256: hash(bytes), applied: apply };
}
