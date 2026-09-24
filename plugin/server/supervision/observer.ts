// plugin/server/supervision/observer.ts — Phase B shadow observer.
// Spec: docs/spec/supervision-integration.md §Observation, §Shadow evidence,
// §Failure and privacy boundaries.
//
// Lifecycle hooks do the minimum synchronously (normalize + enqueue) and
// return; everything async — SDK refresh, Jev HTTP, persistence — runs in a
// single serialized queue owned by the plugin process. Archive events tombstone
// agent ids so a late event from the old generation cannot re-enter. A
// monotonic callback-order counter stamps every observation; Lead handling is
// provable when a matching non-null turn-start landed strictly after the
// Peer's handback — or, when no usable start reached this observer instance
// (plugin reload clears the in-memory start maps, lifecycle hook RPC timeouts
// drop calls, gate pauses drop starts at the hook — all observed on host
// 0.9.1), when the handback's own delivery is present inside the ended turn's
// timeline. The end-derived path only reads ordering the event itself records;
// it never fabricates a start, and whatever it cannot prove stays uncertain.
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
import { capture, handbackAnchorIndex, VISIBILITY } from "./capture.ts";
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
   *  pending-elapsed flips). The per-lead `enqPending` counter covers
   *  evidence still QUEUED; this counter covers in-place mutations that
   *  never pass an enqueue (gate-down, queue-overflow marks, lane pushes).
   *  An in-flight Jev ask compares it at accept-time — spec: "New
   *  evidence arriving during an assessment invalidates that
   *  assessment." */
  evidenceVersion: number;
  /** Internal correlation data, never shipped to Jev: prompt bodies this
   *  case's Peer addressed to the bound Lead (confirmed AND unconfirmed —
   *  an unconfirmed send's parsed prompt appearing verbatim in the Lead's
   *  own timeline still proves that content arrived). Feeds the end-only
   *  chronology anchor; cleared with every other body. */
  peerLeadPrompts: string[];
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
  | { t: "tick"; order: number; leadId: null }
  // leadGen/peerGen = archive generations AT ENQUEUE — an archive→restore
  // crossing the queue is invisible to the tombstone flag (restore clears
  // it) but bumps the monotonic generation, so the compare at apply is
  // ABA-safe. peerGen is undefined for lead events (they fan out to every
  // open case — each case's peer is checked per-case instead).
  | { t: "turn-end"; order: number; leadId: string; leadGen: number | undefined; peerGen: number | undefined; capture: Capture; startSeq: number | null; overlap: boolean }
  // gens = archive generations AT ENQUEUE — a queued verification answers
  // a question asked at hook time; an archive landing before the job
  // executes already changed the generation, so the job must discard
  // itself before spending a refresh (spec §Observation: "Archive
  // generations invalidate pending work"). Generations are MONOTONIC —
  // never reset on restore — so a stale job from an older archive era can
  // never alias a newer one.
  | { t: "verify-peer"; order: number; leadId: string; peerId: string; peerGen: number | undefined; leadGen: number | undefined }
  | { t: "restore-lead"; order: number; leadId: string; gen: number | undefined }
  | { t: "archive"; order: number; leadId: string | null; agent: PluginHookAgent };

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
  /** Test seams — default to the real Jev module / local gate. `localGate`
   *  exists so the suspension-site matrix can reach the Jev-ask await on
   *  this host, where every real capture carries
   *  `report-route-unverifiable` and local gating closes before the ask. */
  gate?: (stableRoot: string) => SupervisionGate;
  ask?: typeof askJevDecision;
  localGate?: (evidence: EvidencePayload) => string | null;
  httpTimeoutMs?: number;
}

