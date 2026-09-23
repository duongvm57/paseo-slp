// plugin/server/supervision/observer.ts — Phase B shadow observer.
// Spec: docs/spec/supervision-integration.md §Observation, §Shadow evidence,
// §Failure and privacy boundaries.
//
// Lifecycle hooks do the minimum synchronously (normalize + enqueue) and
// return; everything async — SDK refresh, Jev HTTP, persistence — runs in a
// single serialized queue owned by the plugin process. Archive events tombstone
// agent ids so a late event from the old generation cannot re-enter. A
// monotonic callback-order counter stamps every observation; Lead handling is
// provable only when a matching non-null turn-start landed strictly after the
// Peer's handback.
//
// Queue/generation mechanics are adapted from hoangnb24/paseo-supervision
// server/observer.ts @ 1bad19b8ee6c58482494f56a3d8c6edb4f969ee1
// (Apache-2.0). Removed, per spec: the supervisor sync RPC, alert sends, and
// all notification delivery — `notify` routes are never observed here.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginHookAgent } from "@getpaseo/plugin/server";
import { z } from "zod";
import { isSlpLead, isSlpPeer, SupervisionFileSchema, SupervisionObservation } from "../../shared/supervision.ts";
import type { SupervisionObservation as Observation, SupervisionRoute } from "../../shared/supervision.ts";
import { writePrivate } from "../state-store.ts";
import { capture, VISIBILITY } from "./capture.ts";
import type { Capture, SendObservation, TurnEnded, TurnStarted } from "./capture.ts";
import {
  localGate, decide, parseAssessmentResponse, SUPERVISION_QUESTIONS,
  type AssessmentAnswers, type Decision, type EvidencePayload,
} from "./assessment.ts";
import { askJevDecision, resolveSupervision, JevRequestError, type SupervisionGate } from "../jev.ts";

// Spec §Observer bounds — exceeding any becomes unknown + a metadata-only
// diagnostic; evidence is never truncated into apparently-complete content.
const MAX_CASES = 64;
const MAX_QUEUE = 128;
const MAX_EVIDENCE_BYTES = 64 * 1024;
const MAX_ASSESSMENTS = 4;
const CASE_LIFE_MS = 24 * 60 * 60 * 1000;
const RING_MAX = 200;
const RING_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SDK_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_DIAGNOSTIC_REASONS = 20;
const CASES_FILE = join("state", "supervision-cases.json");

// ---------------------------------------------------------------------------
// Case model + bounded metadata ring
// ---------------------------------------------------------------------------

interface MessageRef { callId: string; turnId: string | null; recipient: string; prompt: string }

interface CaseEvidence {
  brief: { text: string; messageId: string | null; flags: string[] } | null;
  handback: { text: string; messageId: string | null } | null;
  roomMessages: MessageRef[];          // confirmed Lead→Peer sends after the handback
  uncertainRoomMessages: MessageRef[]; // parsed sends whose start/success cannot be proven
  reportMessages: MessageRef[];        // confirmed Lead→Supervisor sends (separate provenance)
  peerSends: MessageRef[];             // confirmed Peer→recipient sends (delivered communication)
  flags: string[];
  pendingDelayElapsed: boolean;
}

interface Case {
  id: string;
  leadId: string;
  peerId: string;
  peerTurnId: string | null;
  evidence: CaseEvidence;
  due: number;
  expiresAt: number;
  timerUsed: boolean;
  handbackOrder: number;
  dirty: boolean;
  gatedReason: string | null;
  disposition: "observed" | "unknown" | "suspected_drift";
  assessments: number;
  observedAt: number;
  lastAssessment: Observation["lastAssessment"];
}

const CasesFileSchema = z.object({
  schemaVersion: z.literal(1),
  cases: z.array(SupervisionObservation),
}).strict();

type Job =
  | { t: "tick"; order: number }
  | { t: "turn-end"; order: number; capture: Capture; startSeq: number | null; overlap: boolean }
  | { t: "verify-peer"; order: number; leadId: string; peerId: string }
  | { t: "restore-lead"; order: number; leadId: string }
  | { t: "archive"; order: number; agent: PluginHookAgent };

// The SDK does not offer cancellation on refresh — bound our wait and detach
// on stop (spec: "bound SDK waits"). An already issued request cannot be
// retracted; never initiate one after stop.
function bounded<T>(work: Promise<T>, signal: AbortSignal, timeoutMs = SDK_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      fn();
    };
    const abort = () => done(() => reject(new Error("stopped")));
    const timer = setTimeout(() => done(() => reject(new Error("sdk-timeout"))), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => done(() => resolve(value)), () => done(() => reject(new Error("sdk-failure"))));
    if (signal.aborted) abort();
  });
}

