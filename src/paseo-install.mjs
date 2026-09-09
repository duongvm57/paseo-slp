import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { json, readJson, hash, identity, install, verifyInstall, files } from './package.mjs';
import { roles, families, profileId, providerId } from './profiles.mjs';
import { emptyCatalog, validateCatalog, routingPath } from './routing.mjs';

export { roles, profileId, providerId } from './profiles.mjs';
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
  for (const role of roles) for (const family of families) {
    const id = providerId(role, family);
    if (Object.hasOwn(config.agents?.providers ?? {}, id) || existing.some(p => p.id === profileId(role))) {
      throw new Error(`SLP entry already exists: ${role}; uninstall its owning installation first`);
    }
    providers[id] = { extends: family, label: `SLP ${family} ${role}`, command: [process.execPath, join(destination, `bin/${family}-role.mjs`), role] };
  }
  for (const role of roles) {
    profiles.push({ id: profileId(role), name: `SLP ${role[0].toUpperCase() + role.slice(1)}`,
      provider: providerId(role),
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
      const role = expected.id.startsWith('slp-peer-') ? 'peer' : expected.id.slice(4);
      if (matches.length !== 1 || !families.some(f => matches[0].provider === providerId(role, f))) throw new Error(`Missing or rebound profile ${expected.id}`);
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

// Explicit side-by-side cutover: keep the old bytes for sessions already using them.
export function upgradePaseo(source, destination, previous, apply = false) {
  if (!isAbsolute(destination) || !isAbsolute(previous)) throw new Error('Absolute new and previous installation paths required');
  destination = resolve(destination); previous = resolve(previous);
  const within = relative(previous, destination);
  if (!within || (!within.startsWith('..') && !isAbsolute(within))) throw new Error('New installation must be outside the previous installation');
  if (existsSync(destination)) throw new Error('Upgrade requires a new destination');
  const priorManifest = verifyInstall(previous);
  if (!priorManifest.paseoBindingSha256) throw new Error('Upgrade requires a Paseo-integrated previous installation');
  const prior = readJson(join(previous, 'paseo-binding.json'));
  const home = resolve(prior.configPath, '..');
  const homeWithinInstall = relative(destination, home);
  if (!homeWithinInstall || (!homeWithinInstall.startsWith('..') && !isAbsolute(homeWithinInstall))) throw new Error('Paseo home must be outside the installation directory');
  const file = configFile(home);
  const base = structuredClone(file.config);
  for (const [id, expected] of Object.entries(prior.providers)) {
    if (!isDeepStrictEqual(base.agents?.providers?.[id], expected)) throw new Error(`Modified provider ${id}; preserve previous installation`);
    delete base.agents.providers[id];
  }
  const saved = new Map();
  for (const expected of prior.profiles) {
    const matches = base.daemon?.agentProfiles?.filter(p => p.id === expected.id) ?? [];
    const role = expected.id.startsWith('slp-peer-') ? 'peer' : expected.id.slice(4);
    if (matches.length !== 1 || !families.some(f => matches[0].provider === providerId(role, f))) throw new Error(`Missing or rebound profile ${expected.id}`);
    saved.set(expected.id, matches[0]);
  }
  base.daemon.agentProfiles = base.daemon.agentProfiles.filter(p => !saved.has(p.id));
  const proposal = configurationPlan(destination, base);
  proposal.profiles = proposal.profiles.map(p => saved.get(p.id) ?? p);
  const retiredProfiles = [...saved.values()].filter(profile => profile.id.startsWith('slp-peer-'));
  const result = { destination, retainedInstallation: previous, configPath: file.path, applied: apply, ...proposal,
    retiredProfiles: retiredProfiles.map(profile => profile.id), reloadRequired: true };
  if (!apply) return result;
  const candidate = install(source, destination).candidate;
  try {
    const next = structuredClone(base);
    next.agents.providers = { ...next.agents.providers, ...proposal.providers };
    next.daemon.agentProfiles = [...next.daemon.agentProfiles, ...proposal.profiles];
    const binding = json({ configPath: file.path, ...proposal, mcpBefore: prior.mcpBefore,
      retiredProfiles: [...(prior.retiredProfiles ?? []), ...retiredProfiles] });
    if (next.daemon.mcp?.enabled !== true || next.daemon.mcp?.injectIntoAgents !== true) throw new Error('SLP requires Paseo MCP enabled and injected');
    writeFileSync(join(destination, 'paseo-binding.json'), binding, { flag: 'wx', mode: 0o600 });
    const manifest = readJson(join(destination, 'installed.json'));
    writeFileSync(join(destination, 'installed.json'), json({ ...manifest, paseoBindingSha256: hash(binding) }));
    writeConfig(file, next);
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
  return { ...result, candidate };
}

export function initWorkspace(source, repository, apply = false, routingFrom) {
  const catalogPath = routingPath(repository);
  repository = resolve(catalogPath, '../..');
  // Validate an explicit import before writing any repo files. Never consult host defaults.
  if (routingFrom != null && !isAbsolute(routingFrom)) throw new Error('Absolute --routing-from path required');
  const catalog = routingFrom == null ? emptyCatalog() : validateCatalog(readJson(routingFrom));
  const entries = [
    { path: join(repository, '.paseo-slp/WORKSPACE_PROTOCOL.md'), bytes: readFileSync(join(source, 'src/templates/WORKSPACE_PROTOCOL.md')) },
    { path: catalogPath, bytes: json(catalog) },
  ];
  // Check all existing targets and ancestors before mutation, including dangling links.
  const exists = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  for (const entry of entries) {
    for (let parent = resolve(entry.path, '..'); parent !== resolve(repository); parent = resolve(parent, '..')) {
      const stat = exists(parent);
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Expected repo directory: ${parent}`);
      if (parent === resolve(parent, '..')) throw new Error('Initialization path escaped repository');
    }
    const stat = exists(entry.path);
    if (stat && !stat.isFile()) throw new Error(`Expected regular repo file: ${entry.path}`);
    entry.preserved = Boolean(stat);
  }
  const result = entries.map(({ path, bytes, preserved }) => ({ path, preserved, applied: apply && !preserved, ...(!preserved ? { sha256: hash(bytes) } : {}) }));
  if (apply) {
    for (const { path, bytes, preserved } of entries) {
      if (preserved) continue;
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, bytes, { flag: 'wx' });
    }
  }
  return { repository, files: result, applied: result.some(file => file.applied), preserved: result.every(file => file.preserved) };
}
