import { join, isAbsolute, basename } from 'node:path';
import { statSync, accessSync, constants } from 'node:fs';
import { savedProfileBinding, roleProvider, providerId, profileId, roles } from './profiles.mjs';
import { verifyInstall, snapshot, readJson } from './package.mjs';
import { catalogBinding, readCatalog } from './routing.mjs';
import { bindingCheck, dispositionPattern, verifyProvider } from './binding.mjs';
import { roleInstructions, orchestrates, policyLocators, carrierBlock } from './role-bundle.mjs';
import { spawnKit } from './spawn-kit.mjs';

// Every Binding source normalises to { binding, routing? } right here, so nothing
// downstream unwraps a source-specific shape. Order is precedence, highest first.
const bindingSources = [
  {
    name: 'saved profiles',
    selects: request => request.profiles != null,
    resolve: (role, request, route) => ({ binding: savedProfileBinding(role, request.profiles, request.providers, route) }),
  },
  {
    name: 'catalog routing',
    selects: request => request.route?.optionId != null,
    resolve: (role, request, route) => catalogBinding(request.repository, role, request.providers, route, request.paseoHome),
  },
  {
    name: 'an explicit binding',
    selects: request => request.binding != null,
    resolve: (role, request) => ({ binding: request.binding }),
  },
];

export function resolveBinding(role, request, disposition) {
  if (role === 'peer') {
    if (request.binding != null) throw new Error('Peer requires a project pool option; explicit bindings cannot bypass routing');
    // Profile inventory may accompany discovery, but never selects a Peer runtime.
    if (!request.route?.optionId) throw new Error('Peer requires a project routing option; run onboarding and select route.optionId with catalogSha256');
    return catalogBinding(request.repository, role, request.providers, { ...request.route, disposition }, request.paseoHome);
  }
  const source = bindingSources.find(candidate => candidate.selects(request));
  if (!source) throw new Error('Binding source required: saved profiles, catalog routing or an explicit binding');
  if (request.binding != null && source.name !== 'an explicit binding') {
    throw new Error(`Choose ${source.name} or an explicit binding, not both`);
  }
  return source.resolve(role, request, { ...request.route, disposition });
}

export function prompt(root, role, assignment, binding) {
  bindingCheck(binding);
  // Stock providers carry role instructions inside the prompt; the carrier is
  // appended by plan(), so the inline copy opts out to avoid a duplicate block.
  const instructions = binding.provider === roleProvider(role, binding.provider)
    ? roleInstructions(root, role, process.env, { carrier: false }) : `SLP role=${role}\n`;
  return `${instructions}\nLaunch binding: ${JSON.stringify(binding)}\nAssignment:\n${assignment}\n`;
}

// Provider switching creates a new session; it never mutates provider identity
// or reparents agents. The packet is evidence, gathered before anything is planned.
function handoffPacket(request) {
  const handoff = request.handoff;
  for (const key of ['previousAgentId', 'reason', 'authority', 'state']) {
    if (typeof handoff?.[key] !== 'string' || !handoff[key].trim()) throw new Error(`Missing handoff ${key}`);
  }
  if (handoff.previousOwner?.settled !== true || typeof handoff.previousOwner.evidence !== 'string' || !handoff.previousOwner.evidence.trim()) {
    throw new Error('Handoff requires old-owner settlement evidence; quota failure or idle alone is insufficient');
  }
  if (!Array.isArray(handoff.resources)) throw new Error('Handoff requires a resources list (including remaining Peer IDs and wake owners)');
  const candidate = snapshot(request.repository);
  const nestedIncomplete = [];
  const collect = (subs, prefix = '') => subs?.forEach(sub => {
    sub.incomplete?.forEach(path => nestedIncomplete.push(`${prefix}${sub.path}/${path}`));
    collect(sub.nested, `${prefix}${sub.path}/`);
  });
  collect(candidate.nested);
  return { ...handoff, candidate: { head: candidate.head, sha256: candidate.sha256,
    ...(candidate.incomplete ? { incomplete: candidate.incomplete } : {}),
    ...(nestedIncomplete.length ? { nestedIncomplete } : {}) } };
}

const unprovenScope = packet => [...(packet?.candidate?.incomplete ?? []), ...(packet?.candidate?.nestedIncomplete ?? [])];

