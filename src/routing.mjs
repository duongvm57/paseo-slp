import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { hash } from './package.mjs';
import { families, roles, providerId } from './profiles.mjs';
import { settingIdPattern, unsafeModelPattern, rejectRouteKeys, verifyProvider,
  runtimeSettingKeys, profileRouteKeys, swe2ModelPattern } from './binding.mjs';
import { readJevConfig, verifyReceipt } from './jev.mjs';
import { catalogTokenConflicts, seatTokenConflict, ROUTING_VOCABULARY_VERSION } from './routing-vocabulary.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const statuses = ['ready', 'quota-exhausted', 'paused', 'unknown'];
export const emptyCatalog = () => ({ version: 1, policy: 'Human maintains model suitability and quota. Lead chooses within the current assignment budget.', quotaFallback: { enabled: false, optionIds: [] }, options: [] });

export function validateCatalog(catalog) {
  if (!record(catalog) || catalog.version !== 1 || !nonempty(catalog.policy) || !Array.isArray(catalog.options)) throw new Error('Routing catalog requires version=1, policy and options[]');
  const ids = new Set();
  for (const option of catalog.options) {
    if (!record(option) || !nonempty(option.id) || !/^[a-z][a-z0-9-]*$/.test(option.id) || ids.has(option.id)) throw new Error('Invalid or duplicate routing option id');
    // The id collides with the Jev decline sentinel — letting a seat take it
    // would hard-error every route-decide on this pool, so it is refused at
    // the same shape gate as any other invalid id.
    if (option.id === ROUTE_DECLINE_CANDIDATE) throw new Error(`Routing option id "${ROUTE_DECLINE_CANDIDATE}" is reserved for the Jev decline sentinel`);
    ids.add(option.id);
    if (!families.includes(option.provider) && !(option.provider === '' && option.enabled !== true)) throw new Error(`Routing option ${option.id}: provider must be one of ${families.join(', ')}`);
    if (!Array.isArray(option.roles) || !option.roles.length || option.roles.some(role => !roles.includes(role))) throw new Error(`Routing option ${option.id}: invalid roles`);
    if (typeof option.enabled !== 'boolean' || !statuses.includes(option.availability)) throw new Error(`Routing option ${option.id}: explicit enabled and availability required`);
    if (typeof option.model !== 'string' || (option.enabled && !option.model) || unsafeModelPattern.test(option.model)) throw new Error(`Routing option ${option.id}: invalid model`);
    if (option.provider === 'devin' && option.enabled && !swe2ModelPattern.test(option.model)) throw new Error(`Routing option ${option.id}: devin options require a swe-2 model`);
    for (const key of ['thinkingOptionId', 'modeId']) {
      if (option[key] != null && (typeof option[key] !== 'string' || !settingIdPattern.test(option[key]))) throw new Error(`Routing option ${option.id}: invalid ${key}`);
    }
    if (option.features != null && !record(option.features)) throw new Error(`Routing option ${option.id}: invalid features`);
    for (const key of ['suitableFor', 'avoidFor']) {
      if (!Array.isArray(option[key]) || option[key].some(value => !nonempty(value))) throw new Error(`Routing option ${option.id}: ${key} must be a string list`);
    }
    if (!nonempty(option.notes)) throw new Error(`Routing option ${option.id}: suitability notes required`);
  }
  if (catalog.quotaFallback != null) {
    const fallback = catalog.quotaFallback;
    if (!record(fallback) || typeof fallback.enabled !== 'boolean'
        || !Array.isArray(fallback.optionIds)
        || fallback.optionIds.some(id => !ids.has(id))
        || new Set(fallback.optionIds).size !== fallback.optionIds.length
        || Object.keys(fallback).some(key => !['enabled', 'optionIds'].includes(key))) {
      throw new Error('quotaFallback requires enabled and unique optionIds from this pool');
    }
    if (fallback.enabled && fallback.optionIds.length === 0) throw new Error('Enabled quotaFallback needs pool optionIds');
  }
  return catalog;
}

export function routingPath(repository) {
  if (typeof repository !== 'string' || !isAbsolute(repository) || !lstatSync(repository).isDirectory()) throw new Error('Absolute repository directory required');
  return join(realpathSync(repository), '.paseo-slp', 'slp-routing.json');
}

export const paseoHome = () => process.env.PASEO_HOME || join(homedir(), '.paseo');

