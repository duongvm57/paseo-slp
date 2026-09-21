// src/jev-routing.mjs — first Jev consumer: seat-selection routing decisions.
//
// Jev runs ONLY through the explicit `route-decide` helper command — never in
// a background loop, a schedule, or inside prepare (prepare stays offline and
// merely verifies the receipt this module's output carries).
//
// Deterministic eligibility (optionExclusions, shared with catalogBinding)
// runs BEFORE any model call: Jev may only pick inside the eligible candidate
// set plus the explicit no-suitable-option sentinel. The state sent to Jev is
// the Lead-authored routing brief plus a bounded option surface — never raw
// assignmentFile bytes (the package passes assignments by pointer; shipping
// their bytes to a SaaS self-contradicts), and never catalog `notes` (they
// are Vietnamese; Jev is English-primary). The brief is the entire evidence
// surface — starve it and answers drift toward chance.
//
// Brief guidance (procedural, not a hard schema): a useful brief carries the
// task description, risk/effort signals, constraints and dependencies — the
// same evidence a Lead would weigh. `brief: "x"` validates but starves the
// model, which is exactly the failure mode shadow evaluation exists to
// measure before the capability may be armed.

import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readCatalog, optionExclusions, eligibleOptions, paseoHome,
  ROUTE_DECISION_QUESTION, ROUTE_DECLINE_CANDIDATE } from './routing.mjs';
import { resolveJev, askJev, JevError } from './jev.mjs';
import { roles } from './profiles.mjs';
import { JEV_SUITABILITY_GUIDANCE, JEV_TOKEN_DEFINITIONS, ROUTING_VOCABULARY_VERSION,
  seatTokenConflict } from './routing-vocabulary.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const jevError = (code, message, details) => new JevError(code, message, details);

const describeOption = option =>
  `${option.provider} ${option.model}; thinking: ${option.thinkingOptionId ?? 'provider default'}; suitable for: ${option.suitableFor.join(', ') || 'unspecified'}; avoid for: ${option.avoidFor.join(', ') || 'none'}`;