const handoffNotice = (role, packet) => `\nProvider handoff evidence:\n${JSON.stringify(packet, null, 2)}\n` +
  'Before taking ownership, verify the current candidate and old-owner settlement against host/repository evidence. ' +
  'Reconcile existing Peer/workspace/resource ownership with the Human or assigned Supervisor. ' +
  'Parentage has not changed; do not claim control of old descendants or create duplicate writers. ' +
  (unprovenScope(packet).length
    ? `Snapshot evidence gap: ${unprovenScope(packet).join(', ')} ${unprovenScope(packet).length > 1 ? 'are' : 'is'} unproven submodule scope — do not claim full-candidate coverage for it. `
    : '') +
  'Acknowledge the transferred assignment. ' +
  (orchestrates(role) ? 'Use references/provider-routing.md for the handoff procedure.\n' : 'Return bounded findings to Lead; do not manage agents.\n');

// request.inventoryFile fills providers/profiles the request did not inline;
// explicit inline arrays always win. The file must be a JSON object whose
// providers/profiles fields, when present, are arrays.
function mergeInventory(request) {
  if (request.inventoryFile == null) return request;
  if (typeof request.inventoryFile !== 'string' || !isAbsolute(request.inventoryFile)) throw new Error('Absolute inventoryFile required');
  let inventory;
  try { inventory = readJson(request.inventoryFile); }
  catch (error) { throw new Error(`inventoryFile is not a readable JSON file: ${request.inventoryFile} (${error.message})`); }
  if (inventory === null || typeof inventory !== 'object' || Array.isArray(inventory)) throw new Error('inventoryFile must be a JSON object');
  for (const key of ['providers', 'profiles']) {
    if (inventory[key] != null && !Array.isArray(inventory[key])) throw new Error(`inventoryFile.${key} must be an array`);
    if (request[key] == null && inventory[key] != null) request = { ...request, [key]: inventory[key] };
  }
  return request;
}