// Resolution is skill-style: the repository catalog wins when present, otherwise
// the plugin-owned user-scope pool <paseoHome>/slp-runtime/state/peer-pool.json
// is the declared fallback. A malformed or structurally invalid repository file
// is an authoring error, not a fallback trigger; never substitute another
// repository's catalog.
export function readCatalog(repository, home = paseoHome()) {
  if (typeof home !== 'string' || !isAbsolute(home)) throw new Error('Absolute Paseo home required');
  // ENOENT and ENOTDIR both mean "no catalog at this path" — the user-scope
  // path nests two levels (slp-runtime/state), so a regular file squatting on
  // either level surfaces as ENOTDIR; the missing-pool message explains the
  // resolution order better than a bare errno.
  const stat = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; } };
  const repoPath = routingPath(repository);
  const dirStat = stat(join(repoPath, '..'));
  if (dirStat && !dirStat.isDirectory()) throw new Error('Repository .paseo-slp must be a regular directory');
  let path = repoPath, scope = 'repository', fileStat = stat(repoPath);
  if (dirStat == null || fileStat == null) {
    path = join(home, 'slp-runtime', 'state', 'peer-pool.json'); scope = 'user';
    fileStat = stat(path);
    if (fileStat == null) throw new Error(`Missing Peer pool: no repository catalog at ${repoPath} and no user-scope pool at ${path}; author the pool in the SLP Manager surface, or run slp.mjs init <repo> --routing-from <file> --apply for a repository-scoped pool`);
  }
  if (!fileStat.isFile()) throw new Error(`${scope === 'repository' ? 'Repository' : 'User-scope'} Peer pool must be a regular file`);
  const bytes = readFileSync(path, 'utf8');
  const catalog = validateCatalog(JSON.parse(bytes));
  // §7.2 semantic report: an option on a reserved standard-seat id whose
  // tokens diverge from the package set is a Token conflict — reported on
  // every read so the routing/prepare path surfaces it before that seat is
  // used as a standard seat. It is a content error, not a schema rejection:
  // validateCatalog stays shape-only so custom seats keep free strings.
  const tokenConflicts = catalogTokenConflicts(catalog);
  return { ...catalog, path, scope, sha256: hash(bytes), tokenConflicts };
}

// Deterministic eligibility — one predicate, two consumers (view and
// enforcement): catalogBinding refuses on these tokens and jev-routing builds
// its candidate set from the empty-token set. Closed vocabulary, never a
// fused sentence: `disabled`, `availability:<state>`, `role-not-listed`.
export function optionExclusions(option, role) {
  const excluded = [];
  if (!option.enabled) excluded.push('disabled');
  if (option.availability !== 'ready') excluded.push(`availability:${option.availability}`);
  if (!option.roles.includes(role)) excluded.push('role-not-listed');
  return excluded;
}

export const eligibleOptions = (catalog, role) => catalog.options.filter(option => optionExclusions(option, role).length === 0);

// The routing-decision contract shared with jev-routing.mjs: exactly one
// choice question; its answer is an eligible option id or the decline
// sentinel — an explicit "no suitable option" outcome recorded on the receipt.
export const ROUTE_DECISION_QUESTION = 'route_option';
export const ROUTE_DECLINE_CANDIDATE = 'no-suitable-option';

