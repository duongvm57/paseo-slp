import { existsSync, readFileSync, writeFileSync, rmSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { json, readJson, hash, identity, install, verifyInstall, files } from './package.mjs';
import { roles, profileRoles, families, profileId, providerId } from './profiles.mjs';
import { transportOf } from './binding.mjs';
import { emptyCatalog, validateCatalog, routingPath } from './routing.mjs';
import { configFile, writeConfig, mcpFlags, requireMcp, verifyOwnedProviders, verifyOwnedProfiles,
  providers as hostProviders, agentProfiles as hostAgentProfiles } from './host-config.mjs';

export function configurationPlan(destination, config) {
  const providers = {}, profiles = [];
  const existing = hostAgentProfiles(config);
  for (const role of roles) for (const family of families) {
    const id = providerId(role, family);
    if (Object.hasOwn(hostProviders(config), id) || (profileRoles.includes(role) && existing.some(p => p.id === profileId(role)))) {
      throw new Error(`SLP entry already exists: ${role}; uninstall its owning installation first`);
    }
    providers[id] = { extends: transportOf(family), label: `SLP ${family} ${role}`, command: [process.execPath, join(destination, `bin/${family}-role.mjs`), role] };
  }
  for (const role of profileRoles) {
    profiles.push({ id: profileId(role), name: `SLP ${role[0].toUpperCase() + role.slice(1)}`,
      provider: providerId(role),
      notes: `SLP ${role}; installed role instructions load automatically. Use Paseo delegation and finish notifications.` });
  }
  return { providers, profiles };
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
    verifyOwnedProviders(file.config, binding.providers);
    verifyOwnedProfiles(file.config, binding.profiles, 'bound');
    requireMcp(file.config);
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
  const mcpBefore = Object.fromEntries(mcpFlags.map(key => [key, next.daemon.mcp?.[key] ?? null]));
  next.daemon.mcp = { ...next.daemon.mcp, ...Object.fromEntries(mcpFlags.map(key => [key, true])) };
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
  verifyOwnedProviders(next, binding.providers);
  for (const id of Object.keys(binding.providers)) delete next.agents.providers[id];
  verifyOwnedProfiles(next, binding.profiles, 'exact');
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
  verifyOwnedProviders(base, prior.providers, 'previous installation');
  for (const id of Object.keys(prior.providers)) delete base.agents.providers[id];
  const saved = verifyOwnedProfiles(base, prior.profiles, 'bound');
  base.daemon.agentProfiles = base.daemon.agentProfiles.filter(p => !saved.has(p.id));
  const proposal = configurationPlan(destination, base);
  proposal.profiles = proposal.profiles.map(p => saved.get(p.id) ?? p);
  const retainedIds = new Set(proposal.profiles.map(profile => profile.id));
  const retiredProfiles = [...saved.values()].filter(profile => !retainedIds.has(profile.id));
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
    requireMcp(next);
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
    { path: join(repository, '.paseo-slp/notebook.md'), bytes: '# Supervisor notebook\n\nPurpose and owner are recorded in .paseo-slp/WORKSPACE_PROTOCOL.md.\n' },
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