// request.assignmentFile names the full bounded assignment kept out of the
// prompt; it must be an existing regular readable file.
function assignmentFile(path) {
  if (path == null) return null;
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Absolute assignmentFile required');
  let stat;
  try { stat = statSync(path); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Assignment file does not exist: ${path}`);
    throw error;
  }
  if (!stat.isFile()) throw new Error(`Assignment file must be a regular file: ${path}`);
  try { accessSync(path, constants.R_OK); }
  catch { throw new Error(`Assignment file is not readable: ${path}`); }
  return path;
}

// The orientation manifest carries mechanical locators only — installed root,
// routing catalog hash, and the byte size + sha256 of each policy file the
// role's bundle loads — so a new seat skips the filesystem hunt. It must never
// pre-solve interpretation: entries sort by path so the list carries no
// bundle/load-order hint, and there are no load-bearing markers or digested
// content (note #33: seat-side re-derivation is the check that catches upstream
// premise errors). A receipt-declared file absent from disk is still listed,
// marked missing, so a broken install stays visible to the seat.
function orientation(root, role, routing) {
  return {
    installedRoot: root,
    catalogSha256: routing?.catalogSha256 ?? null,
    policyBytes: policyLocators(root, role),
  };
}

// The carrier is the self-contained block that actually reaches the spawned
// seat: create_agent transmits only create.initialPrompt, so plan-level
// spawnKit/orientation alone would never arrive. carrierBlock() (shared with
// role-bundle) repeats the same data in compact text — absolute policy
// locators (missing markers included) and the approximate kit signatures —
// with no file contents inlined. This caption is pinned by contract: the
// values are plan-time, measured where prepare ran.
const planLocatorCaption = 'absolute paths; size/sha256 are plan-time values for verifying the file found is the one prepare checked';

// The prompt-side carrier is dropped only when the target is this package's
// canonical role wrapper for the requested role AND the request's provider
// inventory observed it live — the wrapper injects the same carrier at
// session entry, so shipping both duplicates the block in one session. A
// bare slp-* prefix or caller env proves nothing about the receiving
// provider; a legacy or unverified target keeps the fallback carrier. When
// in doubt the block stays: a duplicate is recoverable, a missing carrier
// is not.
function targetInjectsCarrier(role, binding, providers) {
  try {
    const family = roleProvider(role, binding.provider);
    if (binding.provider !== providerId(role, family)) return false;
    verifyProvider(providers, binding.provider, () => family);
    return true;
  } catch { return false; }
}

// The request-shape rules — one validator shared by plan() and launchCheck so
// the preflight can never drift from what the planner enforces.
function requestShape(request, role, disposition) {
  if (!roles.includes(role)) throw new Error('Unknown role');
  if (disposition != null && (role !== 'peer' || typeof disposition !== 'string' || !dispositionPattern.test(disposition))) throw new Error('Invalid Peer disposition');
  for (const key of ['workspaceId', 'repository', 'assignment']) {
    if (typeof request[key] !== 'string' || !request[key].trim()) throw new Error(`Missing ${key}`);
  }
  if (!isAbsolute(request.repository)) throw new Error('Absolute repository required');
}

function agentTitle(role, disposition, request, packet) {
  const label = request.taskLabel ?? (basename(request.repository) || 'Task');
  if (typeof label !== 'string' || !label.trim() || label.trim().length > 100 || /[\x00-\x1f\x7f]/.test(label)) {
    throw new Error('taskLabel must be a nonempty single-line string of at most 100 characters');
  }
  const display = value => value[0].toUpperCase() + value.slice(1).toLowerCase();
  return [display(role), ...(role === 'peer' ? [display(disposition ?? 'general')] : []),
    label.trim(), ...(packet ? ['Handoff'] : [])].join(' — ');
}

// One owner for preparation state and validation operations. Diagnostics retain
// their historical inventory-first order and continue after individual failures;
// planning checks request shape first and throws immediately. Nothing is cached
// across calls: launchCheck's final plan must read the live inputs again.
function prepareInputs(request, inspect) {
  const role = request.role ?? 'supervisor';
  const disposition = request.disposition ?? request.route?.disposition;
  let merged = request, file, resolved;
  const operations = {
    request: () => requestShape(request, role, disposition),
    inventoryFile: () => { merged = mergeInventory(request); },
    assignmentFile: () => { file = assignmentFile(merged.assignmentFile); },
    binding: () => {
      const result = resolveBinding(role, merged, disposition);
      roleProvider(role, result.binding?.provider);
      resolved = result;
      return result;
    },
  };
  const order = inspect
    ? ['inventoryFile', 'assignmentFile', 'request', 'binding']
    : ['request', 'inventoryFile', 'assignmentFile', 'binding'];
  for (const name of order) {
    if (inspect) inspect(name, operations[name]);
    else operations[name]();
  }
  return { request: merged, role, disposition, file, ...resolved };
}

// The single owner of the create_agent argument record. Nothing edits it afterwards.
function plan(root, request, packet) {
  verifyInstall(root);
  const prepared = prepareInputs(request);
  const { role, disposition, file, binding, routing } = prepared;
  request = prepared.request;
  const assignment = `Repository: ${request.repository}\nWorkspace ID: ${request.workspaceId}\n${disposition ? `Disposition: ${disposition}\n` : ''}${request.assignment}`
    + (file ? `\nAssignment file: ${file} — read it first; it is authoritative for scope details.` : '');
  // Surface the intended mode once, at plan level: a binding without modeId
  // silently falls back to the caller's default mode at create_agent time.
  const warnings = binding?.modeId == null ? ['no modeId in binding — spawn inherits caller default'] : [];
  const kit = spawnKit(role);
  const manifest = orientation(root, role, routing);
  return {
    transport: 'Paseo create_agent; settings.features must be preserved',
    role, instructionPath: join(root, `src/roles/${role}.md`),
    modeId: binding?.modeId ?? null,
    ...(warnings.length ? { warnings } : {}),
    ...(routing ? { routing } : {}),
    ...(binding?.profileId ? { profileId: binding.profileId } : {}),
    create: {
      title: agentTitle(role, disposition, request, packet),
      notifyOnFinish: true,
      provider: `${binding.provider}/${binding.model}`,
      workspaceId: request.workspaceId,
      initialPrompt: prompt(root, role, assignment, binding)
        + (targetInjectsCarrier(role, binding, request.providers) ? '' : carrierBlock(kit, manifest.policyBytes, planLocatorCaption))
        + (packet ? handoffNotice(role, packet) : ''),
      settings: {
        ...(binding.modeId ? { modeId: binding.modeId } : {}),
        ...(binding.thinkingOptionId ? { thinkingOptionId: binding.thinkingOptionId } : {}),
        features: binding.features ?? {},
      },
    },
    spawnKit: kit,
    orientation: manifest,
    ...(packet ? { handoff: packet, activation: 'Paseo create_agent after current settlement verification; no agent started by this command' } : {}),
  };
}

export const launchPlan = (root, request) => plan(root, request, null);
export const handoffPlan = (root, request) => plan(root, request, handoffPacket(request));

// The provider id the request points at, for the live-verification diagnostic
// when binding resolution already failed — a lookup of the same fields the
// resolvers read, never a second resolution rule.
function providerGuess(role, request) {
  if (typeof request.binding?.provider === 'string') return request.binding.provider;
  if (role === 'peer' || request.route?.optionId != null) {
    try {
      const catalog = readCatalog(request.repository, request.paseoHome);
      const option = catalog.options.find(item => item.id === request.route?.optionId);
      return option ? providerId(role, option.provider) : undefined;
    } catch { return undefined; }
  }
  const id = request.route?.profileId ?? profileId(role);
  return request.profiles?.find(profile => profile.id === id)?.provider;
}

// prepare --check: the same stages plan() runs, in the same order, with each
// failure captured into a named check instead of aborting — one report lists
// every blocker. No second rule set: each step calls the validators the
// planner itself calls, and the final 'plan' step is the planner verbatim.
// Provider live verification is its own check so a complete profile is never
// conflated with a verified provider: 'binding' can fail on a missing profile
// while 'provider' still reports the target's observed state, or the profile
// resolves cleanly while 'provider' refuses configured-only inventory.
export function launchCheck(root, request, { handoff = false } = {}) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, checks: [{ name: 'request', ok: false, error: 'Request must be a JSON object' }] };
  }
  const checks = [];
  const step = (name, fn) => {
    try {
      const detail = fn();
      checks.push(detail === undefined ? { name, ok: true } : { name, ok: true, detail });
      return detail;
    } catch (error) {
      checks.push({ name, ok: false, error: error.message });
      return undefined;
    }
  };
  step('install', () => { verifyInstall(root); });
  const { request: merged, role, binding } = prepareInputs(request, step);
  const provider = binding?.provider ?? providerGuess(role, merged);
  // Live verification is mandatory for profile/catalog resolutions (their
  // resolvers embed verifyProvider); for a pure explicit binding the planner
  // only uses it to dedup the carrier, so an unverified provider is reported
  // as advisory, not a failure — the prompt keeps the fallback block.
  const providerRequired = role === 'peer' || merged.route?.optionId != null || merged.profiles != null;
  if (provider === undefined) {
    checks.push(providerRequired
      ? { name: 'provider', ok: false, error: 'Target provider undetermined — resolve the binding first' }
      : { name: 'provider', ok: true, detail: 'no provider to verify — prompt carrier retained' });
  } else {
    step('provider', () => {
      try {
        verifyProvider(merged.providers, provider, id => roleProvider(role, id));
        return `live-verified: ${provider}`;
      } catch (error) {
        if (!providerRequired) return `not live-verified (${error.message}) — prompt carrier retained`;
        throw error;
      }
    });
  }
  if (binding) step('settings', () => bindingCheck(binding));
  else checks.push({ name: 'settings', ok: true, skipped: true, detail: 'skipped — no resolved binding to check' });
  const warnings = binding && binding.modeId == null ? ['no modeId in binding — spawn inherits caller default'] : [];
  if (handoff) step('handoff', () => { handoffPacket(request); });
  step('plan', () => { (handoff ? handoffPlan : launchPlan)(root, request); });
  return { ok: checks.every(check => check.ok), checks, ...(warnings.length ? { warnings } : {}) };
}

// prepare --schema: the request contract plan() consumes, emitted so Humans
// and tools can author request files without a request file, an installed
// receipt or a daemon. Descriptive only — it validates nothing; --check runs
// the planner's own validators against a real request.
export function requestSchema(handoff = false) {
  const doc = {
    description: 'Request contract for slp.mjs prepare — descriptive only; --check runs the same stages the planner runs',
    base: {
      repository: 'required — absolute path to the work repository',
      workspaceId: 'required — the existing Paseo workspace ID the seat joins',
      assignment: 'required — bounded objective: scope, authority, report-recipient agent ID, verification and handback',
      role: 'supervisor | lead | peer — default supervisor',
      taskLabel: 'optional — at most 100 chars, single line; defaults to the repository directory name',
      assignmentFile: 'optional — absolute path to the per-seat full assignment; referenced read-first, never inlined',
      inventoryFile: 'optional — absolute path to a {providers, profiles} object; inline arrays (even []) take precedence',
      paseoHome: 'optional — absolute daemon home for the user-scope peer pool (slp-runtime/state/peer-pool.json)',
    },
    bindingSources: {
      'saved profiles — supervisor/lead': {
        profiles: 'list_profiles array; the slp-<role> profile must exist with model and settings configured',
        providers: 'live list_providers array from the same daemon — configured-provenance entries are refused',
        'route.profileId': 'optional — defaults to slp-<role>',
      },
      'catalog routing — required for peer': {
        'route.optionId': 'an option id from the routes output',
        'route.catalogSha256': 'the sha256 routes returned — stale or missing fails',
        'route.disposition': 'peer only — the bounded specialism (engineer, architect, reviewer, scout, …)',
        'route.decision': 'Jev receipt from `route-decide` — verified when supplied (shadow mode records jevChoice/declined in the plan), and REQUIRED + binding when the daemon arms jev.capabilities.routing (a bare optionId then fails)',
        providers: 'live list_providers array; the option’s canonical slp-<family>-<role> wrapper must be observed',
      },
      'explicit binding — supervisor/lead': {
        binding: '{ provider, model, modeId?, thinkingOptionId?, features? }; provider is a stock family or the canonical slp-<family>-<role> wrapper',
      },
    },
    notes: [
      'The planner emits a plan only — it never creates agents or mutates host state.',
      'prepare --check <request.json> reports each stage failure; prepare <request.json> --emit create prints only the create_agent argument record.',
      'Peer launches only through the project pool option: an explicit binding is refused, and profiles may accompany the request for discovery but never select the runtime.',
      'Jev routing mode is per-daemon and evaluated at plan time for both prepare and prepare-handoff (they share the plan builder): a route.decision receipt is always verified, is required whenever jev.capabilities.routing is armed, and only then binds route.optionId to the receipt choice — an enabled-but-unarmed daemon verifies and records both picks (shadow evaluation). prepare never calls the network — receipts are produced only by the explicit route-decide helper command.',
    ],
    examples: {
      supervisor: {
        repository: '<absolute path to the repository>',
        workspaceId: '<existing workspace id, e.g. wks-…>',
        role: 'supervisor',
        taskLabel: '<short task label>',
        assignment: '<bounded objective: scope, authority, report-recipient agent ID, verification, handback>',
        profiles: [{ id: 'slp-supervisor', provider: 'slp-codex-supervisor', model: '<model configured in the profile>', modeId: '<configured mode>', featureValues: {} }],
        providers: [{ id: 'slp-codex-supervisor', enabled: true, status: 'available', extends: 'codex' }],
      },
      lead: {
        repository: '<absolute path to the repository>',
        workspaceId: '<existing workspace id, e.g. wks-…>',
        role: 'lead',
        taskLabel: '<short task label>',
        assignment: '<bounded objective: scope, authority, report-recipient agent ID, verification, handback>',
        profiles: [{ id: 'slp-lead', provider: 'slp-codex-lead', model: '<model configured in the profile>', modeId: '<configured mode>', featureValues: {} }],
        providers: [{ id: 'slp-codex-lead', enabled: true, status: 'available', extends: 'codex' }],
      },
      peer: {
        repository: '<absolute path to the repository>',
        workspaceId: '<existing workspace id, e.g. wks-…>',
        role: 'peer',
        disposition: '<engineer | architect | reviewer | scout | …>',
        taskLabel: '<short task label>',
        assignment: '<bounded objective: scope, authority, report-recipient agent ID, verification, handback>',
        providers: [{ id: 'slp-<family>-peer', enabled: true, status: 'available', extends: '<family transport>' }],
        route: { optionId: '<option id from routes output>', catalogSha256: '<sha256 from routes output>' },
      },
    },
  };
  if (!handoff) return doc;
  return {
    ...doc,
    description: 'Request contract for slp.mjs prepare-handoff — the prepare base fields plus old-owner settlement evidence',
    handoff: {
      previousAgentId: 'required — the agent being replaced',
      reason: 'required — why the seat changes hands',
      authority: 'required — who authorized the replacement',
      state: 'required — the old seat’s settlement state',
      previousOwner: { settled: 'required true', evidence: 'required — settlement receipt text; quota failure or idle alone is insufficient' },
      resources: 'required array — remaining Peer IDs, wake owners and unsettled descendants',
    },
  };
}