// Lead chooses the option, not an enum/disposition-to-profile mapping.
// Jev routing has two live modes (per-daemon jev.enabled + capabilities.routing):
//   - ARMED (capabilities.routing===true): a route.decision receipt is
//     REQUIRED and binding — route.optionId must equal the receipt choice; a
//     decline receipt fails closed (escalate, do not retry).
//   - SHADOW (enabled but capability not armed): a supplied receipt is still
//     verified for consistency — hash, capability, catalog hash, the exact
//     route_option question set, context.role, candidate membership — but the
//     Lead's route.optionId decides; the plan records BOTH picks (jevChoice,
//     declined) so agreement rate and asymmetric error classes can be measured
//     before the Human arms the capability.
// Verification is offline consistency (internal hash, catalog hash, candidate
// membership) — consistency, not cryptographic authenticity.
export function catalogBinding(repository, role, providers, route, home) {
  if (Object.hasOwn(route, 'catalogFile')) throw new Error('Routing is repository-scoped; use repository/.paseo-slp/slp-routing.json, not route.catalogFile');
  const catalog = readCatalog(repository, home);
  if (route.catalogSha256 !== catalog.sha256) throw new Error('Routing catalog changed or hash missing; read routes again before selecting');
  const decision = route.decision;
  const jevConfig = readJevConfig(home ?? paseoHome());
  const jevMode = jevConfig !== null && jevConfig.enabled === true && jevConfig.capabilities.routing === true;
  let jevChoice;
  let jevDeclined = false;
  if (decision != null) {
    verifyReceipt(decision);
    if (decision.context?.capability !== 'routing') throw new Error('Jev decision receipt is not a routing decision');
    if (decision.context.catalogSha256 !== catalog.sha256) throw new Error('Jev decision receipt was issued against a different catalog — run route-decide again');
    // The receipt is bound to the vocabulary version it was issued under —
    // a semantic change to the token set ships as a new version, and a stale
    // receipt must not route under a different meaning (§7.2, §9).
    if (decision.context.vocabularyVersion !== ROUTING_VOCABULARY_VERSION) {
      throw new Error(`Jev decision receipt was issued under vocabulary ${decision.context.vocabularyVersion ?? 'none'} — the package now speaks ${ROUTING_VOCABULARY_VERSION}; run route-decide again`);
    }
    const questionNames = Object.keys(decision.questions);
    if (questionNames.length !== 1 || questionNames[0] !== ROUTE_DECISION_QUESTION) {
      throw new Error(`Jev routing decision receipt must carry exactly the ${ROUTE_DECISION_QUESTION} question`);
    }
    if (decision.context.role !== role) throw new Error(`Jev decision receipt was issued for a different role — run route-decide for ${role}`);
    // A disabled config carries no provider — there is no configured model to
    // compare the receipt against, so that check applies only while Jev is on.
    if (jevConfig?.provider != null && decision.model !== jevConfig.provider.model) {
      throw new Error('Jev decision receipt was issued by a different model than the configured provider — run route-decide again');
    }
    jevChoice = decision.answers[ROUTE_DECISION_QUESTION]?.choice;
    if (typeof jevChoice !== 'string') throw new Error(`Jev decision receipt lacks a ${ROUTE_DECISION_QUESTION} choice answer`);
    jevDeclined = jevChoice === ROUTE_DECLINE_CANDIDATE;
    if (jevDeclined && jevMode) throw new Error('Jev declined to route: the receipt records "no suitable option" — the pool is Human-owned, escalate rather than retry');
  } else if (jevMode) {
    throw new Error('Jev routing mode is on for this daemon: prepare requires a route.decision receipt — run slp route-decide to obtain one (the Human can disable Jev routing to restore Lead judgment)');
  }
  const option = catalog.options.find(item => item.id === route.optionId);
  if (!option) throw new Error(`Unknown routing option ${route.optionId}`);
  // A conflicted seat is neither a valid standard seat nor a valid custom one
  // (the reserved-name registry refuses custom ids on it) — refuse it here
  // rather than routing on divergent tokens while the reader believes it is
  // the standard set (§7.2).
  if (seatTokenConflict(option)) {
    throw new Error(`Routing option ${option.id} is a Token conflict — it carries the reserved standard-seat id but its suitability tokens differ from the package set. Resolve it in the SLP Manager surface (use the standard set or convert the seat to a custom id) before routing.`);
  }
  const excluded = optionExclusions(option, role);
  if (excluded.length) throw new Error(`Routing option ${option.id} excluded for ${role}: ${excluded.join(', ')}`);
  if (decision != null) {
    if (!Array.isArray(decision.context.candidates) || !decision.context.candidates.includes(option.id)) {
      throw new Error(`Routing option ${option.id} was not a Jev candidate in the receipt — run route-decide again`);
    }
    if (jevMode && jevChoice !== option.id) throw new Error(`route.optionId ${route.optionId} does not match the Jev receipt choice ${jevChoice}`);
  }
  rejectRouteKeys(route, [...profileRouteKeys, ...runtimeSettingKeys],
    key => `Routing option settings are complete; conflicting route.${key}`);
  if (Object.hasOwn(route, 'quotaFallbackFrom')) {
    const from = catalog.options.find(item => item.id === route.quotaFallbackFrom);
    if (!from || from.id === option.id || !from.roles.includes(role)) throw new Error('Quota fallback requires a different source option for this role');
    if (catalog.quotaFallback?.enabled !== true || !catalog.quotaFallback.optionIds.includes(option.id)) {
      throw new Error('Quota fallback is disabled or target option is not authorized');
    }
  }
  const provider = providerId(role, option.provider);
  verifyProvider(providers, provider, () => option.provider, provider);
  const jev = { required: jevMode, decision: decision != null ? 'verified' : 'none' };
  if (decision != null) Object.assign(jev, { jevChoice, declined: jevDeclined });
  return {
    binding: { provider, model: option.model, modeId: option.modeId, thinkingOptionId: option.thinkingOptionId, features: structuredClone(option.features ?? {}) },
    routing: { catalogFile: catalog.path, catalogScope: catalog.scope, catalogSha256: catalog.sha256, optionId: option.id, jev, ...(route.quotaFallbackFrom ? { quotaFallbackFrom: route.quotaFallbackFrom } : {}) },
  };
}
