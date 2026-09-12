import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identity, files, hash, json, readJson, snapshot } from '../src/package.mjs';
import { scenarios } from './scenarios.mjs';
import { evidenceKinds, evidenceVersion, within, acceptEvidence, satisfiesEvidence } from './evidence.mjs';
import { criterionIds, criterionEvidence } from './criteria.mjs';
import { savedProfileBinding, roles, providerId } from '../src/profiles.mjs';
import { bindingCheck } from '../src/binding.mjs';
import { createFixture } from './fixture.mjs';

export const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const put = (path, data) => writeFileSync(path, json(data), { flag: 'wx' });
const now = () => new Date().toISOString();
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
function harnessIdentity(root) {
  const entries = [...files(root, 'e2e'), 'docs/review-checklist.md', 'docs/contract.md', 'AGENTS.md']
    .sort().map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  return { sha256: hash(json(entries)), files: entries };
}
export function initialize(directory, root = sourceRoot) {
  const candidate = identity(root), harness = harnessIdentity(root);
  directory = resolve(directory);
  mkdirSync(dirname(directory), { recursive: true });
  mkdirSync(directory); // Exclusive; never reset a previous run.
  mkdirSync(join(directory, 'frozen'));
  const frozen = { scenarios, criteria: criterionIds, criterionEvidence, evidenceKinds, evidenceVersion, candidate, harness };
  put(join(directory, 'frozen', 'manifest.json'), frozen);
  for (const name of ['review-checklist.md', 'contract.md']) {
    writeFileSync(join(directory, 'frozen', name), readFileSync(join(root, 'docs', name)), { flag: 'wx' });
  }
  put(join(directory, 'run.json'), {
    version: 1, createdAt: now(), sourceRoot: realpathSync(root),
    manifestSha256: hash(readFileSync(join(directory, 'frozen', 'manifest.json'))),
    checklistSha256: hash(readFileSync(join(directory, 'frozen', 'review-checklist.md'))),
    contractSha256: hash(readFileSync(join(directory, 'frozen', 'contract.md'))),
  });
  return { directory, ...summary(directory) };
}
function loadRun(directory, current = false) {
  directory = realpathSync(directory);
  const run = readJson(join(directory, 'run.json'));
  for (const [name, digest] of [['manifest.json', run.manifestSha256], ['review-checklist.md', run.checklistSha256], ['contract.md', run.contractSha256]]) {
    requireValue(hash(readFileSync(join(directory, 'frozen', name))) === digest, `Frozen ${name} changed`);
  }
  const frozen = readJson(join(directory, 'frozen', 'manifest.json'));
  if (current) {
    requireValue(identity(run.sourceRoot).sha256 === frozen.candidate.sha256, 'Package candidate changed; initialize a new run');
    requireValue(harnessIdentity(run.sourceRoot).sha256 === frozen.harness.sha256, 'Harness changed; initialize a new run');
  }
  return { directory, run, frozen };
}
function getScenario(directory, id, current = false) {
  const loaded = loadRun(directory, current);
  const scenario = loaded.frozen.scenarios.find(item => item.id === id);
  requireValue(scenario, 'Unknown scenario');
  return { ...loaded, scenario };
}
export function begin(directory, id, config) {
  const loaded = getScenario(directory, id, true);
  if (loaded.scenario.dependsOn.length) {
    const rows = summary(directory).scenarios;
    for (const dependency of loaded.scenario.dependsOn) {
      requireValue(rows.find(row => row.id === dependency)?.status === 'PASS', `Unmet scenario gate: ${dependency}`);
    }
  }
  requireValue(nonempty(config.operatorId), 'operatorId required');
  requireValue(nonempty(config.authority?.source), 'Current assignment authority source required');
  for (const key of ['maxAgents', 'maxWallTimeSeconds']) {
    requireValue(Number.isInteger(config.budget?.[key]) && config.budget[key] > 0, `Positive budget.${key} required`);
  }
  requireValue(nonempty(config.host?.id) && nonempty(config.host?.version), 'Pinned host id/version required');
  requireValue(config.settings && typeof config.settings === 'object', 'Discovered settings required');
  requireValue(nonempty(config.confirmer?.id) && config.confirmer.id !== config.operatorId && nonempty(config.confirmer?.evidence), 'Independent prelaunch confirmer and evidence required');
  if (loaded.scenario.runtimeSource === 'profiles') {
    requireValue(config.settings.source === 'profiles', 'Basic E2E requires Human-configured agent profiles; catalog or inline settings cannot substitute');
    const bindings = Object.fromEntries(roles.map(role => {
      const binding = savedProfileBinding(role, config.settings.profiles, config.settings.providers);
      requireValue(binding.provider === providerId(role, loaded.scenario.providerFamily),
        `Human must configure ${binding.profileId} with ${providerId(role, loaded.scenario.providerFamily)} for ${id}; observed ${binding.provider}`);
      bindingCheck(binding);
      return [role, binding];
    }));
    config = { ...config, settings: { ...config.settings, roles: bindings } };
  }
  const parent = join(loaded.directory, id);
  mkdirSync(parent, { recursive: true });
  const existing = readdirSync(parent).filter(name => /^attempt-\d+$/.test(name));
  // One coordinator writes the ledger. Never resume a live attempt by spawning again.
  for (const name of existing) requireValue(existsSync(join(parent, name, 'review.json')), `Unreviewed attempt ${name}; resume it first`);
  const attempt = join(parent, `attempt-${String(existing.length + 1).padStart(3, '0')}`);
  mkdirSync(attempt);
  mkdirSync(join(attempt, 'evidence'));
  put(join(attempt, 'attempt.json'), { version: 1, scenarioId: id, createdAt: now(), runManifestSha256: loaded.run.manifestSha256, config });
  return { attempt, scenario: loaded.scenario };
}
function loadAttempt(attempt, current = false) {
  attempt = realpathSync(attempt);
  const data = readJson(join(attempt, 'attempt.json'));
  const loaded = getScenario(dirname(dirname(attempt)), data.scenarioId, current);
  requireValue(basename(dirname(attempt)) === data.scenarioId && /^attempt-\d+$/.test(basename(attempt)), 'Attempt location mismatch');
  requireValue(data.runManifestSha256 === loaded.run.manifestSha256, 'Attempt manifest mismatch');
  return { ...loaded, attempt, data };
}
export function fixture(attempt) {
  const loaded = loadAttempt(attempt, true);
  requireValue(!existsSync(join(attempt, 'report.json')), 'Attempt sealed');
  return createFixture(join(loaded.attempt, 'workspace'), loaded.scenario.fixture);
}
export function collect(attempt, kind, path) {
  const loaded = loadAttempt(attempt);
  requireValue(loaded.frozen.evidenceKinds.includes(kind), 'Unknown evidence kind');
  requireValue(!existsSync(join(loaded.attempt, 'report.json')), 'Attempt sealed');
  // Raw capture: an invalid payload stays visible in the ledger. seal() is the gate.
  return storeEvidence(loaded, kind, path, readFileSync(path));
}
export function collectCoordinator(attempt, path, sessionId) {
  const loaded = loadAttempt(attempt);
  requireValue(!existsSync(join(loaded.attempt, 'report.json')), 'Attempt sealed');
  requireValue(nonempty(sessionId), 'Coordinator native sessionId required');
  const source = realpathSync(path);
  requireValue(!within(loaded.directory, source), 'Coordinator transcript source must be outside the E2E run directory');
  requireValue(basename(source).includes(sessionId), 'Coordinator transcript filename must bind the native sessionId');
  const transcript = readFileSync(source, 'utf8');
  const bytes = Buffer.from(json({ operatorId: loaded.data.config.operatorId, sessionId, source,
    transcript, transcriptSha256: hash(Buffer.from(transcript)) }));
  acceptEvidence('coordinator', bytes, evidenceContext(loaded));
  return storeEvidence(loaded, 'coordinator', source, bytes);
}
export function collectResources(attempt, path) {
  const loaded = loadAttempt(attempt);
  requireValue(!existsSync(join(loaded.attempt, 'report.json')), 'Attempt sealed');
  const bytes = readFileSync(path);
  acceptEvidence('resources', bytes, evidenceContext(loaded));
  return storeEvidence(loaded, 'resources', path, bytes);
}
function storeEvidence(loaded, kind, path, bytes) {
  const records = readdirSync(join(loaded.attempt, 'evidence'));
  const name = `${String(records.length + 1).padStart(4, '0')}-${kind}.json`;
  const record = { kind, capturedAt: now(), source: resolve(path), sha256: hash(bytes), encoding: 'base64', bytes: bytes.toString('base64') };
  put(join(loaded.attempt, 'evidence', name), record);
  return { path: `evidence/${name}`, kind, sha256: hash(json(record)), payloadSha256: record.sha256 };
}
function evidenceIndex(attempt) {
  return files(attempt, 'evidence').map(path => {
    const bytes = readFileSync(join(attempt, path));
    const record = JSON.parse(bytes);
    requireValue(hash(Buffer.from(record.bytes, 'base64')) === record.sha256, `Evidence payload changed: ${path}`);
    return { path, kind: record.kind, sha256: hash(bytes) };
  });
}
const evidenceContext = loaded => ({ operatorId: loaded.data.config.operatorId, runDirectory: loaded.directory });
function missingEvidence(loaded, evidence) {
  const context = evidenceContext(loaded);
  return loaded.frozen.evidenceKinds.filter(kind => !evidence.some(item => {
    if (item.kind !== kind) return false;
    const record = readJson(join(loaded.attempt, item.path));
    return satisfiesEvidence(kind, Buffer.from(record.bytes, 'base64'), context);
  }));
}
export function seal(attempt, { gaps = [] } = {}) {
  const loaded = loadAttempt(attempt);
  const evidence = evidenceIndex(loaded.attempt);
  requireValue(evidence.length > 0, 'No collected evidence; collect actual receipts before sealing');
  const missing = missingEvidence(loaded, evidence);
  requireValue(Array.isArray(gaps) && gaps.every(gap => nonempty(gap?.kind) && nonempty(gap?.reason)), 'Evidence gaps require kind and concrete reason');
  requireValue(new Set(gaps.map(gap => gap.kind)).size === gaps.length, 'Duplicate evidence gap');
  requireValue(gaps.every(gap => missing.includes(gap.kind)), 'Evidence gaps must name missing required evidence');
  const undeclared = missing.filter(kind => !gaps.some(gap => gap.kind === kind));
  requireValue(undeclared.length === 0, `Missing required evidence: ${undeclared.join(', ')}; collect it before sealing, or declare unavailable proof with explicit gaps`);
  const report = {
    version: 1, scenarioId: loaded.scenario.id, sealedAt: now(),
    attemptSha256: hash(readFileSync(join(loaded.attempt, 'attempt.json'))),
    manifestSha256: loaded.run.manifestSha256,
    packageSha256: loaded.frozen.candidate.sha256, harnessSha256: loaded.frozen.harness.sha256,
    sourceUnchanged: identity(loaded.run.sourceRoot).sha256 === loaded.frozen.candidate.sha256
      && harnessIdentity(loaded.run.sourceRoot).sha256 === loaded.frozen.harness.sha256,
    evidence, evidenceGaps: gaps,
    taskSnapshot: existsSync(join(loaded.attempt, 'workspace')) ? snapshot(join(loaded.attempt, 'workspace')) : null,
    review: 'NOT_RUN',
  };
  const reportBytes = Buffer.from(json(report));
  writeFileSync(join(loaded.attempt, 'report.json'), reportBytes, { flag: 'wx' });
  // Keep the seal outside the report so report edits cannot be mistaken for a
  // new frozen candidate during a later review or summary.
  writeFileSync(join(loaded.attempt, 'report.sha256'), `${hash(reportBytes)}\n`, { flag: 'wx' });
  return { report: join(loaded.attempt, 'report.json'), reportSha256: hash(reportBytes) };
}
function verifiedReport(attempt) {
  const loaded = loadAttempt(attempt);
  const reportPath = join(loaded.attempt, 'report.json');
  const bytes = readFileSync(reportPath);
  const report = JSON.parse(bytes);
  requireValue(readFileSync(join(loaded.attempt, 'report.sha256'), 'utf8').trim() === hash(bytes), 'Sealed report changed');
  requireValue(report.scenarioId === loaded.scenario.id, 'Report scenario mismatch');
  requireValue(report.attemptSha256 === hash(readFileSync(join(loaded.attempt, 'attempt.json'))), 'Attempt configuration changed after sealing');
  requireValue(report.manifestSha256 === loaded.run.manifestSha256 && report.packageSha256 === loaded.frozen.candidate.sha256 && report.harnessSha256 === loaded.frozen.harness.sha256, 'Report identity mismatch');
  requireValue(json(report.evidence) === json(evidenceIndex(loaded.attempt)), 'Sealed evidence changed');
  return { ...loaded, report, reportSha256: hash(bytes) };
}
function validateReview(attempt, input) {
  const loaded = verifiedReport(attempt);
  const participantIds = input.participantIds;
  requireValue(Array.isArray(participantIds) && participantIds.every(nonempty) && participantIds.length > 0, 'Host actor participantIds required (include all scenario actors)');
  requireValue(nonempty(input.reviewerId) && input.reviewerId !== loaded.data.config.operatorId && !participantIds.includes(input.reviewerId), 'Reviewer must be independent of operator and actors');
  requireValue(input.reportSha256 === loaded.reportSha256, 'Review must reference frozen report hash');
  requireValue(nonempty(input.independenceEvidence), 'Reviewer host session/neutral brief evidence required');
  requireValue(json(Object.keys(input.criteria ?? {}).sort()) === json([...loaded.frozen.criteria].sort()), 'Review exactly U1–U7');
  const paths = new Set(loaded.report.evidence.map(item => item.path));
  const kindOfPath = new Map(loaded.report.evidence.map(item => [item.path, item.kind]));
  // A criterion cannot be asked for evidence the seal already recorded as unavailable.
  const declaredGaps = new Set((loaded.report.evidenceGaps ?? []).map(gap => gap.kind));
  const check = (item, label, supportKinds) => {
    const support = (supportKinds ?? []).filter(kind => !declaredGaps.has(kind));
    requireValue(item && ['PASS', 'FAIL', 'BLOCKED'].includes(item.status) && nonempty(item.reason), `${label}: status/reason required`);
    requireValue(Array.isArray(item.evidence) && item.evidence.every(path => paths.has(path)), `${label}: invalid evidence reference`);
    requireValue(item.status === 'BLOCKED' || item.evidence.length > 0, `${label}: observed verdict needs evidence`);
    if (support?.length && item.status !== 'BLOCKED') {
      requireValue(item.evidence.some(path => support.includes(kindOfPath.get(path))),
        `${label}: observed verdict needs ${support.join(' or ')} evidence`);
    }
  };
  for (const criterion of loaded.frozen.criteria) check(input.criteria?.[criterion], criterion, loaded.frozen.criterionEvidence?.[criterion]);
  requireValue(Array.isArray(input.assertions) && input.assertions.length === loaded.scenario.assertions.length, 'Review every scenario assertion in manifest order');
  input.assertions.forEach((item, i) => check(item, `Assertion ${i + 1}`));
  const checks = [...Object.values(input.criteria), ...input.assertions];
  let status = checks.some(item => item.status === 'FAIL') ? 'FAIL' : checks.some(item => item.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  if (status === 'PASS') {
    requireValue(loaded.report.sourceUnchanged, 'PASS requires unchanged package and harness during the attempt');
    requireValue(!loaded.report.evidenceGaps?.length, 'PASS forbidden with declared evidence gaps');
    requireValue(missingEvidence(loaded, loaded.report.evidence).length === 0, 'PASS requires nonempty payloads for all required evidence kinds');
    for (const kind of loaded.frozen.evidenceKinds) requireValue(loaded.report.evidence.some(item => item.kind === kind), `PASS missing ${kind} evidence`);
  }
  return { ...input, status };
}
export function review(attempt, input) {
  const result = { ...validateReview(attempt, input), reviewedAt: now() };
  put(join(attempt, 'review.json'), result);
  return result;
}
export function reviewAddendum(attempt, input) {
  const loaded = verifiedReport(attempt);
  const originalPath = join(attempt, 'review.json');
  requireValue(existsSync(originalPath), 'Review addendum requires an original review');
  const originalBytes = readFileSync(originalPath);
  const original = readJson(originalPath);
  const originalValidated = validateReview(attempt, original);
  requireValue(original.status === originalValidated.status, 'Original review status inconsistent with criteria/assertions');
  requireValue(input.supersedesReviewSha256 === hash(originalBytes), 'Addendum must bind the original review hash');
  requireValue(nonempty(input.basis), 'Review addendum basis required');
  requireValue(input.reviewerId === original.reviewerId, 'Review addendum must keep the original reviewer');
  const result = { ...validateReview(attempt, input), reviewedAt: now(),
    supersedesReviewSha256: input.supersedesReviewSha256, basis: input.basis };
  const existing = namesForReviewAddenda(attempt);
  const next = Math.max(0, ...existing.map(name => Number(name.match(/(\d+)/)?.[1] ?? 0))) + 1;
  const path = join(attempt, `review-addendum-${String(next).padStart(3, '0')}.json`);
  put(path, result);
  return { ...result, path };
}
export function defer(directory, id, input) {
  const loaded = getScenario(directory, id);
  requireValue(['BLOCKED', 'NOT_RUN'].includes(input.status) && nonempty(input.reason), 'Deferral status/reason required');
  requireValue(Array.isArray(input.missing) && input.missing.every(nonempty), 'List missing capabilities/authority/budget in missing');
  const parent = join(loaded.directory, id);
  mkdirSync(parent, { recursive: true });
  const count = readdirSync(parent).filter(name => /^deferred-\d+\.json$/.test(name)).length;
  const path = join(parent, `deferred-${String(count + 1).padStart(3, '0')}.json`);
  put(path, { ...input, recordedAt: now() });
  return { path };
}
export function summary(directory) {
  const loaded = loadRun(directory);
  const rows = loaded.frozen.scenarios.map(scenario => {
    const parent = join(loaded.directory, scenario.id);
    const names = existsSync(parent) ? readdirSync(parent).sort() : [];
    const attempts = names.filter(name => /^attempt-\d+$/.test(name)).map(name => {
      const path = join(parent, name);
      let status = 'NOT_RUN', reason = 'Attempt needs evidence seal and independent review';
      if (existsSync(join(path, 'report.json'))) verifiedReport(path);
      const addenda = namesForReviewAddenda(path);
      requireValue(!addenda.length || existsSync(join(path, 'review.json')), 'Review addendum requires an original review');
      if (existsSync(join(path, 'review.json'))) {
        const original = readJson(join(path, 'review.json'));
        const originalBytes = readFileSync(join(path, 'review.json'));
        const originalValidated = validateReview(path, original);
        requireValue(original.status === originalValidated.status, 'Original review status inconsistent with criteria/assertions');
        const reviews = [originalValidated];
        const originalHash = hash(originalBytes);
        for (const addendum of addenda) {
          const value = readJson(join(path, addendum));
          requireValue(value.supersedesReviewSha256 === originalHash, `Review addendum binding changed: ${addendum}`);
          requireValue(nonempty(value.basis), `Review addendum basis missing: ${addendum}`);
          requireValue(value.reviewerId === original.reviewerId, `Review addendum reviewer changed: ${addendum}`);
          const validated = validateReview(path, value);
          requireValue(value.status === validated.status, `Review addendum status inconsistent: ${addendum}`);
          reviews.push(validated);
        }
        const verdict = reviews.at(-1);
        status = verdict.status; reason = 'Independent review recorded';
      }
      return { attempt: name, status, reason, path };
    });
    const deferredNames = names.filter(name => /^deferred-\d+\.json$/.test(name));
    const deferrals = deferredNames.map(name => readJson(join(parent, name)));
    const passCount = attempts.filter(item => item.status === 'PASS').length;
    // A failure remains visible for this candidate. Retries never erase it.
    let status = attempts.some(item => item.status === 'FAIL') ? 'FAIL'
      : attempts.some(item => item.status === 'NOT_RUN') ? 'NOT_RUN'
      : passCount >= scenario.repetitions ? 'PASS'
      : attempts.some(item => item.status === 'BLOCKED') || deferrals.at(-1)?.status === 'BLOCKED' ? 'BLOCKED' : 'NOT_RUN';
    return { id: scenario.id, group: scenario.group, status, repetitions: scenario.repetitions, passCount, attempts, deferrals };
  });
  const counts = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].map(status => [status, rows.filter(row => row.status === status).length]));
  const status = counts.FAIL ? 'FAIL' : counts.BLOCKED ? 'BLOCKED' : counts.NOT_RUN ? 'NOT_RUN' : 'PASS';
  return { status, packageSha256: loaded.frozen.candidate.sha256, harnessSha256: loaded.frozen.harness.sha256, counts, scenarios: rows };
}

function namesForReviewAddenda(attempt) {
  return readdirSync(attempt).filter(name => /^review-addendum-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
}
