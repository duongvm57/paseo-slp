// plugin/server/supervision/capture.ts — provider-aware extraction of the
// minimal communication boundary from agent.turn_ended timelines
// (spec docs/spec/supervision-integration.md §Observation and correlation).
//
// Structure informed by hoangnb24/paseo-supervision server/communication.ts
// @ 1bad19b8ee6c58482494f56a3d8c6edb4f969ee1 (Apache-2.0) — the correlation
// idea (latest user_message boundary, confirmed-send evidence) is adapted;
// the per-family send extraction is SLP-specific, driven by the sanitized
// fixtures in tests/fixtures/supervision/. A family whose normalized shape
// has no passing fixture produces `unsupported-family` — never a guess.
//
// Every uncertainty is an explicit visibility flag; nothing here throws.
import { createHash } from "node:crypto";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHookAgent, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { z } from "zod";
import { familyFromProviderId } from "../../shared/families.ts";
import type { FamilyId } from "../../shared/families.ts";
import { isSlpLead, isSlpPeer } from "../../shared/supervision.ts";

export type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];
export type TurnStarted = PluginLifecycleEvents["agent.turn_started"];

// Bounded visibility-flag vocabulary (wire-visible in the observations list
// — reason codes only, never message text).
export const VISIBILITY = {
  unsupportedFamily: "unsupported-family",
  briefAssignmentFile: "brief-references-assignment-file",
  briefSourceAmbiguous: "brief-source-ambiguous",
  peerTurnNotCompleted: "peer-turn-not-completed",
  leadTurnNotCompleted: "lead-turn-not-completed",
  sendNotCompleted: "send-not-completed",
  sendInputUnparsed: "send-input-unparsed",
  sendResultUnobservable: "send-result-unobservable",
  sendResultUnsuccessful: "send-result-unsuccessful",
  recipientRefreshFailed: "recipient-refresh-failed",
  recipientInactive: "recipient-inactive",
  leadStartUnmatched: "lead-start-unmatched",
  reportRouteUnverifiable: "report-route-unverifiable",
  familyShapeUnverified: "family-shape-unverified",
  noCommunication: "no-observable-communication",
  capturePaused: "capture-paused",
  queueOverflow: "queue-overflow",
  caseCeiling: "case-ceiling",
  evidenceOversize: "evidence-oversize",
  assessmentCeiling: "assessment-ceiling",
  caseExpired: "case-expired",
  credentialGuard: "credential-shaped-content",
} as const;

/** A parsed send_agent_prompt call. `confirmed` requires the family's
 *  strongest available success evidence (structured MCP result where the
 *  normalized item carries one) AND a real-timeline-verified family shape:
 *  only codex fixtures are observed from an actual Paseo timeline — pi,
 *  devin and claude shapes are mapper-derived (tests/fixtures/supervision/
 *  README.md), so their sends are demoted to the uncertain lane with
 *  `family-shape-unverified` regardless of probe output (spec: "Unsupported
 *  shapes stay unknown"; a successful structured MCP result is required). */
export interface SendObservation {
  callId: string;
  recipient: string;
  prompt: string;
  confirmed: boolean;
}

export type Capture =
  | {
      kind: "peer";
      id: string;
      leadId: string;
      peerId: string;
      turnId: string | null;
      brief: { text: string; messageId: string | null };
      handback: { text: string; messageId: string | null } | null;
      sends: SendObservation[];
      uncertainSends: SendObservation[];
      flags: string[];
    }
  | {
      kind: "lead";
      id: string;
      leadId: string;
      turnId: string | null;
      sends: SendObservation[];
      uncertainSends: SendObservation[];
      flags: string[];
    };