export interface ObserverDeps {
  stableRoot: string;
  now?: () => number;
  signal?: AbortSignal;
  uuid?: () => string;
  /** Test seams — default to the real Jev module. */
  gate?: (stableRoot: string) => SupervisionGate;
  ask?: typeof askJevDecision;
  httpTimeoutMs?: number;
}

export function createSupervisionObserver(deps: ObserverDeps) {
  const stableRoot = deps.stableRoot;
  const now = () => (deps.now ?? Date.now)();
  const uuid = deps.uuid ?? randomUUID;
  const gateOf = deps.gate ?? resolveSupervision;
  const ask = deps.ask ?? askJevDecision;
  const httpTimeoutMs = deps.httpTimeoutMs ?? HTTP_TIMEOUT_MS;

  const abort = new AbortController();
  const signal = abort.signal;
  const outerSignal = deps.signal;
  if (outerSignal !== undefined) {
    if (outerSignal.aborted) abort.abort();
    else outerSignal.addEventListener("abort", () => abort.abort(), { once: true });
  }

  let order = 0;                    // monotonic callback-order counter
  let version = 0;                  // bumped on every enqueue — stale-detection
  let running = false;
  let stopped = false;
  const jobs: Job[] = [];
  const cases = new Map<string, Case>();
  const seen = new Set<string>();               // capture fingerprint dedup
  const sentCalls = new Set<string>();          // leadId\0callId send dedup
  const peers = new Map<string, string>();      // verified peerId → leadId
  const archiveGeneration = new Map<string, number>();
  const leadStarts = new Map<string, number>(); // leadId\0turnId → callback order
  const startMeta = new Map<string, { seq: number; overlapped: boolean }>();
  const openTurns = new Map<string, Set<string>>(); // leadId → started-not-ended turnIds
  const routeReasons = new Map<string, string>();
  const diagnostics = { droppedEvents: 0, reasons: [] as string[] };
  let lastPaseo: PaseoApi | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ring: Map<string, Observation> | null = null;
  let ringDirty = false;

  const diag = (reason: string) => {
    if (!diagnostics.reasons.includes(reason) && diagnostics.reasons.length < MAX_DIAGNOSTIC_REASONS) {
      diagnostics.reasons.push(reason);
    }
  };

  // --- route + gate reads (mtime-cached; hooks must stay cheap) -----------

  const routesFile = join(stableRoot, "state", "supervision.json");
  let routesCache: { stamp: string; routes: SupervisionRoute[] } | null = null;
  /** Active shadow routes keyed by lead id. An unreadable/invalid file reads
   *  as "no routes" — invalid config means observation is off (state.ts
   *  surfaces the same condition as a visible error to the Manager). The
   *  cache key is mtime+size so a same-millisecond rewrite still re-reads. */
  const shadowRoutes = (): Map<string, SupervisionRoute> => {
    const map = new Map<string, SupervisionRoute>();
    try {
      const stat = lstatSync(routesFile);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (routesCache === null || routesCache.stamp !== stamp) {
        const parsed = SupervisionFileSchema.safeParse(JSON.parse(readFileSync(routesFile, "utf8")));
        routesCache = { stamp, routes: parsed.success ? parsed.data.routes : [] };
      }
    } catch {
      routesCache = { stamp: "-", routes: [] };
    }
    for (const route of routesCache.routes) {
      if (route.mode === "shadow") map.set(route.leadAgentId, route);
    }
    return map;
  };

  let gateCache: { stamp: string; gate: SupervisionGate } | null = null;
  /** Daemon-global Jev gate — a failed capability/key/target pauses capture
   *  for every route (spec: "pauses capture for that route"; the gate is
   *  per-daemon, so all routes pause together). */
  const jevGate = (): SupervisionGate => {
    const stamp = statStamp(join(stableRoot, "state", "jev.json")) + "|" + keyStamps();
    if (gateCache === null || gateCache.stamp !== stamp) {
      gateCache = { stamp, gate: gateOf(stableRoot) };
    }
    return gateCache.gate;
  };
  const statStamp = (file: string): string => {
    try {
      const stat = lstatSync(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "-";
    }
  };
  const keyStamps = (): string =>
    ["openrouter", "typesafe"].map(kind => statStamp(join(stableRoot, "state", `jev-${kind}.key`))).join("|");

  const captureAllowed = (): boolean => jevGate().ok;

  // --- metadata ring (state/supervision-cases.json) ------------------------

  const loadRing = (): Map<string, Observation> => {
    if (ring !== null) return ring;
    ring = new Map();
    try {
      const parsed = CasesFileSchema.safeParse(
        JSON.parse(readFileSync(join(stableRoot, CASES_FILE), "utf8")),
      );
      if (parsed.success) {
        const cutoff = now() - RING_AGE_MS;
        for (const entry of parsed.data.cases) {
          if (Date.parse(entry.updatedAt) >= cutoff) ring.set(entry.fingerprint, entry);
        }
      }
    } catch { /* absent or corrupt — a fresh ring; the file is rewritten on next change */ }
    return ring;
  };

  const persistRing = (): void => {
    if (!ringDirty || ring === null) return;
    ringDirty = false;
    const cutoff = now() - RING_AGE_MS;
    const entries = [...ring.values()]
      .filter(entry => Date.parse(entry.updatedAt) >= cutoff)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, RING_MAX);
    try {
      writePrivate(stableRoot, CASES_FILE, `${JSON.stringify({ schemaVersion: 1, cases: entries }, null, 2)}\n`, uuid);
    } catch {
      diag("ring-persist-failed");
      ringDirty = true;
    }
  };

  const recordRing = (item: Case, state: Observation["state"], reason: string | null): void => {
    const entries = loadRing();
    const stamp = new Date(now()).toISOString();
    const prior = entries.get(item.id);
    entries.set(item.id, {
      fingerprint: item.id,
      leadAgentId: item.leadId,
      peerId: item.peerId,
      peerTurnId: item.peerTurnId,
      observedAt: prior?.observedAt ?? new Date(item.observedAt).toISOString(),
      updatedAt: stamp,
      state,
      reason: reason?.slice(0, 400) ?? null,
      visibility: item.evidence.flags.slice(0, 24),
      counts: {
        roomMessages: item.evidence.roomMessages.length,
        uncertainRoomMessages: item.evidence.uncertainRoomMessages.length,
        reportMessages: item.evidence.reportMessages.length,
        peerSends: item.evidence.peerSends.length,
      },
      assessmentsUsed: item.assessments,
      lastAssessment: item.lastAssessment,
    });
    ringDirty = true;
  };

  const closeCase = (item: Case, state: Observation["state"], reason: string | null): void => {
    recordRing(item, state, reason);
    cases.delete(item.id);
    persistRing();
  };

  // --- synchronous hook handlers -------------------------------------------

  const tombstoned = (id: string): boolean => archiveGeneration.has(id);
  const startKey = (leadId: string, turnId: string | null): string | null =>
    turnId === null ? null : `${leadId}\0${turnId}`;

  function onCreated(agent: PluginHookAgent): void {
    if (signal.aborted) return;
    const routes = shadowRoutes();
    if (isSlpPeer(agent.provider) && agent.parentAgentId !== null && routes.has(agent.parentAgentId)) {
      // Fresh creation — the hook payload's parentAgentId is authoritative.
      // Tombstoned ids re-enter only through the refresh-verified restore job.
      if (tombstoned(agent.id)) {
        enqueue({ t: "verify-peer", order: ++order, leadId: agent.parentAgentId, peerId: agent.id });
      } else {
        peers.set(agent.id, agent.parentAgentId);
      }
      return;
    }
    if (isSlpLead(agent.provider) && routes.has(agent.id) && tombstoned(agent.id)) {
      enqueue({ t: "restore-lead", order: ++order, leadId: agent.id });
    }
  }

  function onArchived(agent: PluginHookAgent, paseo: PaseoApi): void {
    if (signal.aborted) return;
    lastPaseo = paseo;
    // Tombstone synchronously so a later-arriving turn cannot recreate state;
    // the queued job preserves ordering and invalidates in-flight assessment
    // through enqueue's version bump.
    archiveGeneration.set(agent.id, (archiveGeneration.get(agent.id) ?? 0) + 1);
    for (const key of leadStarts.keys()) if (key.startsWith(`${agent.id}\0`)) leadStarts.delete(key);
    for (const key of startMeta.keys()) if (key.startsWith(`${agent.id}\0`)) startMeta.delete(key);
    openTurns.delete(agent.id);
    enqueue({ t: "archive", order: ++order, agent });
  }

  function onStart(event: TurnStarted): void {
    if (signal.aborted) return;
    const routes = shadowRoutes();
    const lead = isSlpLead(event.agent.provider) && routes.has(event.agent.id) && !tombstoned(event.agent.id);
    if (!lead) return;
    const seq = ++order;
    // Null ids cannot be reliably matched; repeated starts keep the earliest
    // observed order so an old turn cannot slide across a handback boundary.
    const key = startKey(event.agent.id, event.turnId);
    if (key === null) return;
    const open = openTurns.get(event.agent.id) ?? new Set<string>();
    if (!openTurns.has(event.agent.id)) openTurns.set(event.agent.id, open);
    const overlapped = open.size > 0;
    // Overlap is mutual: a turn that starts while another is open also makes
    // the ALREADY-open turn's chronology ambiguous — mark every open start.
    if (overlapped) {
      for (const openId of open) {
        const meta = startMeta.get(`${event.agent.id}\0${openId}`);
        if (meta) meta.overlapped = true;
      }
    }
    open.add(event.turnId as string);
    if (!leadStarts.has(key)) {
      leadStarts.set(key, seq);
      startMeta.set(key, { seq, overlapped });
    }
  }

  function onTurn(event: TurnEnded, paseo: PaseoApi): void {
    if (signal.aborted) return;
    lastPaseo = paseo;
    const routes = shadowRoutes();
    if (!captureAllowed()) return;
    // Peer membership: known-verified pairs observe directly; unknown pairs
    // queue a refresh-verified restore first (post-restart self-healing —
    // "restore discovery only after read-only refresh verifies active
    // parentage"). Tombstoned ids never shortcut.
    const leadId = isSlpLead(event.agent.provider) ? event.agent.id : event.agent.parentAgentId;
    if (leadId === null || !routes.has(leadId)) return;
    const isLeadEvent = event.agent.id === leadId;
    if (isLeadEvent && tombstoned(leadId)) {
      enqueue({ t: "restore-lead", order: ++order, leadId });
      return; // the capture is dropped — a pre-restore turn cannot be trusted
    }
    if (!isLeadEvent) {
      if (!isSlpPeer(event.agent.provider)) return;
      if (tombstoned(event.agent.id)) {
        enqueue({ t: "verify-peer", order: ++order, leadId, peerId: event.agent.id });
        return;
      }
      if (peers.get(event.agent.id) !== leadId) {
        enqueue({ t: "verify-peer", order: ++order, leadId, peerId: event.agent.id });
      }
    }
    const captured = capture(event, new Set(routes.keys()));
    if (captured === null || seen.has(captured.id)) return;
    seen.add(captured.id);
    const seq = ++order;
    const key = startKey(leadId, captured.turnId);
    const meta = key === null ? null : startMeta.get(key) ?? null;
    if (key !== null) {
      leadStarts.delete(key);
      startMeta.delete(key);
      openTurns.get(leadId)?.delete(captured.turnId as string);
    }
    enqueue({
      t: "turn-end", order: seq, capture: captured,
      startSeq: captured.kind === "lead" ? meta?.seq ?? null : null,
      overlap: captured.kind === "lead" ? meta?.overlapped ?? false : false,
    });
  }

  // --- queue machinery ------------------------------------------------------

  function enqueue(job: Job): void {
    if (signal.aborted) return;
    if (jobs.length >= MAX_QUEUE) {
      diagnostics.droppedEvents += 1;
      diag(VISIBILITY.queueOverflow);
      // Metadata-only diagnostic record for a dropped capture — the case
      // never existed, so there is nothing else to persist.
      if (job.t === "turn-end" && job.capture.kind === "peer") {
        const entries = loadRing();
        const stamp = new Date(now()).toISOString();
        entries.set(job.capture.id, {
          fingerprint: job.capture.id,
          leadAgentId: job.capture.leadId,
          peerId: job.capture.peerId,
          peerTurnId: job.capture.turnId,
          observedAt: stamp, updatedAt: stamp,
          state: "unknown", reason: VISIBILITY.queueOverflow,
          visibility: [VISIBILITY.queueOverflow],
          counts: { roomMessages: 0, uncertainRoomMessages: 0, reportMessages: 0, peerSends: 0 },
          assessmentsUsed: 0, lastAssessment: null,
        });
        ringDirty = true;
        persistRing();
      }
      // A dropped lead turn-end loses sends for every open case of that
      // lead — mark them so evaluation sees the gap instead of silence.
      if (job.t === "turn-end" && job.capture.kind === "lead") {
        for (const item of cases.values()) {
          if (item.leadId !== job.capture.leadId) continue;
          if (!item.evidence.flags.includes(VISIBILITY.queueOverflow)) item.evidence.flags.push(VISIBILITY.queueOverflow);
          item.dirty = true;
        }
      }
      return;
    }
    jobs.push(job);
    version++;
    if (!running) {
      running = true;
      queueMicrotask(() => { void drain(); });
    }
  }

  async function apply(job: Job): Promise<void> {
    const paseo = lastPaseo;
    if (job.t === "tick") {
      for (const item of cases.values()) {
        if (!item.timerUsed && item.due <= now()) {
          item.timerUsed = true;
          item.evidence.pendingDelayElapsed = true;
          item.dirty = true;
        }
        if (item.expiresAt <= now()) closeCase(item, "unknown", VISIBILITY.caseExpired);
      }
      return;
    }
    if (job.t === "archive") {
      const { agent } = job;
      if (peers.get(agent.id) !== undefined) peers.delete(agent.id);
      if (isSlpLead(agent.provider)) {
        routeReasons.set(agent.id, "lead-archived");
        for (const [id, item] of cases) if (item.leadId === agent.id) {
          clearBodies(item);
          closeCase(item, "unknown", "lead-archived");
        }
      } else {
        for (const [id, item] of cases) if (item.peerId === agent.id) {
          clearBodies(item);
          closeCase(item, "unknown", "peer-archived");
        }
      }
      return;
    }
    if (job.t === "restore-lead") {
      if (paseo === undefined) return;
      const gen = archiveGeneration.get(job.leadId);
      try {
        const result = await bounded(paseo.agents.ref(job.leadId).refresh(), signal);
        if (gen !== undefined && archiveGeneration.get(job.leadId) !== gen) return;
        const agent = result?.agent;
        if (!agent || agent.archivedAt !== null || agent.status === "closed" || !isSlpLead(agent.provider)) return;
        archiveGeneration.delete(job.leadId);
      } catch { /* stays tombstoned — visibility gap recorded on next view */ }
      return;
    }
    if (job.t === "verify-peer") {
      if (paseo === undefined) return;
      const gen = archiveGeneration.get(job.peerId);
      try {
        const result = await bounded(paseo.agents.ref(job.peerId).refresh(), signal);
        if (gen !== undefined && archiveGeneration.get(job.peerId) !== gen) return;
        const agent = result?.agent;
        if (!agent || agent.archivedAt !== null || agent.status === "closed" || !isSlpPeer(agent.provider)) return;
        const parent = agent.labels?.["paseo.parent-agent-id"] ?? null;
        if (parent !== job.leadId) return;
        archiveGeneration.delete(job.peerId);
        peers.set(job.peerId, job.leadId);
      } catch { /* unverified — subsequent turn events retry */ }
      return;
    }
    // turn-end
    const event = job.capture;
    if (event.kind === "peer") {
      if (peers.get(event.peerId) !== event.leadId) {
        // Unverified membership — persist a metadata-only unknown, no bodies.
        const entries = loadRing();
        const stamp = new Date(now()).toISOString();
        entries.set(event.id, {
          fingerprint: event.id, leadAgentId: event.leadId, peerId: event.peerId,
          peerTurnId: event.turnId, observedAt: stamp, updatedAt: stamp,
          state: "unknown", reason: VISIBILITY.recipientRefreshFailed,
          visibility: [VISIBILITY.recipientRefreshFailed],
          counts: { roomMessages: 0, uncertainRoomMessages: 0, reportMessages: 0, peerSends: 0 },
          assessmentsUsed: 0, lastAssessment: null,
        });
        ringDirty = true;
        persistRing();
        return;
      }
      if (cases.size >= MAX_CASES && !cases.has(event.id)) {
        diag(VISIBILITY.caseCeiling);
        const entries = loadRing();
        const stamp = new Date(now()).toISOString();
        entries.set(event.id, {
          fingerprint: event.id, leadAgentId: event.leadId, peerId: event.peerId,
          peerTurnId: event.turnId, observedAt: stamp, updatedAt: stamp,
          state: "unknown", reason: VISIBILITY.caseCeiling,
          visibility: [VISIBILITY.caseCeiling],
          counts: { roomMessages: 0, uncertainRoomMessages: 0, reportMessages: 0, peerSends: 0 },
          assessmentsUsed: 0, lastAssessment: null,
        });
        ringDirty = true;
        persistRing();
        return;
      }
      const route = shadowRoutes().get(event.leadId);
      if (route === undefined) return; // route removed between hook and apply
      const flags = new Set(event.flags);
      // An unconfirmed Peer send cannot prove delivery — flag it on the case
      // (already present from capture) but never store it as evidence.
      const evidence: CaseEvidence = {
        brief: event.brief.text !== "" ? { text: event.brief.text, messageId: event.brief.messageId, flags: [...flags] } : null,
        handback: event.handback,
        roomMessages: [], uncertainRoomMessages: [],
        reportMessages: [],
        peerSends: event.sends.map(s => ({ callId: s.callId, turnId: event.turnId, recipient: s.recipient, prompt: s.prompt })),
        flags: [...flags],
        pendingDelayElapsed: false,
      };
      const item: Case = {
        id: event.id, leadId: event.leadId, peerId: event.peerId, peerTurnId: event.turnId,
        evidence,
        due: now() + route.pendingDelayMs,
        expiresAt: now() + CASE_LIFE_MS,
        timerUsed: false,
        handbackOrder: job.order,
        dirty: true,
        gatedReason: null,
        disposition: "observed",
        assessments: 0,
        observedAt: now(),
        lastAssessment: null,
      };
      if (JSON.stringify(buildEvidence(item, route)).length > MAX_EVIDENCE_BYTES) {
        item.evidence.flags.push(VISIBILITY.evidenceOversize);
        item.gatedReason = VISIBILITY.evidenceOversize;
      }
      cases.set(item.id, item);
      recordRing(item, "observed", null);
      return;
    }
    // lead turn-end: attach confirmed/uncertain sends to every open case of
    // this lead; chronology is decided per case by strict start order.
    const routes = shadowRoutes();
    const route = routes.get(event.leadId);
    if (route === undefined) return;
    const sends: SendObservation[] = event.sends;
    const uncertain: SendObservation[] = event.uncertainSends;
    const newFlags = new Set(event.flags);
    const roomFor = new Map<string, MessageRef[]>();
    const reports: MessageRef[] = [];
    for (const send of sends) {
      if (signal.aborted) return;
      const callKey = `${event.leadId}\0${send.callId}`;
      if (sentCalls.has(callKey)) continue;
      sentCalls.add(callKey);
      if (route.supervisorAgentId !== null && send.recipient === route.supervisorAgentId) {
        reports.push({ callId: send.callId, turnId: event.turnId, recipient: send.recipient, prompt: send.prompt });
        continue;
      }
      if (send.recipient === event.leadId) continue;
      // A send counts as room handling only toward a verified direct Peer.
      let leadOfRecipient = peers.get(send.recipient);
      if (leadOfRecipient === undefined && lastPaseo !== undefined) {
        try {
          const result = await bounded(lastPaseo.agents.ref(send.recipient).refresh(), signal);
          const agent = result?.agent;
          if (!agent || agent.archivedAt !== null || agent.status === "closed") {
            newFlags.add(VISIBILITY.recipientInactive);
            continue;
          }
          if (isSlpPeer(agent.provider) && (agent.labels?.["paseo.parent-agent-id"] ?? null) === event.leadId) {
            leadOfRecipient = event.leadId;
            peers.set(send.recipient, event.leadId);
          }
        } catch {
          newFlags.add(VISIBILITY.recipientRefreshFailed);
          continue;
        }
      }
      if (leadOfRecipient !== event.leadId) continue; // unrelated recipient — never proof
      const list = roomFor.get(send.recipient) ?? [];
      list.push({ callId: send.callId, turnId: event.turnId, recipient: send.recipient, prompt: send.prompt });
      roomFor.set(send.recipient, list);
    }
    const subsequent = job.startSeq !== null && !job.overlap;
    if (job.startSeq === null || job.overlap) newFlags.add(VISIBILITY.leadStartUnmatched);
    for (const item of cases.values()) {
      if (item.leadId !== event.leadId) continue;
      const qualifies = subsequent && (job.startSeq as number) > item.handbackOrder;
      // A send proves handling only for the case of its actual Peer
      // recipient — a send to Peer X is not evidence about Peer Y's case.
      const forPeer = roomFor.get(item.peerId) ?? [];
      (qualifies ? item.evidence.roomMessages : item.evidence.uncertainRoomMessages).push(...forPeer);
      item.evidence.uncertainRoomMessages.push(
        ...uncertain.map(s => ({ callId: s.callId, turnId: event.turnId, recipient: s.recipient, prompt: s.prompt })),
      );
      item.evidence.reportMessages.push(...reports);
      for (const flag of newFlags) if (!item.evidence.flags.includes(flag)) item.evidence.flags.push(flag);
      if (sends.length || uncertain.length || reports.length) item.dirty = true;
      recordRing(item, item.disposition, item.gatedReason);
    }
  }

  const clearBodies = (item: Case): void => {
    item.evidence.brief = item.evidence.brief === null ? null : { text: "", messageId: item.evidence.brief.messageId, flags: item.evidence.brief.flags };
    item.evidence.handback = item.evidence.handback === null ? null : { text: "", messageId: item.evidence.handback.messageId };
    for (const lane of [item.evidence.roomMessages, item.evidence.uncertainRoomMessages, item.evidence.reportMessages, item.evidence.peerSends]) {
      for (const message of lane) message.prompt = "";
    }
  };

  // --- evaluation -----------------------------------------------------------

  const buildEvidence = (item: Case, route: SupervisionRoute): EvidencePayload => ({
    bound: { leadAgentId: item.leadId, peerId: item.peerId, supervisorAgentId: route.supervisorAgentId },
    caseId: item.id,
    peerTurnId: item.peerTurnId,
    brief: item.evidence.brief === null ? null : {
      text: item.evidence.brief.text, messageId: item.evidence.brief.messageId,
      visibility: item.evidence.brief.flags,
    },
    handback: item.evidence.handback,
    roomMessages: item.evidence.roomMessages.map(m => ({ callId: m.callId, turnId: m.turnId, prompt: m.prompt })),
    uncertainRoomMessages: item.evidence.uncertainRoomMessages.map(m => ({ callId: m.callId, turnId: m.turnId })),
    reportMessages: item.evidence.reportMessages.map(m => ({ callId: m.callId, turnId: m.turnId, recipient: m.recipient, prompt: m.prompt })),
    peerSends: item.evidence.peerSends.map(m => ({ callId: m.callId, recipient: m.recipient, prompt: m.prompt })),
    pendingWindowElapsed: item.evidence.pendingDelayElapsed,
    flags: item.evidence.flags,
  });

  async function evaluateCase(item: Case): Promise<void> {
    const route = shadowRoutes().get(item.leadId);
    if (route === undefined) { closeCase(item, "unknown", "route-removed"); return; }
    const gate = jevGate();
    if (!gate.ok) {
      routeReasons.set(item.leadId, gate.reason);
      item.disposition = "unknown";
      recordRing(item, "unknown", gate.reason);
      ringDirty = true;
      return; // stays open + dirty — retries when the gate recovers
    }
    routeReasons.delete(item.leadId);
    if (item.gatedReason !== null) { closeCase(item, "unknown", item.gatedReason); return; }
    if (item.expiresAt <= now()) { closeCase(item, "unknown", VISIBILITY.caseExpired); return; }
    if (item.assessments >= MAX_ASSESSMENTS) { closeCase(item, "unknown", VISIBILITY.assessmentCeiling); return; }
    const paseo = lastPaseo;
    if (paseo === undefined) {
      item.disposition = "unknown";
      recordRing(item, "unknown", "sdk-unavailable");
      ringDirty = true;
      return;
    }
    // Liveness gates: refresh Lead and Peer — an archived/closed seat pauses
    // and is surfaced, never treated as drift.
    let leadSnap, peerSnap;
    try {
      [leadSnap, peerSnap] = await Promise.all([
        bounded(paseo.agents.ref(item.leadId).refresh(), signal),
        bounded(paseo.agents.ref(item.peerId).refresh(), signal),
      ]);
    } catch {
      item.disposition = "unknown";
      recordRing(item, "unknown", VISIBILITY.recipientRefreshFailed);
      ringDirty = true;
      return;
    }
    if (signal.aborted) return;
    const lead = leadSnap?.agent;
    if (!lead || lead.archivedAt !== null || lead.status === "closed" ||
        !isSlpLead(lead.provider) || lead.workspaceId !== route.leadWorkspaceId) {
      item.disposition = "unknown";
      clearBodies(item);
      closeCase(item, "unknown", "lead-inactive");
      return;
    }
    const peer = peerSnap?.agent;
    if (!peer || peer.archivedAt !== null || peer.status === "closed" ||
        !isSlpPeer(peer.provider) || (peer.labels?.["paseo.parent-agent-id"] ?? null) !== item.leadId) {
      item.disposition = "unknown";
      clearBodies(item);
      closeCase(item, "unknown", "peer-inactive");
      return;
    }
    const payload = buildEvidence(item, route);
    const gateReason = localGate(payload);
    if (gateReason !== null) {
      item.gatedReason = gateReason;
      item.disposition = "unknown";
      if (!item.evidence.flags.includes(gateReason)) item.evidence.flags.push(gateReason);
      closeCase(item, "unknown", gateReason);
      return;
    }
    if (JSON.stringify(payload).length > MAX_EVIDENCE_BYTES) {
      item.gatedReason = VISIBILITY.evidenceOversize;
      item.disposition = "unknown";
      closeCase(item, "unknown", VISIBILITY.evidenceOversize);
      return;
    }
    // Stale-detection: evidence arriving during the assessment invalidates it
    // before any conclusion is stored (spec: "invalidates the assessment
    // before delivery").
    const pre = version;
    item.assessments += 1;
    let assessment: { answers: AssessmentAnswers; model: string; usage: { input_tokens: number; output_tokens: number } | null } | null = null;
    let failed = "jev-request-failed";
    try {
      const envelope = await ask(gate.provider, gate.authorization, {
        state: payload,
        questions: SUPERVISION_QUESTIONS,
      }, { timeoutMs: httpTimeoutMs, signal });
      const parsed = parseAssessmentResponse(envelope.raw, gate.provider);
      if (parsed !== null) {
        assessment = { answers: parsed.answers, model: parsed.model, usage: parsed.usage };
      } else {
        failed = "jev-response-invalid";
      }
    } catch (error) {
      failed = error instanceof JevRequestError && error.code === "jev-redacted"
        ? VISIBILITY.credentialGuard
        : error instanceof JevRequestError ? error.code : "jev-request-failed";
    }
    if (signal.aborted) return;
    if (version !== pre) {
      // Evidence changed mid-flight — discard; the newer batch re-arms dirty.
      item.dirty = true;
      return;
    }
    if (assessment !== null) {
      item.lastAssessment = {
        at: new Date(now()).toISOString(),
        model: assessment.model,
        usage: assessment.usage,
        choices: {
          leadBrief: assessment.answers.leadBrief.choice,
          peerHandback: assessment.answers.peerHandback.choice,
          leadHandling: assessment.answers.leadHandling.choice,
        },
      };
    }
    item.dirty = false;
    if (assessment === null) {
      // A failed/malformed Jev call never proves anything and a failed
      // request never auto-retries (spec). The case stays open — new
      // evidence re-arms dirty; the assessment ceiling bounds total calls.
      // Credential-guard refusals are permanent — close immediately.
      item.disposition = "unknown";
      recordRing(item, "unknown", failed);
      ringDirty = true;
      if (failed === VISIBILITY.credentialGuard || item.assessments >= MAX_ASSESSMENTS) {
        closeCase(item, "unknown", failed === VISIBILITY.credentialGuard ? VISIBILITY.credentialGuard : VISIBILITY.assessmentCeiling);
      }
      return;
    }
    const verdict: Decision = decide(assessment.answers, payload, null);
    if (verdict === "handled") { closeCase(item, "evaluated", null); return; }
    // suspected_drift and unknown stay OPEN until new evidence or expiry —
    // the ring row records the current disposition for the Manager list.
    // No notification path exists in this build.
    item.disposition = verdict === "suspected_drift" ? "suspected_drift" : "unknown";
    recordRing(item, item.disposition, verdict === "suspected_drift" ? "suspected-drift" : "assessment-inconclusive");
    ringDirty = true;
  }

  async function drain(): Promise<void> {
    try {
      while (jobs.length && !signal.aborted) {
        while (jobs.length && !signal.aborted) {
          const job = jobs.shift();
          if (job) await apply(job);
        }
        const pre = version;
        for (const item of cases.values()) {
          if (signal.aborted || pre !== version) break;
          if (!item.dirty || item.due > now()) continue;
          item.evidence.pendingDelayElapsed = true;
          item.timerUsed = true;
          await evaluateCase(item);
        }
      }
    } finally {
      running = false;
      persistRing();
      schedule();
    }
  }

  function schedule(): void {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (signal.aborted) return;
    const times: number[] = [];
    for (const item of cases.values()) {
      if (!item.timerUsed) times.push(item.due);
      times.push(item.expiresAt);
    }
    const next = Math.min(...times);
    if (!Number.isFinite(next)) return;
    timer = setTimeout(() => {
      timer = undefined;
      enqueue({ t: "tick", order: ++order });
    }, Math.max(0, next - now()));
  }

  // --- surface ---------------------------------------------------------------

  /** get-supervision extras for the served home — metadata only. */
  function shadow(targetStableRoot: string) {
    if (targetStableRoot !== stableRoot) return null;
    const entries = [...loadRing().values()]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const gates: Record<string, string | null> = {};
    const gate = jevGate();
    for (const leadId of shadowRoutes().keys()) {
      gates[leadId] = routeReasons.get(leadId) ?? (gate.ok ? null : gate.reason);
    }
    return {
      observations: entries,
      gates,
      diagnostics: { droppedEvents: diagnostics.droppedEvents, reasons: [...diagnostics.reasons] },
    };
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    abort.abort();
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    jobs.length = 0;
    // Wait for an in-flight drain to detach (bounded awaits reject on abort).
    while (running) await new Promise(resolve => setTimeout(resolve, 10));
    cases.clear();
    peers.clear();
    leadStarts.clear();
    startMeta.clear();
    openTurns.clear();
    persistRing();
  }

  /** Test/diagnostic seam: resolves when the queue is applied and no drain
   *  is running. Not part of the lifecycle surface. */
  async function idle(): Promise<void> {
    while (running || jobs.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  return { onCreated, onArchived, onStart, onTurn, shadow, stop, idle, signal };
}

export type SupervisionObserver = ReturnType<typeof createSupervisionObserver>;
