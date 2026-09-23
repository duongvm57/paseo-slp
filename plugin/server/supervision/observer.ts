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
// Parity with the shared Jev helper's default bound (5s, same as
// src/jev.mjs) — the deadline covers the whole request including the body
// read; a longer observer-only override would silently widen the cost of a
// stalled provider.
const HTTP_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_REASONS = 20;
const CASES_FILE = join("state", "supervision-cases.json");

// ---------------------------------------------------------------------------
// Case model + bounded metadata ring
// ---------------------------------------------------------------------------

export interface MessageRef { callId: string; turnId: string | null; recipient: string; prompt: string }

export interface CaseEvidence {
  brief: { text: string; messageId: string | null; flags: string[] } | null;
  handback: { text: string; messageId: string | null } | null;
  roomMessages: MessageRef[];          // confirmed Lead→Peer sends after the handback
  uncertainRoomMessages: MessageRef[]; // parsed sends whose start/success cannot be proven
  otherRoomMessages: MessageRef[];     // confirmed Lead→other direct-Peer sends (supporting activity, not handling)
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
  /** Per-case evaluation-basis generation — bumped on EVERY mutation an
   *  assessment could see (evidence appends, flag changes, body clears,
   *  pending-elapsed flips). The global `version` only covers evidence
   *  still QUEUED; this counter covers in-place mutations that never pass
   *  an enqueue (gate-down, queue-overflow, lane pushes). An in-flight Jev
   *  ask compares it at accept-time — spec: "New evidence arriving during
   *  an assessment invalidates that assessment." */
  evidenceVersion: number;
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
  // gen = the id's archive generation AT ENQUEUE — a queued verification
  // answers a question asked at hook time; an archive landing before the
  // job executes already changed the generation, so the job must discard
  // itself before spending a refresh (spec §Observation: "Archive
  // generations invalidate pending work").
  | { t: "verify-peer"; order: number; leadId: string; peerId: string; gen: number | undefined }
  | { t: "restore-lead"; order: number; leadId: string; gen: number | undefined }
  | { t: "archive"; order: number; agent: PluginHookAgent };

/** The exact outbound evidence state (spec §Jev: bound ids, case and
 *  turn/message ids, the complete captured brief and session handback
 *  bodies, confirmed room/report prompts, and visibility flags — nothing
 *  else). Module-level so the field-allowlist test exercises THIS function,
 *  not a re-declared literal: adding a field here must fail that test. */
export function buildEvidencePayload(
  item: {
    id: string; leadId: string; peerId: string; peerTurnId: string | null;
    evidence: CaseEvidence;
  },
  route: Pick<SupervisionRoute, "supervisorAgentId">,
): EvidencePayload {
  return {
    bound: { leadAgentId: item.leadId, peerId: item.peerId, supervisorAgentId: route.supervisorAgentId },
    caseId: item.id,
    peerTurnId: item.peerTurnId,
    brief: item.evidence.brief === null ? null : {
      text: item.evidence.brief.text, messageId: item.evidence.brief.messageId,
      visibility: item.evidence.brief.flags,
    },
    handback: item.evidence.handback,
    roomMessages: item.evidence.roomMessages.map(m => ({ callId: m.callId, turnId: m.turnId, prompt: m.prompt })),
    uncertainRoomMessages: item.evidence.uncertainRoomMessages.map(m => ({ callId: m.callId, turnId: m.turnId, recipient: m.recipient })),
    otherRoomMessages: item.evidence.otherRoomMessages.map(m => ({ callId: m.callId, turnId: m.turnId, recipient: m.recipient })),
    reportMessages: item.evidence.reportMessages.map(m => ({ callId: m.callId, turnId: m.turnId, recipient: m.recipient, prompt: m.prompt })),
    peerSends: item.evidence.peerSends.map(m => ({ callId: m.callId, recipient: m.recipient, prompt: m.prompt })),
    pendingWindowElapsed: item.evidence.pendingDelayElapsed,
    flags: item.evidence.flags,
  };
}

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
      // mode included — chmod changes keyPermissionsOk (a gate input)
      // without touching mtime or size, so a permission-only change must
      // still bust the cache.
      return `${stat.mtimeMs}:${stat.size}:${stat.mode}`;
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