export function createSupervisionObserver(deps: ObserverDeps) {
  const stableRoot = deps.stableRoot;
  const now = () => (deps.now ?? Date.now)();
  const uuid = deps.uuid ?? randomUUID;
  const gateOf = deps.gate ?? resolveSupervision;
  const ask = deps.ask ?? askJevDecision;
  const evidenceGate = deps.localGate ?? localGate;
  const httpTimeoutMs = deps.httpTimeoutMs ?? HTTP_TIMEOUT_MS;

  const abort = new AbortController();
  const signal = abort.signal;
  const outerSignal = deps.signal;
  if (outerSignal !== undefined) {
    if (outerSignal.aborted) abort.abort();
    else outerSignal.addEventListener("abort", () => abort.abort(), { once: true });
  }

  let order = 0;                    // monotonic callback-order counter
  let version = 0;                  // bumped on every enqueue — drain scheduling only; per-lead enqPending is the eval basis
  let running = false;
  let stopped = false;
  const jobs: Job[] = [];
  const cases = new Map<string, Case>();
  const seen = new Set<string>();               // capture fingerprint dedup
  const sentCalls = new Set<string>();          // leadId\0callId send dedup
  const peers = new Map<string, string>();      // verified peerId → leadId
  // Archive dimension is split in two: `archiveGen` is a MONOTONIC counter
  // per id — bumped on every archive hook, never deleted. `archivedNow`
  // holds the tombstone flag a restore clears. A reset-on-restore counter
  // would alias generations across archive eras (ABA): a job queued in
  // era 1 could "match" era 2's fresh 1 and un-tombstone a live archive.
  const archiveGen = new Map<string, number>();
  const archivedNow = new Set<string>();
  // Per-lead count of enqueued-not-applied jobs — the queued-evidence
  // dimension of an evaluation basis. Global `version` stays for drain
  // scheduling only; per-lead scoping keeps unrelated-lead churn from
  // discarding a paid assessment.
  const enqPending = new Map<string, number>();
  // Bumped on every OBSERVED gate-down edge — part of every evaluation
  // basis, so a down→up flip inside an await (invisible to a re-read,
  // which sees "ok" again) still invalidates work whose gather spanned
  // the purge.
  let purgeCount = 0;
  let gateWasDown = false;
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

  // The ONE gate-down reaction — every detection point funnels through
  // observeGate(). Purge = flag `capture-paused` + clear bodies on EVERY
  // open case + scrub bodies still sitting in queued turn-end captures
  // (`jobs[]` is a retention store the case loop cannot reach) + bump
  // `purgeCount` so a later down→up edge cannot alias the basis of work
  // whose gather spanned this purge.
  const onGateDown = (): void => {
    purgeCount += 1;
    // Start bookkeeping purges with everything else: a turn whose start
    // was recorded pre-pause but whose end is dropped inside the pause
    // would orphan its openTurns/leadStarts/startMeta entries and poison
    // the NEXT start (overlap → lead-start-unmatched). Chronology across
    // a paused window is untrusted — post-recovery turns whose starts are
    // gone resolve conservatively to the uncertain lane.
    openTurns.clear();
    leadStarts.clear();
    startMeta.clear();
    for (const item of cases.values()) {
      if (!item.evidence.flags.includes(VISIBILITY.capturePaused)) item.evidence.flags.push(VISIBILITY.capturePaused);
      // clearBodies bumps evidenceVersion — an in-flight assessment must
      // discard at accept-time.
      clearBodies(item);
      item.dirty = true;
      recordRing(item, item.disposition, item.gatedReason);
    }
    for (const job of jobs) {
      if (job.t === "turn-end") scrubCaptureBodies(job.capture);
    }
  };

  /** The single gate read — any observation of a down edge runs the global
   *  purge, no matter which caller saw it first. Detection points (hook,
   *  job-top, send-loop, evaluation, pre-ask, views) all share the same
   *  reaction instead of each carrying a local approximation of it. */
  const observeGate = (): SupervisionGate => {
    const gate = jevGate();
    if (gate.ok) {
      gateWasDown = false;
      return gate;
    }
    if (!gateWasDown) {
      gateWasDown = true;
      onGateDown();
    }
    return gate;
  };

  const captureAllowed = (): boolean => observeGate().ok;

  /** Metadata survives a purge; bodies do not. Scrubbing also stamps the
   *  capture's flags so a case created after gate recovery still records
   *  the purge window on its observation row. */
  const scrubCaptureBodies = (captured: Capture): void => {
    if (!captured.flags.includes(VISIBILITY.capturePaused)) captured.flags.push(VISIBILITY.capturePaused);
    if (captured.kind === "peer") {
      captured.brief = { text: "", messageId: captured.brief.messageId };
      if (captured.handback !== null) captured.handback = { text: "", messageId: captured.handback.messageId };
    }
    for (const send of captured.sends) send.prompt = "";
    for (const send of captured.uncertainSends) send.prompt = "";
    if (captured.kind === "lead") {
      for (const anchor of captured.anchors) anchor.text = "";
    }
  };

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

  const tombstoned = (id: string): boolean => archivedNow.has(id);

  /** The lead whose state a job can mutate — the queued-evidence basis
   *  dimension. Null for lead-agnostic work (tick) or an archive whose
   *  peer membership was already swept before enqueue resolved it. */
  const jobLead = (job: Job): string | null => job.leadId;
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
      // generations invalidate pending work"). The job carries BOTH
      // generations — an archived lead cannot adopt a peer, and a peer
      // archived while the job sits queued is a stale question.
      enqueue({
        t: "verify-peer", order: ++order, leadId: agent.parentAgentId, peerId: agent.id,
        peerGen: archiveGen.get(agent.id), leadGen: archiveGen.get(agent.parentAgentId),
      });
      return;
    }
    if (isSlpLead(agent.provider) && routes.has(agent.id) && tombstoned(agent.id)) {
      enqueue({ t: "restore-lead", order: ++order, leadId: agent.id, gen: archiveGen.get(agent.id) });
    }
  }

  function onArchived(agent: PluginHookAgent, paseo: PaseoApi): void {
    if (signal.aborted) return;
    lastPaseo = paseo;
    // Tombstone + generation bump are synchronous so a late event cannot
    // re-enter. The generation is MONOTONIC — a restore clears only the
    // `archivedNow` flag, so a stale queued job can never alias a newer
    // archive era.
    archiveGen.set(agent.id, (archiveGen.get(agent.id) ?? 0) + 1);
    archivedNow.add(agent.id);
    // Enqueue BEFORE the peers sweep so the job resolves its lead
    // dimension while the membership entry still exists.
    enqueue({
      t: "archive", order: ++order, agent,
      leadId: isSlpLead(agent.provider) ? agent.id : peers.get(agent.id) ?? null,
    });
    // The body purge CANNOT ride the queued job — a queue-full drop would
    // leave bodies retained until expiry. Synchronously: drop the archived
    // id's membership, every peers entry pointing at an archived lead, and
    // every body of cases touching the archived id (≤ MAX_CASES — bounded,
    // and the evidenceVersion bump invalidates any in-flight ask). The
    // queued job only does bookkeeping (ring close).
    peers.delete(agent.id);
    for (const [peerId, leadId] of peers) if (leadId === agent.id) peers.delete(peerId);
    if (isSlpLead(agent.provider)) routeReasons.set(agent.id, "lead-archived");
    for (const item of cases.values()) {
      if (item.leadId === agent.id || item.peerId === agent.id) {
        clearBodies(item);
        item.dirty = true;
      }
    }
    for (const key of leadStarts.keys()) if (key.startsWith(`${agent.id}\0`)) leadStarts.delete(key);
    for (const key of startMeta.keys()) if (key.startsWith(`${agent.id}\0`)) startMeta.delete(key);
    openTurns.delete(agent.id);
  }

  function onStart(event: TurnStarted): void {
    if (signal.aborted) return;
    // A start inside a paused window is never recorded — its end will be
    // dropped at the hook anyway, and the entry would orphan into
    // overlap/unmatched pollution for the next clean turn.
    if (!observeGate().ok) return;
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
      // observeGate already ran the ONE global purge (all open cases
      // flagged capture-paused + bodies cleared + queued captures
      // scrubbed — spec §Configuration: a failed gate "does not retain new
      // message bodies or spend on assessments while delivery is
      // impossible"; the Jev gate is daemon-global, not lead-scoped).
      // This event contributes no evidence — record the drop so the
      // paused window is inspectable.
      diagnostics.droppedEvents += 1;
      diag(VISIBILITY.capturePaused);
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
      enqueue({ t: "restore-lead", order: ++order, leadId, gen: archiveGen.get(leadId) });
      return; // the capture is dropped — a pre-restore turn cannot be trusted
    }
    if (!isLeadEvent) {
      if (!isSlpPeer(event.agent.provider)) return;
      // A peer event inside the lead's dead window cannot be trusted —
      // its membership was swept at the archive boundary and a
      // restore-lead may re-admit it on the next live turn.
      if (tombstoned(leadId)) { diag("lead-archived"); return; }
      if (tombstoned(event.agent.id)) {
        // A turn event while the peer is tombstoned cannot open a case —
        // the capture is dropped (archive generations "block old turns
        // from restoring an archived agent") and a verify job re-checks
        // live parentage before any future admission. The dropped capture
        // is recorded in diagnostics rather than the ring: writing a row
        // for a stale-generation peer would fabricate an observation for a
        // turn the archive boundary already invalidated.
        diag("peer-archived");
        enqueue({
          t: "verify-peer", order: ++order, leadId, peerId: event.agent.id,
          peerGen: archiveGen.get(event.agent.id), leadGen: archiveGen.get(leadId),
        });
        return;
      }
      if (peers.get(event.agent.id) !== leadId) {
        enqueue({
          t: "verify-peer", order: ++order, leadId, peerId: event.agent.id,
          peerGen: archiveGen.get(event.agent.id), leadGen: archiveGen.get(leadId),
        });
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
      t: "turn-end", order: seq, leadId: captured.leadId, capture: captured,
      leadGen: archiveGen.get(captured.leadId),
      peerGen: captured.kind === "peer" ? archiveGen.get(captured.peerId) : undefined,
      startSeq: captured.kind === "lead" ? meta?.seq ?? null : null,
      overlap: captured.kind === "lead" ? meta?.overlapped ?? false : false,
    });
  }

  // --- queue machinery ------------------------------------------------------

  function enqueue(job: Job): void {
    if (signal.aborted) return;
    // Invalidation precedes the drop decision — a queue-full drop still
    // means "an event existed that no evaluation basis may ignore": the
    // global version re-arms drain scheduling, the per-lead pending
    // counter keeps every in-flight basis stale, and the overflow marks
    // below carry the per-case flags.
    version++;
    const pendingLead = jobLead(job);
    if (pendingLead !== null) enqPending.set(pendingLead, (enqPending.get(pendingLead) ?? 0) + 1);
    if (jobs.length >= MAX_QUEUE) {
      // Never lands — unwind the pending count; the overflow flags below
      // still mark affected cases through evidenceVersion.
      if (pendingLead !== null) enqPending.set(pendingLead, Math.max(0, (enqPending.get(pendingLead) ?? 1) - 1));
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
    if (!running) {
      running = true;
      queueMicrotask(() => { void drain(); });
    }
  }

  async function apply(job: Job): Promise<void> {
    const paseo = lastPaseo;
    const pendingLead = jobLead(job);
    if (pendingLead !== null) enqPending.set(pendingLead, Math.max(0, (enqPending.get(pendingLead) ?? 1) - 1));
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
      // Bookkeeping only — the tombstone, peers sweep, and body purge all
      // ran synchronously in onArchived (a dropped job can never leave
      // bodies retained). What remains is the ring close per case.
      const { agent } = job;
      if (isSlpLead(agent.provider)) {
        for (const [, item] of cases) if (item.leadId === agent.id) {
          clearBodies(item);
          closeCase(item, "unknown", "lead-archived");
        }
      } else {
        for (const [, item] of cases) if (item.peerId === agent.id) {
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
      if (archiveGen.get(job.leadId) !== job.gen) return;
      try {
        const result = await bounded(paseo.agents.ref(job.leadId).refresh(), signal);
        // Strict compare — also catches "archived while the refresh was in
        // flight". Generations are monotonic, so an era-1 job can never
        // alias era 2 (ABA-safe).
        if (archiveGen.get(job.leadId) !== job.gen) return;
        const agent = result?.agent;
        if (!agent || agent.archivedAt !== null || agent.status === "closed" || !isSlpLead(agent.provider)) return;
        archivedNow.delete(job.leadId);
      } catch { /* stays tombstoned — visibility gap recorded on next view */ }
      return;
    }
    if (job.t === "verify-peer") {
      if (paseo === undefined) return;
      // Both generations were sampled at enqueue — an archived lead cannot
      // adopt a peer (the membership would feed a dead lead's cases), and
      // a peer archived while the job sat queued is a stale question.
      // A tombstoned lead at commit time rejects regardless of the gen
      // compare — the tombstone flag, not the era, is what blocks.
      if (archiveGen.get(job.peerId) !== job.peerGen ||
          archiveGen.get(job.leadId) !== job.leadGen ||
          archivedNow.has(job.leadId)) return;
      try {
        const result = await bounded(paseo.agents.ref(job.peerId).refresh(), signal);
        // Post-await strict compare on BOTH ids — an archive landing
        // mid-refresh discards the verification; a raced live-looking
        // snapshot must never admit an agent that is tombstoned again.
        if (archiveGen.get(job.peerId) !== job.peerGen ||
            archiveGen.get(job.leadId) !== job.leadGen ||
            archivedNow.has(job.leadId)) return;
        const agent = result?.agent;
        if (!agent || agent.archivedAt !== null || agent.status === "closed" || !isSlpPeer(agent.provider)) return;
        const parent = agent.labels?.["paseo.parent-agent-id"] ?? null;
        if (parent !== job.leadId) return;
        archivedNow.delete(job.peerId);
        peers.set(job.peerId, job.leadId);
      } catch { /* unverified — subsequent turn events retry */ }
      return;
    }
    // turn-end
    const event = job.capture;
    // Job-top fail-closed: a gate-down edge observed here already ran the
    // global purge — and this job's queued capture was body-scrubbed by it.
    // The event contributes no evidence, same drop semantics as the hook.
    if (!observeGate().ok) { diag(VISIBILITY.capturePaused); return; }
    // A lead archived between enqueue and apply must not grow a case —
    // the archive's synchronous purge already ran; the queued job closes
    // the rows. The generation compare also catches archive→restore: the
    // tombstone cleared on restore but the monotonic gen moved, so a turn
    // captured in the dead era is still dropped.
    if (tombstoned(event.leadId) || archiveGen.get(event.leadId) !== job.leadGen) {
      diag("lead-archived"); return;
    }
    if (event.kind === "peer") {
      if (tombstoned(event.peerId) || archiveGen.get(event.peerId) !== job.peerGen) {
        // Captured live, archived (or archived→restored) while queued —
        // record a metadata-only row so the lost observation stays
        // inspectable (an event ARRIVING tombstoned drops at the hook
        // instead, no row).
        const entries = loadRing();
        const stamp = new Date(now()).toISOString();
        entries.set(event.id, {
          fingerprint: event.id, leadAgentId: event.leadId, peerId: event.peerId,
          peerTurnId: event.turnId, observedAt: stamp, updatedAt: stamp,
          messageIds: { brief: null, handback: null, sendCallIds: [], sendTurnIds: [] },
          state: "unknown", reason: "peer-archived",
          visibility: ["peer-archived"],
          counts: { roomMessages: 0, uncertainRoomMessages: 0, otherRoomMessages: 0, reportMessages: 0, peerSends: 0 },
          assessmentsUsed: 0, lastAssessment: null,
        });
        ringDirty = true;
        persistRing();
        return;
      }
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
        peerLeadPrompts: [...event.sends, ...event.uncertainSends]
          .filter(s => s.recipient === event.leadId)
          .map(s => s.prompt)
          .filter(p => p !== ""),
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
    // callIds consumed into a lane during THIS gather — committed to
    // `sentCalls` only if the gather commits, so a discarded gather never
    // burns a call's dedup slot (a later identical capture may retry it).
    const accepted = new Set<string>();
    // Membership verified during THIS gather — staged, not committed:
    // `peers.set` inside the loop would survive a dropped gather and leak
    // a mid-gather archive's stale membership.
    const pendingPeers = new Map<string, string>();
    // The gather's own basis: a purge landing mid-gather invalidates every
    // lane assembled from pre-purge prompts.
    const purgeAt = purgeCount;
    for (const send of sends) {
      if (signal.aborted) return;
      // Per-iteration gate read — the funnel purges globally on a down
      // edge, so a send classified after a mid-loop gate-down (observed or
      // file-only) never lands a body.
      if (!observeGate().ok) { newFlags.add(VISIBILITY.capturePaused); break; }
      const callKey = `${event.leadId}\0${send.callId}`;
      if (sentCalls.has(callKey) || accepted.has(callKey)) continue;
      if (route.supervisorAgentId !== null && send.recipient === route.supervisorAgentId) {
        reports.push({ callId: send.callId, turnId: event.turnId, recipient: send.recipient, prompt: send.prompt });
        accepted.add(callKey);
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
        const gen = archiveGen.get(send.recipient);
        try {
          const result = await bounded(lastPaseo.agents.ref(send.recipient).refresh(), signal);
          if (signal.aborted) return;
          // Post-await, gate first: a mid-await gate-down already ran the
          // global purge — this prompt must not become a fresh body.
          if (!observeGate().ok) { newFlags.add(VISIBILITY.capturePaused); break; }
          // Post-await generation compare — an archive landing mid-refresh
          // makes the returned snapshot stale; treat it as refresh failure,
          // never admit the send.
          if (archiveGen.get(send.recipient) !== gen) {
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
            pendingPeers.set(send.recipient, event.leadId);
          }
        } catch {
          if (signal.aborted) return;
          newFlags.add(VISIBILITY.recipientRefreshFailed);
          continue;
        }
      }
      if (leadOfRecipient !== event.leadId) continue; // unrelated recipient — never proof
      const list = roomFor.get(send.recipient) ?? [];
      list.push({ callId: send.callId, turnId: event.turnId, recipient: send.recipient, prompt: send.prompt });
      roomFor.set(send.recipient, list);
      accepted.add(callKey);
    }
    // Commit segment — NO await between this validation and the mutations.
    // A gate-down observed here, a purge boundary crossed mid-gather, a
    // lead archive (tombstone now, or an archive→restore era change via
    // the enqueue-time gen), or a route removal/supervisor change all
    // invalidate the assembled lanes — the purge/archive already flagged
    // and cleared every affected case, so the gather is simply dropped.
    if (signal.aborted) return;
    const routeNow = shadowRoutes().get(event.leadId);
    if (!observeGate().ok || purgeCount !== purgeAt || tombstoned(event.leadId) ||
        archiveGen.get(event.leadId) !== job.leadGen ||
        routeNow === undefined || routeNow.supervisorAgentId !== route.supervisorAgentId) {
      for (const item of cases.values()) if (item.leadId === event.leadId) item.dirty = true;
      return;
    }
    // Per-recipient tombstone sweep: a recipient archived while a LATER
    // send's refresh was in flight invalidates the lane accepted earlier —
    // drop it and flag, same as the in-loop recipient-inactive path. The
    // uncertain lane follows the same rule — an unconfirmed send to an
    // agent on the archive boundary retains no body either.
    for (const recipient of roomFor.keys()) {
      if (tombstoned(recipient)) { roomFor.delete(recipient); newFlags.add(VISIBILITY.recipientInactive); }
    }
    for (let i = reports.length - 1; i >= 0; i -= 1) {
      if (tombstoned(reports[i].recipient)) { reports.splice(i, 1); newFlags.add(VISIBILITY.recipientInactive); }
    }
    const uncertainKept = uncertain.filter(send => {
      if (!tombstoned(send.recipient)) return true;
      newFlags.add(VISIBILITY.recipientInactive);
      return false;
    });
    // Verified memberships commit only inside the guard — and only for
    // recipients still outside the tombstone set.
    for (const [id, lead] of pendingPeers) if (!tombstoned(id)) peers.set(id, lead);
    for (const callKey of accepted) sentCalls.add(callKey);
    const startProven = job.startSeq !== null && !job.overlap;
    for (const item of cases.values()) {
      if (item.leadId !== event.leadId) continue;
      // A case-peer archived mid-gather sits on the archive boundary —
      // onArchived already purged its bodies; appending lanes now would
      // resurrect bodies the boundary invalidated.
      if (tombstoned(item.peerId)) continue;
      const startQualifies = startProven && (job.startSeq as number) > item.handbackOrder;
      // End-only fallback (spec §Observation point 5): when no usable
      // turn-start is on record — reload erased the start maps, the hook
      // RPC timed out, or a gate pause dropped it — the ended turn's own
      // timeline can still prove ordering: the user_message that delivered
      // THIS case's handback (finish-notification envelope or verbatim
      // report prompt) precedes every extracted send. A scrubbed anchor or
      // cleared prompt simply cannot match — the fallback never invents
      // evidence and never fabricates a start timestamp.
      const endDerived = handbackAnchorIndex(
        event.anchors, item.peerId,
        item.evidence.handback?.text ?? null, item.peerLeadPrompts,
      ) >= 0;
      const qualifies = startQualifies || endDerived;
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
      if (uncertainKept.length > 0) {
        mutated = true;
        item.evidence.uncertainRoomMessages.push(
          ...uncertainKept.map(s => ({ callId: s.callId, turnId: event.turnId, recipient: s.recipient, prompt: s.prompt })),
        );
      }
      if (reports.length > 0) {
        mutated = true;
        (qualifies ? item.evidence.reportMessages : item.evidence.uncertainRoomMessages).push(...reports);
      }
      for (const flag of newFlags) {
        if (!item.evidence.flags.includes(flag)) { item.evidence.flags.push(flag); mutated = true; }
      }
      // Per-case chronology flags: unmatched start stays a blocking gap
      // only when neither path proved ordering; an end-derived proof is
      // recorded honestly instead (informational, never a gate reason).
      const chronFlag = !qualifies ? VISIBILITY.leadStartUnmatched
        : !startQualifies ? VISIBILITY.leadStartEndDerived
        : null;
      if (chronFlag !== null && !item.evidence.flags.includes(chronFlag)) {
        item.evidence.flags.push(chronFlag);
        mutated = true;
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
    item.peerLeadPrompts = [];
    // Body loss changes the evaluation basis — an in-flight assessment
    // built on the pre-clear payload is stale and must be discarded.
    item.evidenceVersion += 1;
  };

  // --- evaluation -----------------------------------------------------------

  async function evaluateCase(item: Case): Promise<void> {
    const route = shadowRoutes().get(item.leadId);
    if (route === undefined) { closeCase(item, "unknown", "route-removed"); return; }
    const gate = observeGate();
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

    // Evaluation basis — sampled BEFORE the first await so every
    // dimension's invalidation window covers the whole suspension (spec:
    // "New evidence arriving during an assessment invalidates that
    // assessment"). Dimensions:
    //   pending    — this lead's enqueued-not-applied jobs. Per-LEAD
    //                scoping (not the global queue version): an unrelated
    //                lead's enqueue or a tick must not discard a paid
    //                assessment of THIS case.
    //   evidence   — in-place case mutations (lane pushes, body clears,
    //                flag adds, pending-elapsed flips).
    //   leadGen / peerGen — monotonic archive generations.
    //   purge      — observed gate-down edges; closes the down→up ABA that
    //                a gate re-read cannot see.
    //   routeStamp / gateStamp — the config files can flip without any
    //                event reaching this observer.
    const basis = {
      pending: enqPending.get(item.leadId) ?? 0,
      evidence: item.evidenceVersion,
      leadGen: archiveGen.get(item.leadId),
      peerGen: archiveGen.get(item.peerId),
      purge: purgeCount,
      routeStamp: routesCache?.stamp ?? "-",
      gateStamp: gateCache?.stamp ?? "-",
    };
    // Evidence inbound for this lead — defer rather than assess a
    // snapshot the queue is about to change.
    if (basis.pending !== 0) { item.dirty = true; return; }
    // Refreshes the file-stamp caches so a config rewrite inside any
    // suspension still invalidates. Gate SEMANTICS are bracketed by the
    // observeGate calls at each checkpoint — a down edge purges globally
    // before any compare runs.
    const basisStale = (): boolean => {
      shadowRoutes();
      jevGate();
      return (enqPending.get(item.leadId) ?? 0) !== basis.pending ||
        item.evidenceVersion !== basis.evidence ||
        archiveGen.get(item.leadId) !== basis.leadGen ||
        archiveGen.get(item.peerId) !== basis.peerGen ||
        purgeCount !== basis.purge ||
        (routesCache?.stamp ?? "-") !== basis.routeStamp ||
        (gateCache?.stamp ?? "-") !== basis.gateStamp;
    };

    let leadSnap, peerSnap;
    try {
      [leadSnap, peerSnap] = await Promise.all([
        bounded(paseo.agents.ref(item.leadId).refresh(), signal),
        bounded(paseo.agents.ref(item.peerId).refresh(), signal),
      ]);
    } catch {
      if (signal.aborted) return;
      item.disposition = "unknown";
      recordRing(item, "unknown", VISIBILITY.recipientRefreshFailed);
      ringDirty = true;
      return;
    }
    if (signal.aborted) return;
    // Post-await archive re-check: onArchived tombstones synchronously at
    // hook time, so an archive landing mid-refresh is visible here even
    // though its job is still queued behind this evaluation. A snapshot
    // returned for a stale generation is never trusted — close on the
    // archive boundary (spec: "Archive generations invalidate pending
    // work").
    if (tombstoned(item.leadId)) { clearBodies(item); closeCase(item, "unknown", "lead-archived"); return; }
    if (tombstoned(item.peerId)) { clearBodies(item); closeCase(item, "unknown", "peer-archived"); return; }
    // A gate-down edge during the refresh already ran the global purge —
    // this case included. Close unknown with the gate reason rather than
    // assessing a cleared payload.
    const gateMid = observeGate();
    if (!gateMid.ok) {
      routeReasons.set(item.leadId, gateMid.reason);
      item.disposition = "unknown";
      closeCase(item, "unknown", gateMid.reason);
      return;
    }
    // Route presence before the generic basis compare — a removed route
    // closes with its own reason instead of discarding into a deferred
    // re-evaluation that would close on it anyway one pass later.
    if (shadowRoutes().get(item.leadId) === undefined) { closeCase(item, "unknown", "route-removed"); return; }
    if (basisStale()) { item.dirty = true; return; }
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
    // Re-resolve the route for the payload — the bound supervisor id is
    // part of the evidence contract and may have changed mid-refresh.
    const routeNow = shadowRoutes().get(item.leadId);
    if (routeNow === undefined) { closeCase(item, "unknown", "route-removed"); return; }
    const payload = buildEvidencePayload(item, routeNow);
    const gateReason = evidenceGate(payload);
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
    // Spec: "Before every prompt, re-read the gates and refresh the
    // recipient" — recipients were refreshed above; the gate is re-read
    // NOW, immediately before the spend, and the freshly read object is
    // what the ask uses. The final basis validation sits in the same
    // synchronous segment as `assessments += 1` — no await can slip
    // between validation and spend.
    const gateNow = observeGate();
    if (!gateNow.ok) {
      routeReasons.set(item.leadId, gateNow.reason);
      item.disposition = "unknown";
      closeCase(item, "unknown", gateNow.reason);
      return;
    }
    if (basisStale()) { item.dirty = true; return; }
    item.assessments += 1;
    let assessment: { answers: AssessmentAnswers; model: string; usage: { input_tokens: number; output_tokens: number } | null } | null = null;
    let failed = "jev-request-failed";
    try {
      const envelope = await ask(gateNow.provider, gateNow.authorization, {
        state: payload,
        questions: SUPERVISION_QUESTIONS,
      }, { timeoutMs: httpTimeoutMs, signal });
      const parsed = parseAssessmentResponse(envelope.raw, gateNow.provider);
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
    // Post-ask revalidation, ordered so the most precise close reason wins:
    // a down edge purges (and explains itself), a removed route closes
    // route-removed, an archive closes on its boundary, and any remaining
    // basis drift discards the paid-for assessment (the spend is still
    // counted — the ceiling exists to bound calls, not verdicts).
    const gateAfter = observeGate();
    if (!gateAfter.ok) {
      routeReasons.set(item.leadId, gateAfter.reason);
      item.disposition = "unknown";
      closeCase(item, "unknown", gateAfter.reason);
      return;
    }
    if (shadowRoutes().get(item.leadId) === undefined) { closeCase(item, "unknown", "route-removed"); return; }
    if (tombstoned(item.leadId)) { clearBodies(item); closeCase(item, "unknown", "lead-archived"); return; }
    if (tombstoned(item.peerId)) { clearBodies(item); closeCase(item, "unknown", "peer-archived"); return; }
    if (basisStale()) {
      // Evidence/config changed mid-flight — discard; the newer batch
      // re-arms dirty and the case re-evaluates on the next drain pass.
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
      enqueue({ t: "tick", order: ++order, leadId: null });
    }, Math.max(0, next - now()));
  }

  // --- surface ---------------------------------------------------------------

  /** get-supervision extras for the served home — metadata only. */
  function shadow(targetStableRoot: string) {
    if (targetStableRoot !== stableRoot) return null;
    const entries = [...loadRing().values()]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const gates: Record<string, string | null> = {};
    // A view that observes a down edge is a detection point like any
    // other — the funnel runs the same global purge.
    const gate = observeGate();
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
    enqPending.clear();
    archivedNow.clear();
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
    n += item.peerLeadPrompts.length;
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