// route-decide <request.json>: { repository, role? (default peer), brief,
// paseoHome? }. `brief` is the Lead-authored routing brief — a nonempty string
// or object; it is the only task context Jev sees (carry task description,
// risk/effort signals, constraints, dependencies — see module header). Returns
// { schemaVersion, optionId, catalogSha256, declined, role, decision } where
// `decision` is the Jev receipt prepare later verifies offline.
//
// Mode: resolveJev gates on `enabled` alone with allowShadow — an enabled
// daemon whose routing capability is not yet armed runs shadow evaluation
// (receipt emitted, context.armed=false, Lead still chooses; prepare records
// both picks). Armed requires capabilities.routing=true and makes the receipt
// binding at plan time.
export async function routeDecide(request, { home, fetchImpl, now } = {}) {
  if (!record(request)) throw jevError('jev-request-invalid', 'route-decide request must be a JSON object');
  const repository = request.repository;
  let repoStat;
  try {
    repoStat = typeof repository === 'string' && isAbsolute(repository) ? lstatSync(repository) : null;
  } catch {
    repoStat = null;
  }
  if (!repoStat?.isDirectory()) {
    throw jevError('jev-request-invalid', 'route-decide requires an absolute repository directory');
  }
  const role = request.role ?? 'peer';
  if (!roles.includes(role)) throw jevError('jev-request-invalid', `route-decide role must be one of ${roles.join(', ')}`);
  const brief = request.brief;
  const briefOk = (typeof brief === 'string' && brief.trim().length > 0) || (record(brief) && Object.keys(brief).length > 0) || (Array.isArray(brief) && brief.length > 0);
  if (!briefOk) throw jevError('jev-request-invalid', 'route-decide requires brief — a nonempty Lead-authored routing brief (never assignmentFile bytes)');

  const daemonHome = home ?? request.paseoHome ?? paseoHome();
  const { provider, key, armed } = resolveJev(daemonHome, 'routing', { allowShadow: true });
  const catalog = readCatalog(repository, daemonHome);

  const eligible = eligibleOptions(catalog, role);
  if (eligible.length === 0) {
    const reasons = catalog.options
      .map(option => `${option.id}: ${optionExclusions(option, role).join(', ') || 'eligible'}`)
      .join('; ');
    throw jevError('jev-no-candidates', `No eligible routing options for ${role} — every catalog option is excluded (${reasons})`);
  }
  if (eligible.some(option => option.id === ROUTE_DECLINE_CANDIDATE)) {
    throw jevError('jev-request-invalid', `Catalog option id "${ROUTE_DECLINE_CANDIDATE}" collides with the Jev decline sentinel`);
  }
  // A seat under a reserved standard id whose tokens diverge from the package
  // set is in Token conflict — it is neither a valid standard seat nor a
  // valid custom one, so it cannot be a candidate; it is reported here and
  // refused again at prepare (catalogBinding) if picked anyway.
  const conflicted = eligible.filter(option => seatTokenConflict(option));
  const usable = eligible.filter(option => !seatTokenConflict(option));
  if (usable.length === 0) {
    throw jevError('jev-no-candidates', `No eligible routing options for ${role} — every eligible option is in Token conflict (${conflicted.map(option => option.id).join(', ')}); resolve the conflicts in the SLP Manager surface`);
  }
  const candidates = usable.map(option => option.id);
  const state = {
    task: brief,
    role,
    // §1/§9 — bare tokens carry no meaning to a reader who never saw the
    // table: the state ships each standard token's packaged sign/boundary
    // under the vocabulary version the receipt binds.
    vocabulary: { version: ROUTING_VOCABULARY_VERSION, tokens: JEV_TOKEN_DEFINITIONS },
    // The option surface is fixed-shape — thinkingOptionId ships as explicit
    // null when absent so Jev never guesses whether the key was dropped; null
    // means the provider has no separate thinking knob (baked into the model).
    options: usable.map(option => ({
      id: option.id, provider: option.provider, model: option.model,
      thinkingOptionId: option.thinkingOptionId ?? null,
      suitableFor: option.suitableFor, avoidFor: option.avoidFor,
    })),
  };
  const questions = {
    [ROUTE_DECISION_QUESTION]: {
      type: 'choice',
      instructions: `Choose exactly one criteria key as the seat for this task. Judge the task brief against each option's provider, model, thinking option and suitability fields. ${JEV_SUITABILITY_GUIDANCE} Answer no-suitable-option when none of the listed options fits.`,
      criteria: {
        ...Object.fromEntries(usable.map(option => [option.id, describeOption(option)])),
        [ROUTE_DECLINE_CANDIDATE]: 'None of the listed options is a suitable seat for this task — decline rather than guess',
      },
    },
  };
  const context = {
    capability: 'routing', role, armed,
    catalogSha256: catalog.sha256,
    candidates,
    declineCandidate: ROUTE_DECLINE_CANDIDATE,
    vocabularyVersion: ROUTING_VOCABULARY_VERSION,
    // §7.2 — the read path reports every Token conflict in the catalog, not
    // just the ones that survived eligibility: a disabled-but-conflicted
    // seat still misleads anyone reading the pool as a standard seat.
    tokenConflicts: (catalog.tokenConflicts ?? []).map(conflict => conflict.id),
  };
  const { answers, receipt } = await askJev({ provider, key, state, questions, context }, { fetchImpl, now });
  const choice = answers[ROUTE_DECISION_QUESTION].choice;
  const declined = choice === ROUTE_DECLINE_CANDIDATE;
  return {
    schemaVersion: 1,
    optionId: declined ? null : choice,
    catalogSha256: catalog.sha256,
    declined,
    role,
    tokenConflicts: (catalog.tokenConflicts ?? []).map(conflict => conflict.id),
    decision: receipt,
  };
}
