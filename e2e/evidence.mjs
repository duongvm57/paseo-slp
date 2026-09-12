import { basename, relative, resolve, isAbsolute } from 'node:path';
import { hash } from '../src/package.mjs';

// One contract per evidence kind. The ledger keeps a registry; it does not know
// what a Paseo coordinator transcript or a host resource inventory looks like.
// Bumped whenever any validator below changes meaning.
export const evidenceVersion = 3;

const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function within(parent, path) {
  const value = relative(parent, path);
  return value === '' || (!value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && value !== '..' && !isAbsolute(value));
}

function containsValue(value, expected) {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some(item => containsValue(item, expected));
  return value !== null && typeof value === 'object'
    && Object.values(value).some(item => containsValue(item, expected));
}

function validCoordinatorTranscript(bytes, { operatorId, runDirectory } = {}) {
  const payload = JSON.parse(bytes);
  if (payload?.operatorId !== operatorId || !nonempty(payload?.sessionId)
      || !nonempty(payload?.source) || !nonempty(payload?.transcript)) return false;
  if (runDirectory && within(runDirectory, resolve(payload.source))) return false;
  if (!basename(payload.source).includes(payload.sessionId)) return false;
  if (hash(Buffer.from(payload.transcript)) !== payload.transcriptSha256) return false;
  const records = payload.transcript.trim().split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  return records.length > 0
    && records.every(record => record !== null && typeof record === 'object' && !Array.isArray(record))
    && records.some(record => containsValue(record, payload.sessionId));
}

function resourceSettlementShape(bytes) {
  const payload = JSON.parse(bytes);
  return payload?.version === 1 && nonempty(payload?.capturedAt)
    && payload.workspace !== null && typeof payload.workspace === 'object' && nonempty(payload.workspace.status)
    && Array.isArray(payload.taskActors)
    && payload.settlement !== null && typeof payload.settlement === 'object'
    && nonempty(payload.settlement.observed)
    && Array.isArray(payload.settlement.actions)
    && Array.isArray(payload.settlement.unresolved);
}

function settledResources(bytes) {
  if (!resourceSettlementShape(bytes)) return false;
  const payload = JSON.parse(bytes);
  if (payload.settlement.unresolved.length > 0) return false;
  if (payload.taskActors.length === 0) {
    return payload.settlement.noActorsCreated === true && nonempty(payload.settlement.noActorsReason);
  }
  // A live-sounding label is not a terminal state, whatever the actor reports.
  return payload.taskActors.every(actor => nonempty(actor?.id) && nonempty(actor?.role)
    && nonempty(actor?.status) && Array.isArray(actor.pendingPermissions)
    && actor.pendingPermissions.length === 0
    && !/(^|\/)(running|working|pending|unknown)(\/|$)/i.test(actor.status));
}

const capturedBytes = bytes => bytes.length > 0;
// accept: gate at collection time, with the message a coordinator sees.
// satisfies: does this payload actually discharge its kind's requirement at seal time.
const registry = {
  preflight: { satisfies: capturedBytes },
  launch: { satisfies: capturedBytes },
  instructions: { satisfies: capturedBytes },
  timeline: { satisfies: capturedBytes },
  coordinator: {
    accept: validCoordinatorTranscript,
    message: 'Coordinator transcript must contain nonempty JSONL object records and the native session marker',
    satisfies: validCoordinatorTranscript,
  },
  artifacts: { satisfies: capturedBytes },
  checks: { satisfies: capturedBytes },
  interventions: { satisfies: capturedBytes },
  resources: {
    accept: resourceSettlementShape,
    message: 'Resource settlement must use the version 1 structured receipt',
    satisfies: settledResources,
  },
};

export const evidenceKinds = Object.keys(registry);
export const knownEvidenceKind = kind => Object.hasOwn(registry, kind);

const attempt = (check, bytes, context) => { try { return Boolean(check(bytes, context)); } catch { return false; } };

// Throws the kind's own message when a payload may not enter the ledger at all.
export function acceptEvidence(kind, bytes, context = {}) {
  const entry = registry[kind];
  if (!entry) throw new Error('Unknown evidence kind');
  if (entry.accept && !attempt(entry.accept, bytes, context)) throw new Error(entry.message);
}

export function satisfiesEvidence(kind, bytes, context = {}) {
  const entry = registry[kind];
  return Boolean(entry) && attempt(entry.satisfies, bytes, context);
}