export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// The latest user_message is a CANDIDATE boundary — v0.8 timeline items carry
// no per-item turn id, so a handback can only be read as "last assistant
// message of the latest turn slice" (spec point 3). Never scan older turns.
export function latestTurn(timeline: readonly AgentTimelineItem[]): readonly AgentTimelineItem[] {
  // ES2022 lib — no findLastIndex; the slice starts at the last user_message.
  let start = -1;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i]?.type === "user_message") { start = i; break; }
  }
  // No user_message at all: the event items are this turn's own records (a
  // Lead turn that consists of a single send_agent_prompt has no fresh user
  // input). Dropping them would lose a delivered send entirely — fall back
  // to the whole item list; chronology gating still applies downstream.
  return start < 0 ? timeline : timeline.slice(start);
}

// A brief that delegates its content to a file is not observable — flag
// visibility rather than reading arbitrary paths (spec point 3).
const ASSIGNMENT_FILE_RE = /assignment\s*file|assignmentFile|\.local-checks\//i;

const sendInput = z.object({ agentId: z.string().min(1), prompt: z.string().min(1) });
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Parse a possibly-string JSON payload once; null when it is not an object.
const asObject = (value: unknown): Record<string, unknown> | null => {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const successIn = (output: Record<string, unknown> | null): boolean =>
  output !== null && isRecord(output.structuredContent) && output.structuredContent.success === true;

// --- per-family send extraction (fixture-derived, see README.md) -----------

type SendProbe = { send: SendObservation } | { flag: string } | null;

const parseSendInput = (input: unknown, callId: string, confirmed: boolean): SendProbe => {
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { flag: VISIBILITY.sendInputUnparsed };
  return { send: { callId, recipient: parsed.data.agentId, prompt: parsed.data.prompt, confirmed } };
};

// codex: name "paseo.send_agent_prompt"; confirmed needs
// output.structuredContent.success===true and output.isError!==true.
const codexProbe = (item: Extract<AgentTimelineItem, { type: "tool_call" }>): SendProbe => {
  if (item.name !== "paseo.send_agent_prompt") return null;
  if (item.status !== "completed" || item.error !== null) return { flag: VISIBILITY.sendNotCompleted };
  if (item.detail.type !== "unknown") return { flag: VISIBILITY.sendResultUnobservable };
  const output = asObject(item.detail.output);
  if (output === null) return { flag: VISIBILITY.sendResultUnobservable };
  if (output.isError === true || !successIn(output)) return { flag: VISIBILITY.sendResultUnsuccessful };
  return parseSendInput(item.detail.input, item.callId, true);
};

// devin: name is the ACP title "Calling send_agent_prompt from paseo"; the
// MCP result body is dropped (output: null) — a completed call is
// transport-level success only, so the send is recorded UNCONFIRMED with
// send-result-unobservable (structured success is never visible).
const devinProbe = (item: Extract<AgentTimelineItem, { type: "tool_call" }>): SendProbe => {
  if (item.name !== "Calling send_agent_prompt from paseo") return null;
  if (item.status !== "completed" || item.error !== null) return { flag: VISIBILITY.sendNotCompleted };
  if (item.detail.type !== "unknown") return { flag: VISIBILITY.sendResultUnobservable };
  const parsed = sendInput.safeParse(item.detail.input);
  if (!parsed.success) return { flag: VISIBILITY.sendInputUnparsed };
  return {
    send: {
      callId: item.callId,
      recipient: parsed.data.agentId,
      prompt: parsed.data.prompt,
      confirmed: false,
    },
  };
};

// pi: name resolved to "paseo.send_agent_prompt" by the mapper, or a bare
// "mcp" proxy call whose input.tool names it; input.args is a JSON-encoded
// STRING (a second parse); confirmed needs
// output.details.mcpResult.structuredContent.success===true with
// output.isError!==true.
const piProbe = (item: Extract<AgentTimelineItem, { type: "tool_call" }>): SendProbe => {
  const input = asObject(item.detail.type === "unknown" ? item.detail.input : null);
  const named = item.name === "paseo.send_agent_prompt" ||
    (item.name === "mcp" && input?.tool === "paseo_send_agent_prompt");
  if (!named) return null;
  if (item.status !== "completed" || item.error !== null) return { flag: VISIBILITY.sendNotCompleted };
  if (item.detail.type !== "unknown") return { flag: VISIBILITY.sendResultUnobservable };
  const args = asObject(input?.args);
  if (args === null) return { flag: VISIBILITY.sendInputUnparsed };
  const output = asObject(item.detail.output);
  const mcpResult = isRecord(output?.details) ? asObject(output.details.mcpResult) : null;
  if (output === null || mcpResult === null) return { flag: VISIBILITY.sendResultUnobservable };
  if (output.isError === true || !successIn(mcpResult)) return { flag: VISIBILITY.sendResultUnsuccessful };
  return parseSendInput(args, item.callId, true);
};

// claude: name keeps the verbatim wire form "mcp__paseo__send_agent_prompt";
// output is the tool_result content — a JSON-encoded string in observed
// sessions (accept a structured object too); require success === true.
const claudeProbe = (item: Extract<AgentTimelineItem, { type: "tool_call" }>): SendProbe => {
  if (item.name !== "mcp__paseo__send_agent_prompt") return null;
  if (item.status !== "completed" || item.error !== null) return { flag: VISIBILITY.sendNotCompleted };
  if (item.detail.type !== "unknown") return { flag: VISIBILITY.sendResultUnobservable };
  const output = asObject(item.detail.output);
  if (output === null) return { flag: VISIBILITY.sendResultUnobservable };
  if (output.success !== true) return { flag: VISIBILITY.sendResultUnsuccessful };
  return parseSendInput(item.detail.input, item.callId, true);
};

const PROBES: Record<FamilyId, (item: Extract<AgentTimelineItem, { type: "tool_call" }>) => SendProbe> = {
  codex: codexProbe,
  devin: devinProbe,
  pi: piProbe,
  claude: claudeProbe,
};

// Extract every send_agent_prompt observation in the turn slice. Confirmed
// and unconfirmed sends stay in separate provenance lanes — one never
// silently replaces the other (spec point 3).
export function extractSends(
  family: FamilyId | null,
  turn: readonly AgentTimelineItem[],
): { sends: SendObservation[]; uncertainSends: SendObservation[]; flags: string[] } {
  const sends: SendObservation[] = [];
  const uncertainSends: SendObservation[] = [];
  const flags = new Set<string>();
  if (family === null || !(family in PROBES)) {
    // Count candidate tool calls only as a visibility signal — no parsing.
    const candidates = turn.filter(item => item.type === "tool_call").length;
    if (candidates > 0) flags.add(VISIBILITY.unsupportedFamily);
    return { sends, uncertainSends, flags: [...flags] };
  }
  const probe = PROBES[family];
  // Only codex's normalized shape is verified against a real timeline —
  // every other family's sends stay uncertain even when the probe's own
  // success evidence is satisfied (spec: fixture collection precedes
  // family support; unsupported/unverified shapes stay unknown).
  const shapeVerified = family === "codex";
  for (const item of turn) {
    if (item.type !== "tool_call") continue;
    const result = probe(item);
    if (result === null) continue;
    if ("flag" in result) {
      flags.add(result.flag);
      continue;
    }
    const confirmed = result.send.confirmed && shapeVerified;
    (confirmed ? sends : uncertainSends).push({ ...result.send, confirmed });
    if (!confirmed) {
      flags.add(VISIBILITY.sendResultUnobservable);
      if (!shapeVerified) flags.add(VISIBILITY.familyShapeUnverified);
    }
  }
  return { sends, uncertainSends, flags: [...flags] };
}

/** Route membership from hook payloads only — the hook agent record carries
 *  parentAgentId directly. A route to a differently parented Lead is allowed
 *  when explicitly assigned; Peer membership still requires that Lead's
 *  actual parent link (spec point 1). */
export const captureLead = (agent: PluginHookAgent): boolean => isSlpLead(agent.provider);
export const capturePeer = (agent: PluginHookAgent, leadId: string): boolean =>
  isSlpPeer(agent.provider) && agent.parentAgentId === leadId;

export function capture(event: TurnEnded, activeLeadIds: ReadonlySet<string>): Capture | null {
  const family = familyFromProviderId(event.agent.provider);
  const lead = captureLead(event.agent) && activeLeadIds.has(event.agent.id);
  const leadId = lead ? event.agent.id : event.agent.parentAgentId;
  const peer = !lead && leadId !== null && capturePeer(event.agent, leadId) && activeLeadIds.has(leadId);
  if (!lead && !peer) return null;
  if (leadId === null) return null;

  const turn = latestTurn(event.timeline);
  const extraction = extractSends(family, turn);

  if (peer) {
    // Failed/canceled Peer turns cannot establish a completed session
    // handback — an individually confirmed send still records delivery.
    const flags = new Set(extraction.flags);
    const first = turn[0];
    const brief = first?.type === "user_message" && first.text.trim() !== ""
      ? { text: first.text, messageId: first.messageId ?? null }
      : null;
    let final: AgentTimelineItem | undefined;
    for (let i = turn.length - 1; i >= 0; i -= 1) {
      if (turn[i]?.type === "assistant_message") { final = turn[i]; break; }
    }
    const handback = final?.type === "assistant_message" && final.text.trim() !== ""
      ? { text: final.text, messageId: final.messageId ?? null }
      : null;
    if (event.outcome.kind !== "completed") {
      flags.add(VISIBILITY.peerTurnNotCompleted);
      if (extraction.sends.length === 0 && extraction.uncertainSends.length === 0) return null;
      // Record the sends only — no brief/handback judgment is possible.
      return {
        kind: "peer", leadId, peerId: event.agent.id, turnId: event.turnId,
        id: fingerprint([leadId, event.agent.id, event.turnId, "sends-only", extraction.sends, extraction.uncertainSends]),
        brief: { text: "", messageId: null },
        handback: null,
        sends: extraction.sends, uncertainSends: extraction.uncertainSends,
        flags: [...flags],
      };
    }
    if (brief === null || handback === null) {
      flags.add(VISIBILITY.briefSourceAmbiguous);
      // A completed Peer turn with NO observable communication is still a
      // case — "absent observable communication is unknown", and the gap
      // must be visible on the observation list, not silently dropped.
      if (extraction.sends.length === 0 && extraction.uncertainSends.length === 0) {
        flags.add(VISIBILITY.noCommunication);
      }
    }
    if (brief !== null && ASSIGNMENT_FILE_RE.test(brief.text)) flags.add(VISIBILITY.briefAssignmentFile);
    // The assignment's report route is not machine-readable on this host —
    // route compliance and Lead receipt stay unknown (README row 11).
    flags.add(VISIBILITY.reportRouteUnverifiable);
    return {
      kind: "peer", leadId, peerId: event.agent.id, turnId: event.turnId,
      id: fingerprint([leadId, event.agent.id, event.turnId, brief?.messageId, brief?.text, handback?.text]),
      brief: brief ?? { text: "", messageId: null },
      handback,
      sends: extraction.sends, uncertainSends: extraction.uncertainSends,
      flags: [...flags],
    };
  }

  // Lead turn: a failed/canceled Lead turn can still contain successfully
  // delivered sends — keep them; only the flags record the gaps.
  const flags = new Set(extraction.flags);
  if (event.outcome.kind !== "completed") flags.add(VISIBILITY.leadTurnNotCompleted);
  if (extraction.sends.length === 0 && extraction.uncertainSends.length === 0 && flags.size === 0) return null;
  return {
    kind: "lead", leadId, turnId: event.turnId,
    id: fingerprint([leadId, event.turnId, extraction.sends, extraction.uncertainSends]),
    sends: extraction.sends, uncertainSends: extraction.uncertainSends,
    flags: [...flags],
  };
}