  // Turn/message IDs where available — ids only, bounded (spec §Shadow
  // evidence: "turn/message IDs where available"). sendTurnIds stays
  // index-aligned with sendCallIds: the Lead turn that issued each send.
  const messageIdsOf = (item: Case): Observation["messageIds"] => {
    const sends = [
      ...item.evidence.roomMessages,
      ...item.evidence.uncertainRoomMessages,
      ...item.evidence.otherRoomMessages,
      ...item.evidence.reportMessages,
      ...item.evidence.peerSends,
    ].slice(0, 24);
    return {
      brief: item.evidence.brief?.messageId ?? null,
      handback: item.evidence.handback?.messageId ?? null,
      sendCallIds: sends.map(message => message.callId),
      sendTurnIds: sends.map(message => message.turnId),
    };
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
      messageIds: messageIdsOf(item),
      observedAt: prior?.observedAt ?? new Date(item.observedAt).toISOString(),
      updatedAt: stamp,
      state,
      reason: reason?.slice(0, 400) ?? null,
      visibility: item.evidence.flags.slice(0, 24),
      counts: {
        roomMessages: item.evidence.roomMessages.length,
        uncertainRoomMessages: item.evidence.uncertainRoomMessages.length,
        otherRoomMessages: item.evidence.otherRoomMessages.length,
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

  function onCreated(agent: PluginHookAgent, paseo: PaseoApi): void {
    if (signal.aborted) return;
    lastPaseo = paseo;
    const routes = shadowRoutes();
    if (isSlpPeer(agent.provider) && agent.parentAgentId !== null && routes.has(agent.parentAgentId)) {
      // agent.created is NOT creation-proof on this host: when a persisted
      // record lacks a provider persistence handle, ensureAgentLoaded
      // recreates the agent through createAgent, which emits the same event
      // (paseo packages/server agent-loading.ts:104-128 →
      // agent-manager.ts:1258; describeHookAgent maps parentAgentId from the
      // persisted label, lifecycle/index.ts:85). The payload's
      // parentAgentId is therefore a persisted claim, never fresh-creation
      // proof — verify membership through the same bounded refresh path as
      // post-restart discovery before registering (spec §Observation point
      // 1: "Peer membership still requires that Lead's actual parent
      // link"). A failed/inactive refresh leaves the pair unregistered;
      // the next peer turn records the visibility reason instead of
      // trusting the event payload. Tombstoned ids ride the same job —
      // its generation compare discards stale verifications. The job
      // carries the enqueue-time generation: an archive landing while the
      // job sits queued already invalidates it (spec: "Archive
      // generations invalidate pending work").
      enqueue({ t: "verify-peer", order: ++order, leadId: agent.parentAgentId, peerId: agent.id, gen: archiveGeneration.get(agent.id) });
      return;
    }
    if (isSlpLead(agent.provider) && routes.has(agent.id) && tombstoned(agent.id)) {
      enqueue({ t: "restore-lead", order: ++order, leadId: agent.id, gen: archiveGeneration.get(agent.id) });
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
    if (!captureAllowed()) {
      // Gate down is DAEMON-GLOBAL — the Jev capability/key/target gate is
      // shared by every route (spec §Configuration: a failed gate "does
      // not retain new message bodies or spend on assessments while
      // delivery is impossible" — the clause is not lead-scoped, so every
      // open case must drop retained bodies at detection, not only the
      // Lead whose event happened to observe the failure). Nothing is
      // appended and bodies already captured are dropped NOW; each case is
      // flagged so the dropped window reads as uncertainty, never as
      // silence that could look complete.
      for (const item of cases.values()) {
        if (!item.evidence.flags.includes(VISIBILITY.capturePaused)) item.evidence.flags.push(VISIBILITY.capturePaused);
        // clearBodies bumps evidenceVersion — the mutation invalidates
        // any in-flight assessment at accept-time.
        clearBodies(item);
        item.dirty = true;
      }
      return;
    }
    // Peer membership: known-verified pairs observe directly; unknown pairs
    // queue a refresh-verified restore first (post-restart self-healing —
    // "restore discovery only after read-only refresh verifies active
    // parentage"). Tombstoned ids never shortcut.
    const leadId = isSlpLead(event.agent.provider) ? event.agent.id : event.agent.parentAgentId;
    if (leadId === null || !routes.has(leadId)) return;
    const isLeadEvent = event.agent.id === leadId;
    if (isLeadEvent && tombstoned(leadId)) {
      enqueue({ t: "restore-lead", order: ++order, leadId, gen: archiveGeneration.get(leadId) });
      return; // the capture is dropped — a pre-restore turn cannot be trusted
    }
    if (!isLeadEvent) {
      if (!isSlpPeer(event.agent.provider)) return;
      if (tombstoned(event.agent.id)) {
        // A turn event while the peer is tombstoned cannot open a case —
        // the capture is dropped (archive generations "block old turns
        // from restoring an archived agent") and a verify job re-checks
        // live parentage before any future admission. The dropped capture
        // is recorded in diagnostics rather than the ring: writing a row
        // for a stale-generation peer would fabricate an observation for a
        // turn the archive boundary already invalidated.
        diag("peer-archived");
        enqueue({ t: "verify-peer", order: ++order, leadId, peerId: event.agent.id, gen: archiveGeneration.get(event.agent.id) });
        return;
      }
      if (peers.get(event.agent.id) !== leadId) {
        enqueue({ t: "verify-peer", order: ++order, leadId, peerId: event.agent.id, gen: archiveGeneration.get(event.agent.id) });
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
          messageIds: { brief: null, handback: null, sendCallIds: [], sendTurnIds: [] },
          observedAt: stamp, updatedAt: stamp,
          state: "unknown", reason: VISIBILITY.queueOverflow,
          visibility: [VISIBILITY.queueOverflow],
          counts: { roomMessages: 0, uncertainRoomMessages: 0, otherRoomMessages: 0, reportMessages: 0, peerSends: 0 },
          assessmentsUsed: 0, lastAssessment: null,
        });
        ringDirty = true;
        persistRing();
      }
      // A dropped lead turn-end loses sends for every open case of that
      // lead — mark them so evaluation sees the gap instead of silence.
      // The flag mutation bumps evidenceVersion: an in-flight assessment
      // must not accept against the pre-gap basis (spec §Observation:
      // "New evidence arriving during an assessment invalidates that
      // assessment" — a LOST event changes the basis too).
      if (job.t === "turn-end" && job.capture.kind === "lead") {
        for (const item of cases.values()) {
          if (item.leadId !== job.capture.leadId) continue;
          if (!item.evidence.flags.includes(VISIBILITY.queueOverflow)) item.evidence.flags.push(VISIBILITY.queueOverflow);
          item.evidenceVersion += 1;
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
          item.evidenceVersion += 1;
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
      // Enqueue-time generation check: an archive landing while this job
      // sat queued already invalidated the question it answers — discard
      // before spending a refresh on a stale generation.
      if (archiveGeneration.get(job.leadId) !== job.gen) return;
      try {
        const result = await bounded(paseo.agents.ref(job.leadId).refresh(), signal);
        // Strict compare — also catches "archived while the refresh was in
        // flight" (undefined → 1). job.gen is always defined here (restore
        // jobs are only enqueued for tombstoned leads), so the compare
        // rejects both a queued-time and a mid-flight archive.
        if (archiveGeneration.get(job.leadId) !== job.gen) return;
        const agent = result?.agent;
        if (!agent || agent.archivedAt !== null || agent.status === "closed" || !isSlpLead(agent.provider)) return;
        archiveGeneration.delete(job.leadId);
      } catch { /* stays tombstoned — visibility gap recorded on next view */ }
      return;
    }
    if (job.t === "verify-peer") {
      if (paseo === undefined) return;
      // Enqueue-time generation check: an archive landing while this job
      // sat queued already invalidated the question it answers — discard
      // before spending a refresh on a stale generation. Tombstoned peers
      // enqueued with their CURRENT generation may still restore through
      // this job — that is the refresh-verified self-heal path, not an
      // old event claiming membership.
      if (archiveGeneration.get(job.peerId) !== job.gen) return;
      try {
        const result = await bounded(paseo.agents.ref(job.peerId).refresh(), signal);
        // Post-await strict compare — an archive landing mid-refresh
        // discards the verification too; a raced live-looking snapshot
        // must never admit an agent that is tombstoned again.
        if (archiveGeneration.get(job.peerId) !== job.gen) return;
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
          messageIds: { brief: null, handback: null, sendCallIds: [], sendTurnIds: [] },
          state: "unknown", reason: VISIBILITY.recipientRefreshFailed,
          visibility: [VISIBILITY.recipientRefreshFailed],
          counts: { roomMessages: 0, uncertainRoomMessages: 0, otherRoomMessages: 0, reportMessages: 0, peerSends: 0 },
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
          messageIds: { brief: null, handback: null, sendCallIds: [], sendTurnIds: [] },
          state: "unknown", reason: VISIBILITY.caseCeiling,
          visibility: [VISIBILITY.caseCeiling],
          counts: { roomMessages: 0, uncertainRoomMessages: 0, otherRoomMessages: 0, reportMessages: 0, peerSends: 0 },
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
        roomMessages: [], uncertainRoomMessages: [], otherRoomMessages: [],
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
        evidenceVersion: 0,
        gatedReason: null,
        disposition: "observed",
        assessments: 0,
        observedAt: now(),
        lastAssessment: null,
      };
      // 64 KiB of SERIALIZED bytes — JS string length counts UTF-16 code
      // units, so multibyte text would slip past a `.length` check.
      if (Buffer.byteLength(JSON.stringify(buildEvidencePayload(item, route)), "utf8") > MAX_EVIDENCE_BYTES) {
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
      // A tombstoned recipient is archived on local evidence — never admit
      // it via a stale peers entry, and never refresh a stale-generation id
      // (spec: "Archive generations invalidate pending work and block old
      // turns from restoring an archived agent").
      let leadOfRecipient = tombstoned(send.recipient) ? undefined : peers.get(send.recipient);
      if (leadOfRecipient === undefined && lastPaseo !== undefined) {
        if (tombstoned(send.recipient)) {
          newFlags.add(VISIBILITY.recipientInactive);
          continue;
        }
        const gen = archiveGeneration.get(send.recipient);
        try {
          const result = await bounded(lastPaseo.agents.ref(send.recipient).refresh(), signal);
          // Post-await generation compare — an archive landing mid-refresh
          // makes the returned snapshot stale; treat it as refresh failure,
          // never admit the send.
          if (archiveGeneration.get(send.recipient) !== gen) {
            newFlags.add(VISIBILITY.recipientRefreshFailed);
            continue;
          }
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
        // The drain suspended on that await — if the gate went down during
        // it, every case was already flagged capture-paused and cleared;
        // a send observed now cannot append a fresh body post-gate-down.
        if (!captureAllowed()) continue;
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
      // One chronology rule for EVERY send class (spec §Observation point
      // 5: "A Lead send is subsequent handling only when its matching
      // non-null turn-start event was observed strictly after the Peer
      // handback"). A qualifying send to THIS case's Peer is the repair
      // lane; to another verified direct Peer it is room activity
      // (drift-supporting, never handling); to the route Supervisor it is
      // the separate report class. ANY non-qualifying send — regardless of
      // recipient — lands in the uncertain lane: ambiguous chronology can
      // never count as handling or as drift support.
      let mutated = false;
      for (const [recipient, list] of roomFor) {
        if (list.length === 0) continue;
        mutated = true;
        if (qualifies) {
          (recipient === item.peerId ? item.evidence.roomMessages : item.evidence.otherRoomMessages).push(...list);
        } else {
          item.evidence.uncertainRoomMessages.push(...list);
        }
      }
      if (uncertain.length > 0) {
        mutated = true;
        item.evidence.uncertainRoomMessages.push(
          ...uncertain.map(s => ({ callId: s.callId, turnId: event.turnId, recipient: s.recipient, prompt: s.prompt })),
        );
      }
      if (reports.length > 0) {
        mutated = true;
        (qualifies ? item.evidence.reportMessages : item.evidence.uncertainRoomMessages).push(...reports);
      }
      for (const flag of newFlags) {
        if (!item.evidence.flags.includes(flag)) { item.evidence.flags.push(flag); mutated = true; }
      }
      // Every applied mutation bumps the case's evaluation basis — an
      // in-flight assessment must not accept against stale evidence
      // (spec: "New evidence arriving during an assessment invalidates
      // that assessment").
      if (mutated) { item.evidenceVersion += 1; item.dirty = true; }
      recordRing(item, item.disposition, item.gatedReason);
    }
  }

  const clearBodies = (item: Case): void => {
    item.evidence.brief = item.evidence.brief === null ? null : { text: "", messageId: item.evidence.brief.messageId, flags: item.evidence.brief.flags };
    item.evidence.handback = item.evidence.handback === null ? null : { text: "", messageId: item.evidence.handback.messageId };
    for (const lane of [item.evidence.roomMessages, item.evidence.uncertainRoomMessages, item.evidence.otherRoomMessages, item.evidence.reportMessages, item.evidence.peerSends]) {
      for (const message of lane) message.prompt = "";
    }
    // Body loss changes the evaluation basis — an in-flight assessment
    // built on the pre-clear payload is stale and must be discarded.
    item.evidenceVersion += 1;
  };

  // --- evaluation -----------------------------------------------------------

  async function evaluateCase(item: Case): Promise<void> {
    const route = shadowRoutes().get(item.leadId);
    if (route === undefined) { closeCase(item, "unknown", "route-removed"); return; }
    const gate = jevGate();
    if (!gate.ok) {
      // A failed gate pauses the route: record the reason, drop every
      // captured body, keep the metadata-only ring row (spec: "does not
      // retain new message bodies or spend on assessments while delivery is
      // impossible"). The case closes unknown — evidence already cleared
      // can never support a later judgment anyway.
      routeReasons.set(item.leadId, gate.reason);
      clearBodies(item);
      item.disposition = "unknown";
      closeCase(item, "unknown", gate.reason);
      return;
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
    // and is surfaced, never treated as drift. An id already tombstoned is
    // archived on local evidence — close on the archive boundary without
    // spending a refresh on a stale generation (same rule as the send-loop
    // recipient path: archive generations "block old turns from restoring
    // an archived agent").
    if (tombstoned(item.leadId)) { clearBodies(item); closeCase(item, "unknown", "lead-archived"); return; }
    if (tombstoned(item.peerId)) { clearBodies(item); closeCase(item, "unknown", "peer-archived"); return; }
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
    // Archive-generation re-check after the await: onArchived tombstones
    // synchronously at hook time, so an archive landing while this refresh
    // was in flight is already visible here even though its job is still
    // queued behind this evaluation. A snapshot returned for a stale
    // generation is never trusted — close on the archive boundary (spec:
    // "Archive generations invalidate pending work").
    if (tombstoned(item.leadId)) { clearBodies(item); closeCase(item, "unknown", "lead-archived"); return; }
    if (tombstoned(item.peerId)) { clearBodies(item); closeCase(item, "unknown", "peer-archived"); return; }
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
    const payload = buildEvidencePayload(item, route);
    const gateReason = localGate(payload);
    if (gateReason !== null) {
      item.gatedReason = gateReason;
      item.disposition = "unknown";
      if (!item.evidence.flags.includes(gateReason)) item.evidence.flags.push(gateReason);
      closeCase(item, "unknown", gateReason);
      return;
    }
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_EVIDENCE_BYTES) {
      item.gatedReason = VISIBILITY.evidenceOversize;
      item.disposition = "unknown";
      closeCase(item, "unknown", VISIBILITY.evidenceOversize);
      return;
    }
    // Stale-detection: evidence arriving during the assessment invalidates
    // it before any conclusion is stored (spec: "invalidates the assessment
    // before delivery"). Two generations: `version` covers evidence still
    // QUEUED (enqueue bumps); `item.evidenceVersion` covers in-place
    // mutations that never enqueue (gate-down, queue-overflow marks, lane
    // pushes, body clears, pending-elapsed flips).
    const pre = version;
    const preEvidence = item.evidenceVersion;
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
    if (version !== pre || item.evidenceVersion !== preEvidence) {
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
          leadBrief: { choice: assessment.answers.leadBrief.choice, confidence: assessment.answers.leadBrief.confidence },
          peerHandback: { choice: assessment.answers.peerHandback.choice, confidence: assessment.answers.peerHandback.confidence },
          leadHandling: { choice: assessment.answers.leadHandling.choice, confidence: assessment.answers.leadHandling.confidence },
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
          item.evidenceVersion += 1;
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

  /** Test/diagnostic seam — count of non-empty body fields one open case
   *  still retains (brief, handback, lane prompts). Count only, never
   *  content, so the privacy invariant "gate-down empties retained bodies
   *  at detection" stays assertable without exposing bodies. */
  function retainedBodies(fingerprint: string): number | null {
    const item = cases.get(fingerprint);
    if (item === undefined) return null;
    let n = 0;
    if (item.evidence.brief !== null && item.evidence.brief.text !== "") n += 1;
    if (item.evidence.handback !== null && item.evidence.handback.text !== "") n += 1;
    for (const lane of [
      item.evidence.roomMessages, item.evidence.uncertainRoomMessages,
      item.evidence.otherRoomMessages, item.evidence.reportMessages, item.evidence.peerSends,
    ]) {
      for (const message of lane) if (message.prompt !== "") n += 1;
    }
    return n;
  }

  return { onCreated, onArchived, onStart, onTurn, shadow, stop, idle, retainedBodies, signal };
}

export type SupervisionObserver = ReturnType<typeof createSupervisionObserver>;
