// tests/plugin-supervision-observer.test.mjs — Phase B shadow observer:
// provider-aware capture (per-family fixtures), the serialized queue,
// archive generations, monotonic chronology, stale-assessment invalidation,
// the nine spec scenarios, and the bounded metadata ring. The Jev transport
// is an injected seam — no network, no daemon, isolated homes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSupervisionObserver, buildEvidencePayload } from '../plugin/server/supervision/observer.ts';
import { capture, extractSends } from '../plugin/server/supervision/capture.ts';
import { parseAssessmentResponse, decide, localGate } from '../plugin/server/supervision/assessment.ts';
import { resolveSupervision, askJevDecision, assertRedacted, JevRequestError } from '../plugin/server/jev.ts';
import { makeHome } from './helpers/plugin-doubles.mjs';

const LEAD = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const PEER2 = '55555555-5555-4555-8555-555555555555';
const SUP = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const OTHER_LEAD = '66666666-6666-4666-8666-666666666666';
const WKS = 'wks_testworkspace';

const PROVIDER = { kind: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'typesafe/jev-1.13' };
const GATE_OK = { ok: true, provider: PROVIDER, authorization: 'Bearer test-key' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

const writeRoutes = (home, routes) => {
  const dir = join(home, 'slp-runtime', 'state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'supervision.json'), JSON.stringify({ schemaVersion: 1, routes }, null, 2) + '\n', { mode: 0o600 });
};
// Default delay 80ms: lead evidence fired inside the window is applied before
// the tick-driven evaluation. Route overrides set 0 for immediate evaluation.
const route = (over = {}) => ({
  leadAgentId: LEAD, leadWorkspaceId: WKS, supervisorAgentId: SUP, mode: 'shadow', pendingDelayMs: 80, ...over,
});

const agent = (id, provider, over = {}) => ({
  id, provider, workspaceId: WKS, parentAgentId: null, cwd: '/tmp', title: null, ...over,
});
const leadHook = (over = {}) => agent(LEAD, 'slp-codex-lead', over);
const peerHook = (id = PEER, over = {}) => agent(id, 'slp-codex-peer', { parentAgentId: LEAD, ...over });

// Snapshot double for ref.refresh() — labels carry parentage on refresh.
const snap = (id, provider, over = {}) => ({
  id, provider, workspaceId: WKS, status: 'idle', archivedAt: null, labels: {}, ...over,
});
const makePaseo = agents => {
  const refreshed = [];
  const paseo = {
    refreshed,
    agents: {
      ref(id) {
        return {
          refresh: async () => { refreshed.push(id); return { agent: agents[id] ?? null }; },
        };
      },
    },
  };
  return paseo;
};

const userMsg = (text, messageId = 'm-user') => ({ type: 'user_message', text, messageId });
const asstMsg = (text, messageId = 'm-asst') => ({ type: 'assistant_message', text, messageId });
const codexSend = (callId, recipient, prompt, over = {}) => ({
  type: 'tool_call', callId, name: 'paseo.send_agent_prompt', status: 'completed', error: null,
  detail: { type: 'unknown', input: { agentId: recipient, prompt }, output: { isError: false, structuredContent: { success: true } } },
  ...over,
});

const peerEnd = (timeline, over = {}) => ({
  agent: peerHook(over.peerId ?? PEER, over.agent ?? {}),
  turnId: over.turnId ?? 'turn-p1',
  outcome: over.outcome ?? { kind: 'completed' },
  timeline,
});
const leadEnd = (timeline, over = {}) => ({
  agent: leadHook(over.agent ?? {}),
  turnId: over.turnId ?? 'turn-l1',
  outcome: over.outcome ?? { kind: 'completed' },
  timeline,
});
const leadStart = (turnId, over = {}) => ({ agent: leadHook(over.agent ?? {}), turnId });

const makeAsk = (responses = []) => {
  const calls = [];
  let i = 0;
  const ask = async (provider, auth, request, opts) => {
    calls.push({ provider, auth, request });
    const response = responses[Math.min(i++, responses.length - 1)];
    if (response instanceof Error) throw response;
    return { model: response.model, answers: response.answers, usage: response.usage ?? null, raw: response };
  };
  return { ask, calls };
};

// A valid strict response: unique-max probabilities summing to 1.
const choice = (value, confidence = 0.95, others = []) => {
  const keys = [value, ...others];
  const probabilities = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.9 : 0.1 / (keys.length - 1)]));
  return { type: 'choice', choice: value, confidence, probabilities };
};
const jevResponse = (leadBrief, peerHandback, leadHandling, over = {}) => ({
  model: PROVIDER.model,
  answers: {
    leadBrief: choice(leadBrief, 0.95, ['satisfied', 'drift', 'unknown'].filter(k => k !== leadBrief)),
    peerHandback: choice(peerHandback, 0.95, ['satisfied', 'drift', 'unknown'].filter(k => k !== peerHandback)),
    leadHandling: choice(leadHandling, 0.95, ['handled', 'pending', 'drift', 'unknown'].filter(k => k !== leadHandling)),
  },
  usage: { input_tokens: 10, output_tokens: 5 },
  ...over,
});
const ALL_HANDLED = jevResponse('satisfied', 'satisfied', 'handled');
const ALL_DRIFT = jevResponse('satisfied', 'satisfied', 'drift');

const makeObserver = (t, { home, gate = GATE_OK, ask, agents = {} } = {}) => {
  const stableRoot = join(home, 'slp-runtime');
  const observer = createSupervisionObserver({
    stableRoot,
    // A function value is used as the resolver itself so tests can flip the
    // gate mid-flight (the file-stamp cache still applies between calls).
    gate: typeof gate === 'function' ? gate : () => gate,
    ask: ask ?? (async () => { throw new Error('ask-not-stubbed'); }),
  });
  const paseo = makePaseo(agents);
  t.after(() => observer.stop());
  return { observer, paseo, stableRoot };
};

const liveAgents = (over = {}) => ({
  [LEAD]: snap(LEAD, 'slp-codex-lead'),
  [PEER]: snap(PEER, 'slp-codex-peer', { labels: { 'paseo.parent-agent-id': LEAD } }),
  [PEER2]: snap(PEER2, 'slp-codex-peer', { labels: { 'paseo.parent-agent-id': LEAD } }),
  [SUP]: snap(SUP, 'slp-codex-supervisor'),
  ...over,
});

const ringRows = home => {
  const file = join(home, 'slp-runtime', 'state', 'supervision-cases.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')).cases;
};

// Wait out the pending window, then let the tick's drain finish.
const settle = async observer => { await sleep(140); await observer.idle(); };

const baseSetup = async (t, { responses = [ALL_HANDLED], route: routeOver = {}, agents, gate } = {}) => {
  const home = makeHome(t);
  writeRoutes(home, [route(routeOver)]);
  const ask = makeAsk(responses);
  const rig = makeObserver(t, { home, agents: agents ?? liveAgents(), gate, ask: ask.ask });
  return { home, ...rig, calls: ask.calls };
};

const peerTurn = (over = {}) => peerEnd([userMsg('Implement X per the brief'), asstMsg('Done — X implemented, tests pass')], over);

// ---------------------------------------------------------------------------
// capture.ts — per-family fixture extraction
// ---------------------------------------------------------------------------

const FIXTURE_DIR = new URL('./fixtures/supervision/', import.meta.url).pathname;

for (const family of ['codex', 'devin', 'pi', 'claude']) {
  test(`capture: ${family} fixture items extract per documented expectation`, () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, `${family}.send-agent-prompt.json`), 'utf8'));
    for (const entry of fixture.items) {
      const result = extractSends(family, [entry.item]);
      const expect = entry.expect;
      if (expect.sendAgentPrompt !== true) continue;
      const confirmed = result.sends.find(s => s.recipient === expect.recipientAgentId);
      const uncertain = result.uncertainSends.find(s => s.recipient === expect.recipientAgentId);
      if (expect.prompt === undefined) {
        // No parse expectation (e.g. a failed call): only assert nothing was
        // treated as confirmed delivery.
        assert.equal(confirmed, undefined, `${family}: failed/unparsed send must never confirm`);
        continue;
      }
      const found = confirmed ?? uncertain;
      assert.ok(found, `${family}: expected a parsed send to ${expect.recipientAgentId}`);
      assert.equal(found.prompt, expect.prompt);
      assert.equal(Boolean(confirmed), Boolean(expect.confirmed),
        `${family}: confirmed=${expect.confirmed} — ${expect.successEvidence}`);
      if (!expect.confirmed && confirmed === undefined && uncertain !== undefined) {
        assert.ok(result.flags.includes('send-result-unobservable'), `${family}: unconfirmed observable send needs the flag`);
        if (family !== 'codex') {
          assert.ok(result.flags.includes('family-shape-unverified'),
            `${family}: mapper-derived shape must carry family-shape-unverified`);
        }
      }
    }
  });
}

test('capture: unsupported family produces unsupported-family flag, never a guess', () => {
  const timeline = [userMsg('brief'), { type: 'tool_call', callId: 'c1', name: 'whatever', status: 'completed', error: null, detail: { type: 'unknown', input: {}, output: null } }, asstMsg('done')];
  const result = extractSends(null, timeline);
  assert.equal(result.sends.length, 0);
  assert.ok(result.flags.includes('unsupported-family'));
});

test('capture: malformed pi args string stays unparsed', () => {
  const item = {
    type: 'tool_call', callId: 'c1', name: 'paseo.send_agent_prompt', status: 'completed', error: null,
    detail: { type: 'unknown', input: { tool: 'paseo_send_agent_prompt', args: '{not json' }, output: { isError: false, details: { mcpResult: { structuredContent: { success: true } } } } },
  };
  const result = extractSends('pi', [item]);
  assert.equal(result.sends.length, 0);
  assert.ok(result.flags.includes('send-input-unparsed'));
});

test('capture: peer on failed turn keeps confirmed sends but no handback', () => {
  const event = peerEnd(
    [userMsg('brief'), codexSend('c1', LEAD, 'report'), asstMsg('partial')],
    { outcome: { kind: 'failed', error: { message: 'x' } } },
  );
  const got = capture(event, new Set([LEAD]));
  assert.equal(got.kind, 'peer');
  assert.equal(got.handback, null);
  assert.equal(got.sends.length, 1);
  assert.ok(got.flags.includes('peer-turn-not-completed'));
});

test('capture: only codex produces confirmed sends — pi/devin/claude demote to uncertain', () => {
  // The pi/devin/claude fixtures are mapper-derived evidence scaffolding,
  // never observed on a real daemon timeline — a probe-satisfying send in
  // those families must land in the uncertain lane with the family flag.
  for (const family of ['devin', 'pi', 'claude']) {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, `${family}.send-agent-prompt.json`), 'utf8'));
    const items = fixture.items.filter(entry => entry.expect.sendAgentPrompt === true).map(entry => entry.item);
    const result = extractSends(family, items);
    assert.equal(result.sends.length, 0, `${family}: no confirmed send until a real-timeline fixture exists`);
    assert.ok(result.uncertainSends.length > 0, `${family}: parsed sends keep the uncertain lane`);
    assert.ok(result.flags.includes('family-shape-unverified'), family);
  }
});

test('capture: completed peer turn with no communication surfaces a metadata-only case', () => {
  // Absent observable communication is unknown — the gap must appear on the
  // observation list, never silently dropped (spec §Observation).
  const event = peerEnd([{
    type: 'tool_call', callId: 'c9', name: 'unrelated.tool', status: 'completed',
    error: null, detail: { type: 'unknown', input: {}, output: {} },
  }]);
  const got = capture(event, new Set([LEAD]));
  assert.ok(got, 'a silent completed turn still opens a case');
  assert.equal(got.kind, 'peer');
  assert.ok(got.flags.includes('no-observable-communication'));
  assert.ok(got.flags.includes('brief-source-ambiguous'));
});

// ---------------------------------------------------------------------------
// assessment.ts — strict validation
// ---------------------------------------------------------------------------

test('assessment: valid response parses; pin rule accepts resolved suffix model', () => {
  const parsed = parseAssessmentResponse(jevResponse('satisfied', 'satisfied', 'handled', { model: 'typesafe/jev-1.13-20260917' }), PROVIDER);
  assert.ok(parsed);
  assert.equal(parsed.model, 'typesafe/jev-1.13-20260917');
});

test('assessment: response model outside the pin rule is rejected', () => {
  assert.equal(parseAssessmentResponse(jevResponse('satisfied', 'satisfied', 'handled', { model: 'other/model-9' }), PROVIDER), null);
  assert.equal(parseAssessmentResponse(jevResponse('satisfied', 'satisfied', 'handled', { model: 'typesafe/jev-2.0' }), PROVIDER), null);
});

test('assessment: malformed distributions and ties are rejected', () => {
  const bad = jevResponse('satisfied', 'satisfied', 'handled');
  bad.answers.leadBrief = { type: 'choice', choice: 'satisfied', confidence: 0.95, probabilities: { satisfied: 0.5, drift: 0.5, unknown: 0.5 } };
  assert.equal(parseAssessmentResponse(bad, PROVIDER), null);
  const tied = jevResponse('satisfied', 'satisfied', 'handled');
  tied.answers.peerHandback = { type: 'choice', choice: 'satisfied', confidence: 0.95, probabilities: { satisfied: 0.5, drift: 0.5, unknown: 0 } };
  assert.equal(parseAssessmentResponse(tied, PROVIDER), null);
});

test('assessment: low confidence stays unknown — never a violation inference', () => {
  const low = jevResponse('drift', 'drift', 'drift');
  for (const key of Object.keys(low.answers)) low.answers[key].confidence = 0.4;
  const parsed = parseAssessmentResponse(low, PROVIDER);
  assert.ok(parsed);
  assert.equal(decide(parsed.answers, fullEvidence(), null), 'unknown');
});

// A full-shaped EvidencePayload — the exact field allowlist the observer may
// send Jev (spec §Shadow evidence). On this host every peer case carries
// report-route-unverifiable, so localGate/decide are exercised directly here
// — the observer e2e tests below assert the gate outcome instead.
const fullEvidence = (over = {}) => ({
  bound: { leadAgentId: LEAD, peerId: PEER, supervisorAgentId: SUP },
  caseId: 'case-x',
  peerTurnId: 'turn-p1',
  brief: { text: 'brief body', messageId: 'm-brief', visibility: [] },
  handback: { text: 'handback body', messageId: 'm-handback' },
  roomMessages: [],
  uncertainRoomMessages: [],
  otherRoomMessages: [],
  reportMessages: [],
  peerSends: [],
  pendingWindowElapsed: true,
  flags: [],
  ...over,
});

test('evidence payload carries only the allowed fields — asserted on the production builder', () => {
  // The allowlist is enforced on the REAL buildEvidencePayload (exported from
  // observer.ts), not a re-declared literal: any field added to the outbound
  // state must fail this test (spec §Jev: "The outbound state contains only
  // the bound Lead/Peer IDs, case and turn/message IDs, the complete
  // captured brief and session handback bodies, confirmed room/report
  // prompts, and visibility flags").
  const payload = buildEvidencePayload(
    {
      id: 'case-x', leadId: LEAD, peerId: PEER, peerTurnId: 'turn-p1',
      evidence: {
        brief: { text: 'brief body', messageId: 'm-brief', flags: [] },
        handback: { text: 'handback body', messageId: 'm-handback' },
        roomMessages: [{ callId: 'c1', turnId: 'turn-l1', recipient: PEER, prompt: 'ack' }],
        uncertainRoomMessages: [{ callId: 'c2', turnId: 'turn-l2', recipient: PEER2, prompt: 'q' }],
        otherRoomMessages: [{ callId: 'c3', turnId: 'turn-l1', recipient: PEER2, prompt: 'other' }],
        reportMessages: [{ callId: 'c4', turnId: 'turn-l1', recipient: SUP, prompt: 'report' }],
        peerSends: [{ callId: 'c5', turnId: 'turn-p1', recipient: LEAD, prompt: 'report' }],
        flags: ['report-route-unverifiable'],
        pendingDelayElapsed: true,
      },
    },
    { supervisorAgentId: SUP },
  );
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['bound', 'brief', 'caseId', 'flags', 'handback', 'otherRoomMessages',
      'peerSends', 'peerTurnId', 'pendingWindowElapsed', 'reportMessages',
      'roomMessages', 'uncertainRoomMessages'],
  );
  assert.deepEqual(Object.keys(payload.bound).sort(), ['leadAgentId', 'peerId', 'supervisorAgentId']);
  // Per-lane shapes stay inside the allowlist too — no recipient on the
  // repair lane, ids+recipient only on the uncertain/other lanes.
  assert.deepEqual(Object.keys(payload.roomMessages[0]).sort(), ['callId', 'prompt', 'turnId']);
  assert.deepEqual(Object.keys(payload.uncertainRoomMessages[0]).sort(), ['callId', 'recipient', 'turnId']);
  assert.deepEqual(Object.keys(payload.otherRoomMessages[0]).sort(), ['callId', 'recipient', 'turnId']);
  assert.deepEqual(Object.keys(payload.reportMessages[0]).sort(), ['callId', 'prompt', 'recipient', 'turnId']);
  assert.deepEqual(Object.keys(payload.peerSends[0]).sort(), ['callId', 'prompt', 'recipient']);
});

test('localGate: every delivery-ambiguity flag blocks the single verdict', () => {
  const blocking = [
    'unsupported-family', 'family-shape-unverified', 'brief-references-assignment-file',
    'brief-source-ambiguous', 'peer-turn-not-completed', 'send-not-completed',
    'send-input-unparsed', 'send-result-unobservable', 'send-result-unsuccessful',
    'recipient-refresh-failed', 'recipient-inactive', 'lead-start-unmatched',
    'report-route-unverifiable', 'no-observable-communication', 'capture-paused',
    'queue-overflow', 'credential-shaped-content',
  ];
  for (const flag of blocking) {
    assert.equal(localGate(fullEvidence({ flags: [flag] })), flag, flag);
    // A flag carried on the brief's own visibility lane blocks the same way.
    assert.equal(localGate(fullEvidence({ brief: { text: 'b', messageId: 'm', visibility: [flag] } })), flag, `brief:${flag}`);
  }
});

test('localGate: lead-turn-not-completed is visibility, not a blanket block (spec 187)', () => {
  // Confirmed sends on a canceled Lead turn still count — the flag alone
  // must not gate; decide() uses it only to keep a drift judgment honest.
  assert.equal(localGate(fullEvidence({ flags: ['lead-turn-not-completed'] })), null);
  assert.equal(localGate(fullEvidence({ brief: null })), 'brief-source-ambiguous');
  assert.equal(
    localGate(fullEvidence({ uncertainRoomMessages: [{ callId: 'c1', turnId: 't', recipient: PEER, prompt: 'x' }] })),
    'chronology-or-delivery-uncertain',
  );
});

test('decide: silence never becomes drift — empty evidence lanes stay unknown', () => {
  const drift = parseAssessmentResponse(ALL_DRIFT, PROVIDER).answers;
  // Pending window elapsed, no observable Lead communication at all.
  assert.equal(decide(drift, fullEvidence(), null), 'unknown');
  // Uncertain-chronology sends never count as support either — ambiguous
  // evidence is not observable support.
  const uncertainOnly = fullEvidence({
    uncertainRoomMessages: [{ callId: 'c9', turnId: null, recipient: PEER }],
  });
  assert.equal(decide(drift, uncertainOnly, null), 'unknown');
});

test('decide: a qualified room repair suppresses drift and never counts as drift support', () => {
  // Spec: "an observable correlated repair that re-engages the Peer"
  // resolves a case — the same send cannot also support the drift it
  // repairs. Repaired + Jev drift → unknown (never suspected_drift).
  const drift = parseAssessmentResponse(ALL_DRIFT, PROVIDER).answers;
  const repaired = fullEvidence({ roomMessages: [{ callId: 'c1', turnId: 't1', prompt: 'ack' }] });
  assert.equal(decide(drift, repaired, null), 'unknown', 'repair suppresses drift');
  // Even a brief/handback drift verdict is suppressed by observable repair.
  const briefGap = parseAssessmentResponse(jevResponse('drift', 'satisfied', 'pending'), PROVIDER).answers;
  assert.equal(decide(briefGap, repaired, null), 'unknown');
});

test('decide: drift support comes from other-room/report activity', () => {
  const drift = parseAssessmentResponse(ALL_DRIFT, PROVIDER).answers;
  // Observable Lead communication elsewhere post-handback supports the
  // handling-drift judgment (spec: "require observable supporting
  // communication"). Decision recorded in assessment.ts: report sends
  // count — spec line 195 makes them a separate communication CLASS,
  // separate from Peer-handling, not from observable Lead activity.
  const otherRoom = fullEvidence({
    otherRoomMessages: [{ callId: 'c2', turnId: 'turn-l1', recipient: PEER2 }],
  });
  assert.equal(decide(drift, otherRoom, null), 'suspected_drift');
  const reports = fullEvidence({
    reportMessages: [{ callId: 'c4', turnId: 't', recipient: SUP, prompt: 'x' }],
  });
  assert.equal(decide(drift, reports, null), 'suspected_drift');
  // Brief/handback gaps can alert on Jev classification alone (spec:
  // "even if delivery or Lead handling is unknown") — with no repair to
  // suppress them.
  const briefGap = parseAssessmentResponse(jevResponse('drift', 'satisfied', 'pending'), PROVIDER).answers;
  assert.equal(decide(briefGap, fullEvidence(), null), 'suspected_drift');
});

test('decide: a canceled Lead turn never vetoes delivery — flag is informative only', () => {
  // Spec 187: "A confirmed send on a failed or canceled Lead turn still
  // counts as delivery." The flag informs humans, it is not a veto in
  // either direction.
  const drift = parseAssessmentResponse(ALL_DRIFT, PROVIDER).answers;
  const supportedCanceled = fullEvidence({
    otherRoomMessages: [{ callId: 'c2', turnId: 'turn-l1', recipient: PEER2 }],
    flags: ['lead-turn-not-completed'],
  });
  assert.equal(decide(drift, supportedCanceled, null), 'suspected_drift');
  const handled = parseAssessmentResponse(ALL_HANDLED, PROVIDER).answers;
  const repairedCanceled = fullEvidence({
    roomMessages: [{ callId: 'c1', turnId: 't1', prompt: 'ack' }],
    flags: ['lead-turn-not-completed'],
  });
  assert.equal(decide(handled, repairedCanceled, null), 'handled');
});

test('decide: handled requires an observable repair plus high-confidence Jev handled', () => {
  const handled = parseAssessmentResponse(ALL_HANDLED, PROVIDER).answers;
  // Jev says handled but no observable room repair exists → unknown.
  assert.equal(decide(handled, fullEvidence(), null), 'unknown');
  const repaired = fullEvidence({ roomMessages: [{ callId: 'c1', turnId: 't', prompt: 'ack' }] });
  assert.equal(decide(handled, repaired, null), 'handled');
  const pending = parseAssessmentResponse(jevResponse('satisfied', 'satisfied', 'pending'), PROVIDER).answers;
  assert.equal(decide(pending, repaired, null), 'unknown');
  // Low-confidence handled is not a verdict even when repaired.
  const low = parseAssessmentResponse(jevResponse('satisfied', 'satisfied', 'handled'), PROVIDER).answers;
  low.leadHandling.confidence = 0.5;
  assert.equal(decide(low, repaired, null), 'unknown');
  // Any gate reason resolves the single verdict to unknown before answers.
  assert.equal(decide(handled, repaired, 'report-route-unverifiable'), 'unknown');
});

// ---------------------------------------------------------------------------
// jev.ts — resolver gates + transport parity
// ---------------------------------------------------------------------------

const writeJev = (home, config, { key } = {}) => {
  const dir = join(home, 'slp-runtime', 'state');
  mkdirSync(dir, { recursive: true });
  if (config !== undefined) writeFileSync(join(dir, 'jev.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  if (key !== undefined) writeFileSync(join(dir, 'jev-openrouter.key'), `${key}\n`, { mode: 0o600 });
};
const JEV_CFG = { schemaVersion: 1, enabled: true, capabilities: { supervision: true, routing: false }, provider: PROVIDER };

test('jev resolveSupervision: fail-closed gates in order', t => {
  const home = makeHome(t);
  const root = join(home, 'slp-runtime');
  assert.deepEqual(resolveSupervision(root), { ok: false, reason: 'jev-unconfigured' });
  writeJev(home, { ...JEV_CFG, enabled: false });
  assert.equal(resolveSupervision(root).reason, 'jev-disabled');
  writeJev(home, { ...JEV_CFG, capabilities: { supervision: false } });
  assert.equal(resolveSupervision(root).reason, 'jev-capability-off');
  writeJev(home, JEV_CFG);
  assert.equal(resolveSupervision(root).reason, 'jev-key-missing');
  writeJev(home, JEV_CFG, { key: 'sk-or-testkey' });
  const ok = resolveSupervision(root);
  assert.equal(ok.ok, true);
  assert.equal(ok.authorization, 'Bearer sk-or-testkey');
});

test('jev askJevDecision: endpoint join, extras, single-shot (no retry)', async t => {
  const home = makeHome(t);
  writeJev(home, JEV_CFG, { key: 'sk-or-testkey' });
  const gate = resolveSupervision(join(home, 'slp-runtime'));
  assert.equal(gate.ok, true);
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ model: PROVIDER.model, answers: { q: { type: 'choice', choice: 'a', confidence: 1 } } }) };
  };
  const out = await askJevDecision(gate.provider, gate.authorization, {
    state: { caseId: 'c1' },
    questions: { q: { type: 'choice', instructions: 'pick', criteria: { a: 'a', b: 'b' } } },
  }, { fetchImpl });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/alpha/decisions');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, PROVIDER.model);
  assert.deepEqual(body.provider, { allow_fallbacks: false });
  assert.equal(out.answers.q.choice, 'a');
});

test('jev askJevDecision: typesafe transport hits /v1/systemone without a provider field', async t => {
  // Transport parity (spec §Jev: the same TypeSafe Jev request format the
  // routing path uses): the typesafe endpoint takes NO provider object —
  // sending OpenRouter's allow_fallbacks pin would corrupt the request.
  const provider = { kind: 'typesafe', baseUrl: 'https://typesafe.example/base', model: 'typesafe/jev-1.13' };
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ model: provider.model, answers: { q: { type: 'choice', choice: 'a', confidence: 1 } } }) };
  };
  const out = await askJevDecision(provider, 'Bearer ts-key', {
    state: { caseId: 'c1' },
    questions: { q: { type: 'choice', instructions: 'pick', criteria: { a: 'a', b: 'b' } } },
  }, { fetchImpl });
  assert.equal(seen.length, 1, 'single-shot — no retry');
  assert.equal(seen[0].url, 'https://typesafe.example/base/v1/systemone');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, provider.model);
  assert.equal('provider' in body, false, 'typesafe requests carry no provider field');
  assert.equal(out.answers.q.choice, 'a');
});

test('jev askJevDecision: credential-shaped payload refused before transport', async t => {
  const home = makeHome(t);
  writeJev(home, JEV_CFG, { key: 'sk-or-testkey' });
  const gate = resolveSupervision(join(home, 'slp-runtime'));
  let called = 0;
  await assert.rejects(
    askJevDecision(gate.provider, gate.authorization, {
      state: { prompt: `token ${'sk-or-' + 'a'.repeat(20)}` },
      questions: { q: { type: 'choice', instructions: 'x', criteria: { a: 'a' } } },
    }, { fetchImpl: async () => { called += 1; throw new Error('must not fetch'); } }),
    error => error instanceof JevRequestError && error.code === 'jev-redacted',
  );
  assert.equal(called, 0);
  assert.throws(() => assertRedacted({ [`Bearer ${'x'.repeat(20)}`]: 'v' }), /credential-shaped/);
});

test('jev askJevDecision: a response error is single-shot — no automatic retry', async t => {
  const home = makeHome(t);
  writeJev(home, JEV_CFG, { key: 'sk-or-testkey' });
  const gate = resolveSupervision(join(home, 'slp-runtime'));
  const calls = [];
  await assert.rejects(
    askJevDecision(gate.provider, gate.authorization, {
      state: { caseId: 'c1' },
      questions: { q: { type: 'choice', instructions: 'pick', criteria: { a: 'a', b: 'b' } } },
    }, {
      fetchImpl: async () => {
        calls.push(1);
        return { ok: false, status: 500, json: async () => ({ error: { message: 'upstream boom' } }) };
      },
    }),
    error => error instanceof JevRequestError && error.code === 'jev-http' && /HTTP 500/.test(error.message),
  );
  assert.equal(calls.length, 1, 'no retry after a response error');
});

test('jev askJevDecision: a stalled body read rejects after the deadline — no retry', async t => {
  const home = makeHome(t);
  writeJev(home, JEV_CFG, { key: 'sk-or-testkey' });
  const gate = resolveSupervision(join(home, 'slp-runtime'));
  const calls = [];
  const started = Date.now();
  await assert.rejects(
    askJevDecision(gate.provider, gate.authorization, {
      state: { caseId: 'c1' },
      questions: { q: { type: 'choice', instructions: 'pick', criteria: { a: 'a', b: 'b' } } },
    }, {
      timeoutMs: 60,
      // Headers resolve; the body read never settles AND ignores the abort
      // signal — the deadline must still fire (whole-request bound).
      fetchImpl: async () => {
        calls.push(1);
        return { ok: true, status: 200, json: () => new Promise(() => {}) };
      },
    }),
    error => error instanceof JevRequestError && error.code === 'jev-timeout',
  );
  assert.ok(Date.now() - started < 5000, 'the request rejects at the deadline, not never');
  assert.equal(calls.length, 1, 'no retry after a timeout');
});

test('jev askJevDecision: a network throw is single-shot — no automatic retry', async t => {
  const home = makeHome(t);
  writeJev(home, JEV_CFG, { key: 'sk-or-testkey' });
  const gate = resolveSupervision(join(home, 'slp-runtime'));
  const calls = [];
  await assert.rejects(
    askJevDecision(gate.provider, gate.authorization, {
      state: { caseId: 'c1' },
      questions: { q: { type: 'choice', instructions: 'pick', criteria: { a: 'a', b: 'b' } } },
    }, { fetchImpl: async () => { calls.push(1); throw new TypeError('socket hangup'); } }),
    error => error instanceof JevRequestError && error.code === 'jev-network',
  );
  assert.equal(calls.length, 1, 'no retry after a network error');
});

// ---------------------------------------------------------------------------
// observer — the nine spec scenarios
// ---------------------------------------------------------------------------

// Host truth: every Peer case carries report-route-unverifiable (no
// machine-readable report-recipient signal exists), so localGate resolves
// every case to unknown BEFORE any Jev call — Lead-confirmed spec-faithful
// consequence. The e2e tests below assert evidence capture, chronology
// lanes and gate reasons; the judged paths live in the decide() unit tests.
const GATED = 'report-route-unverifiable';

test('observer: evidence lands — confirmed post-handback send recorded, gate closes unknown', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'acknowledged — continue')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0, 'localGate stops before Jev');
  const rows = ringRows(home);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, GATED);
  // The confirmed send still landed in the room lane — capture is intact.
  assert.equal(rows[0].counts.roomMessages, 1);
  assert.deepEqual(rows[0].messageIds, { brief: 'm-user', handback: 'm-asst', sendCallIds: ['c1'], sendTurnIds: ['turn-l1'] });
  assert.equal(rows[0].assessmentsUsed, 0);
});

test('observer scenario 1: different room — send to an active Peer of another Lead never proves handling', async t => {
  const agents = liveAgents({
    // OTHER is a LIVE agent — a direct Peer of a different Lead — so the
    // recipient check really exercises the refresh path, not refresh-null.
    [OTHER]: snap(OTHER, 'slp-codex-peer', { labels: { 'paseo.parent-agent-id': OTHER_LEAD } }),
  });
  const { observer, paseo, home, calls } = await baseSetup(t, { responses: [ALL_DRIFT], agents });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', OTHER, 'unrelated work')]), paseo);
  await settle(observer);
  assert.ok(paseo.refreshed.includes(OTHER), 'the unrelated recipient went through refresh verification');
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, GATED);
  assert.equal(rows[0].counts.roomMessages, 0);
  assert.equal(rows[0].counts.otherRoomMessages, 0, 'another Lead\'s room is never supporting activity either');
});

test('observer scenario 2: unobserved direct action — Lead turn without send_agent_prompt stays unknown', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { responses: [ALL_DRIFT] });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([userMsg('next'), asstMsg('I fixed it myself — no message sent')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown', 'silence is never drift');
  assert.equal(rows[0].counts.roomMessages, 0);
});

test('observer scenario 3: assignmentFile pointer — local gate, Jev never called', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { route: { pendingDelayMs: 0 } });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerEnd([
    userMsg('Work the assignment file at .local-checks/brief.md'),
    asstMsg('Done'),
  ]), paseo);
  await observer.idle();
  assert.equal(calls.length, 0, 'Jev must not judge incomplete brief visibility');
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, 'brief-references-assignment-file');
});

test('observer scenario 4: final-only handback — assistant prose without a tool call is not delivery', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { responses: [ALL_DRIFT] });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  // Lead answers in prose only — no send_agent_prompt anywhere.
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([asstMsg('Looks good, thanks')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown', 'final prose proves neither handling nor drift');
  assert.equal(rows[0].counts.roomMessages, 0);
  assert.equal(rows[0].counts.peerSends, 0);
});

test('observer scenario 5: overlapping Lead turns — send start ambiguous → uncertain, no violation', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  // Two overlapping Lead turns: start A, start B, then A ends with the send.
  observer.onStart(leadStart('turn-a'));
  observer.onStart(leadStart('turn-b'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'ack')], { turnId: 'turn-a' }), paseo);
  await settle(observer);
  assert.equal(calls.length, 0, 'uncertain chronology must not reach Jev');
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].counts.uncertainRoomMessages, 1);
  assert.ok(rows[0].visibility.includes('lead-start-unmatched'));
});

test('observer scenario 6: failed tool send — no structured success, not proof of either verdict', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { responses: [ALL_DRIFT] });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  const failedSend = codexSend('c1', PEER, 'ack', { status: 'failed', error: { message: 'send failed' } });
  observer.onTurn(leadEnd([failedSend]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0, 'send-not-completed gates before Jev');
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, 'send-not-completed');
  assert.ok(rows[0].visibility.includes('send-not-completed'));
});

test('observer scenario 7: canceled Lead turn — confirmed send still lands as evidence', async t => {
  // Spec 187: a successful send on a canceled turn still counts — the flag
  // is visibility, not a blanket block. On this host the case still resolves
  // unknown via report-route-unverifiable before any Jev call.
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'ack')], { outcome: { kind: 'canceled', reason: 'user stop' } }), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, GATED);
  assert.equal(rows[0].counts.roomMessages, 1, 'the confirmed send counts as room evidence');
  assert.ok(rows[0].visibility.includes('lead-turn-not-completed'));
});

test('observer scenario 8 (doc): stale-assessment invalidation is unreachable while the report route is unverifiable', async t => {
  // The version-bump invalidation inside evaluateCase only runs after a Jev
  // call resolves; on this host every case gates at localGate first
  // (report-route-unverifiable is always set), so no real path reaches it.
  // The seam stays for hosts that gain a structured report-recipient signal
  // — no test-only seam is added just to reach it (Lead ruling). What IS
  // observable here: evidence still lands, the gate still closes unknown.
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'late ack')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, GATED);
  assert.equal(rows[0].counts.roomMessages, 1);
});

test('observer scenario 9: archive/restore — tombstone drops work, refresh verifies restoration', async t => {
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onArchived(leadHook(), paseo);
  await observer.idle();
  let rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, 'lead-archived');
  // A turn from the tombstoned lead is refused — capture is dropped, and the
  // queued restore job verifies liveness before re-admission.
  observer.onTurn(leadEnd([codexSend('c3', PEER, 'ghost')]), paseo);
  await observer.idle();
  observer.onCreated(leadHook(), paseo);
  await observer.idle();
  // A new peer turn for the restored lead observes again.
  observer.onCreated(peerHook(PEER2), paseo);
  observer.onTurn(peerEnd([userMsg('new brief'), asstMsg('done')], { peerId: PEER2, turnId: 'turn-p2' }), paseo);
  await settle(observer);
  rows = ringRows(home);
  assert.equal(rows.length, 2);
  const restored = rows.find(r => r.peerId === PEER2);
  assert.equal(restored.state, 'unknown');
  assert.equal(restored.reason, GATED);
});

// ---------------------------------------------------------------------------
// Gates, bounds, persistence
// ---------------------------------------------------------------------------

test('observer: failed Jev gate pauses capture entirely', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route()]);
  const calls = [];
  const { observer, paseo } = makeObserver(t, {
    home, agents: liveAgents(),
    gate: { ok: false, reason: 'jev-capability-off' },
    ask: async () => { calls.push(1); throw new Error('unreachable'); },
  });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  assert.equal(calls.length, 0);
  assert.equal(ringRows(home).length, 0, 'paused capture records no case');
  const view = observer.shadow(join(home, 'slp-runtime'));
  assert.equal(view.gates[LEAD], 'jev-capability-off');
});

test('observer: notify-mode routes are never observed', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route({ mode: 'notify' })]);
  const calls = [];
  const { observer, paseo } = makeObserver(t, { home, agents: liveAgents(), ask: async () => { calls.push(1); throw new Error('unreachable'); } });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  assert.equal(calls.length, 0);
  assert.equal(ringRows(home).length, 0);
});

test('observer: pending delay gates evaluation until elapsed', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 60 })]);
  const { ask, calls } = makeAsk([ALL_HANDLED]);
  const { observer, paseo } = makeObserver(t, { home, agents: liveAgents(), ask });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  assert.equal(ringRows(home)[0].state, 'observed', 'no evaluation before the delay elapses');
  await sleep(120);
  await observer.idle();
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown', 'the tick marks the window elapsed, then the local gate resolves');
  assert.equal(rows[0].reason, GATED);
  assert.equal(calls.length, 0);
});

test('observer: ring persists metadata only — no bodies, survives reload', async t => {
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  const file = join(home, 'slp-runtime', 'state', 'supervision-cases.json');
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('Implement X per the brief'), 'brief body must never persist');
  assert.ok(!raw.includes('Done — X implemented'), 'handback body must never persist');
  // Restart: a fresh observer on the same stableRoot loads the ring.
  const rig2 = makeObserver(t, { home, agents: liveAgents() });
  const view = rig2.observer.shadow(join(home, 'slp-runtime'));
  assert.equal(view.observations.length, 1);
  assert.equal(view.observations[0].state, 'observed');
});

test('observer: confirmed send to another direct Peer lands in otherRoomMessages', async t => {
  // Observable room activity that can SUPPORT a drift judgment — never
  // handling for this case. On this host the gate still closes unknown.
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onCreated(peerHook(PEER2), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER2, 'other Peer task update')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows.length, 1, 'PEER2 never had a turn — only this case exists');
  assert.equal(rows[0].counts.roomMessages, 0);
  assert.equal(rows[0].counts.otherRoomMessages, 1);
  assert.equal(rows[0].state, 'unknown');
});

test('observer: a Jev-gate failure mid-flight pauses capture — no new evidence lands, case closes unknown', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 60 })]);
  let currentGate = GATE_OK;
  const calls = [];
  const { observer, paseo } = makeObserver(t, {
    home, agents: liveAgents(),
    gate: () => currentGate,
    ask: async () => { calls.push(1); throw new Error('unreachable'); },
  });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  // Gate flips off — the file-stamp cache busts when jev.json appears.
  currentGate = { ok: false, reason: 'jev-key-missing' };
  writeJev(home, JEV_CFG);
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'ack')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, 'jev-key-missing');
  assert.ok(rows[0].visibility.includes('capture-paused'));
  assert.equal(rows[0].counts.roomMessages, 0, 'no new evidence lands while the gate is down');
});

test('observer: UTF-8 byte ceiling — a unicode payload over 64KiB gates before Jev', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { route: { pendingDelayMs: 0 } });
  observer.onCreated(peerHook(), paseo);
  // 'é' is 2 UTF-8 bytes per unit: 33 000 units is ~66 000 serialized bytes
  // but only ~33k UTF-16 length — a string-length check would let it through.
  observer.onTurn(peerEnd([userMsg('brief'), asstMsg('é'.repeat(33_000))]), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, 'evidence-oversize');
  assert.ok(rows[0].visibility.includes('evidence-oversize'));
});

test('observer: archive during peer-refresh — a stale verification cannot admit a tombstoned generation', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 0 })]);
  const calls = [];
  const agents = liveAgents();
  let refreshStarted = false;
  let releaseRefresh;
  const gate = new Promise(resolve => { releaseRefresh = resolve; });
  const paseo = {
    agents: {
      ref: id => ({
        refresh: async () => {
          if (id === PEER) { refreshStarted = true; await gate; }
          return { agent: agents[id] ?? null };
        },
      }),
    },
  };
  const { observer } = makeObserver(t, {
    home,
    ask: async () => { calls.push(1); throw new Error('unreachable'); },
  });
  // No onCreated: the first peer turn queues a refresh-verified verify-peer.
  observer.onTurn(peerTurn(), paseo);
  while (!refreshStarted) await sleep(1);
  // Archive lands while the refresh is still in flight — the verification
  // must be discarded, not restore a tombstoned generation.
  observer.onArchived(peerHook(), paseo);
  releaseRefresh();
  await observer.idle();
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.ok(rows.length > 0, 'the dropped turn still records a metadata row — vacuous every() must not pass on empty');
  assert.ok(rows.every(row => row.state === 'unknown'), 'pre-archive evidence can only record unknown');
  assert.ok(rows.every(row => row.reason === 'recipient-refresh-failed'));
});

test('observer: gate-down clears retained bodies globally — the Jev gate is daemon-global', async t => {
  // Spec §Configuration: a failed gate "does not retain new message
  // bodies" — the clause is not lead-scoped, so a gate-down observed by one
  // Lead's event must empty EVERY open case, not just that Lead's.
  const LEAD_B = '88888888-8888-4888-8888-888888888888';
  const PEER_B = '99999999-9999-4999-8999-999999999999';
  const home = makeHome(t);
  writeRoutes(home, [
    route({ pendingDelayMs: 60_000 }),
    route({ leadAgentId: LEAD_B, pendingDelayMs: 60_000 }),
  ]);
  const agents = liveAgents({
    [LEAD_B]: snap(LEAD_B, 'slp-codex-lead'),
    [PEER_B]: snap(PEER_B, 'slp-codex-peer', { labels: { 'paseo.parent-agent-id': LEAD_B } }),
  });
  writeJev(home, JEV_CFG);
  let currentGate = GATE_OK;
  const { observer, paseo } = makeObserver(t, {
    home, agents, gate: () => currentGate,
    ask: async () => { throw new Error('unreachable'); },
  });
  // Two open cases on two different Leads, both retaining bodies.
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  observer.onCreated(peerHook(PEER_B, { parentAgentId: LEAD_B }), paseo);
  observer.onTurn(peerEnd([userMsg('brief B'), asstMsg('handback B')], { peerId: PEER_B, turnId: 'turn-pB', agent: { parentAgentId: LEAD_B } }), paseo);
  await observer.idle();
  const rowA = ringRows(home).find(r => r.peerId === PEER);
  const rowB = ringRows(home).find(r => r.peerId === PEER_B);
  assert.ok(observer.retainedBodies(rowA.fingerprint) > 0, 'case A retains bodies pre-gate-down');
  assert.ok(observer.retainedBodies(rowB.fingerprint) > 0, 'case B retains bodies pre-gate-down');
  // The gate flips down; only Lead A's event observes it — but the Jev
  // gate is daemon-global, so BOTH leads' cases must empty immediately.
  currentGate = { ok: false, reason: 'jev-key-missing' };
  writeJev(home, JEV_CFG, { key: 'k'.repeat(32) }); // stamp-bust the gate cache
  observer.onTurn(leadEnd([asstMsg('gate-observing event')]), paseo);
  assert.equal(observer.retainedBodies(rowA.fingerprint), 0, 'event-observing lead cleared');
  assert.equal(observer.retainedBodies(rowB.fingerprint), 0, 'other lead cleared — the gate is global');
});

test('observer: a verify job queued before an archive never admits the stale generation', async t => {
  // onCreated and onArchived land in the same synchronous turn — the
  // queued verify-peer must discard itself on its ENQUEUE-time generation
  // instead of refreshing a tombstoned id (spec: "Archive generations
  // invalidate pending work").
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onArchived(peerHook(), paseo);
  await observer.idle();
  // A post-archive turn cannot open a case: the capture is dropped and the
  // drop is recorded in diagnostics, not as a ring row for a dead id.
  observer.onTurn(peerTurn({ turnId: 'after-archive' }), paseo);
  await observer.idle();
  assert.equal(ringRows(home).length, 0, 'a queued-then-archived verification must not admit a later turn');
  assert.ok(observer.shadow(join(home, 'slp-runtime')).diagnostics.reasons.includes('peer-archived'));
});

test('observer: a tombstoned send recipient is never admitted — not even via refresh', async t => {
  const agents = liveAgents({
    [OTHER]: snap(OTHER, 'slp-codex-peer', { labels: { 'paseo.parent-agent-id': LEAD } }),
  });
  const { observer, paseo, home } = await baseSetup(t, { agents });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  // OTHER is archived before the Lead's send is even observed — the local
  // tombstone must gate the send without spending a refresh on a stale id.
  observer.onArchived(peerHook(OTHER), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', OTHER, 'post-archive send')]), paseo);
  await settle(observer);
  const rows = ringRows(home);
  assert.equal(rows[0].counts.otherRoomMessages, 0, 'an archived recipient is never drift support');
  assert.ok(rows[0].visibility.includes('recipient-inactive'));
});

test('observer: an archive landing during evaluation refresh closes peer-archived, not a gated reason', async t => {
  // The post-await tombstone re-check must win over the liveness
  // snapshots — they describe a stale generation.
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 40 })]);
  const agents = liveAgents();
  let evalRefreshStarted = false;
  let releaseEval;
  const evalGate = new Promise(resolve => { releaseEval = resolve; });
  let peerRefreshes = 0;
  const paseo = {
    agents: {
      ref: id => ({
        refresh: async () => {
          if (id === PEER && ++peerRefreshes === 2) { evalRefreshStarted = true; await evalGate; }
          return { agent: agents[id] ?? null };
        },
      }),
    },
  };
  const calls = [];
  const { observer } = makeObserver(t, {
    home, agents,
    ask: async () => { calls.push(1); throw new Error('unreachable'); },
  });
  observer.onTurn(peerTurn(), paseo);
  // Refresh 1 = verify-peer admission; refresh 2 = the evaluation's
  // liveness refresh, blocked until the archive lands.
  while (!evalRefreshStarted) await sleep(1);
  observer.onArchived(peerHook(), paseo);
  releaseEval();
  await observer.idle();
  assert.equal(calls.length, 0, 'no Jev spend on a stale generation');
  const rows = ringRows(home);
  assert.ok(rows.length > 0);
  assert.equal(rows[rows.length - 1].state, 'unknown');
  assert.equal(rows[rows.length - 1].reason, 'peer-archived', 'archive mid-evaluation wins over the snapshot');
});

test('observer: a Peer in an unverified family resolves unknown via family-shape-unverified', async t => {
  // slp-pi-peer is a real SLP provider, but the pi send shape is only
  // mapper-derived — its sends stay uncertain and the case gates unknown.
  const PI_PEER = '77777777-7777-4777-8777-777777777777';
  const agents = liveAgents({
    [PI_PEER]: snap(PI_PEER, 'slp-pi-peer', { labels: { 'paseo.parent-agent-id': LEAD } }),
  });
  const { observer, paseo, home, calls } = await baseSetup(t, { agents });
  observer.onCreated(peerHook(PI_PEER, { provider: 'slp-pi-peer' }), paseo);
  const piSend = {
    type: 'tool_call', callId: 'p1', name: 'paseo.send_agent_prompt', status: 'completed', error: null,
    detail: {
      type: 'unknown',
      input: { tool: 'paseo_send_agent_prompt', args: JSON.stringify({ agentId: LEAD, prompt: 'report' }) },
      output: { isError: false, details: { mcpResult: { structuredContent: { success: true } } } },
    },
  };
  observer.onTurn(peerEnd([userMsg('brief'), piSend, asstMsg('done')], { peerId: PI_PEER, agent: { provider: 'slp-pi-peer' } }), paseo);
  await settle(observer);
  assert.equal(calls.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, 'family-shape-unverified');
  assert.ok(rows[0].visibility.includes('family-shape-unverified'));
});

test('observer: route removed between capture and evaluation → unknown, no Jev', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 60 })]);
  const { ask, calls } = makeAsk([ALL_HANDLED]);
  const { observer, paseo } = makeObserver(t, { home, agents: liveAgents(), ask });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  writeRoutes(home, []); // route removed before the delay elapsed
  await sleep(120);
  await observer.idle();
  assert.equal(calls.length, 0);
  assert.equal(ringRows(home)[0].reason, 'route-removed');
});

// ---------------------------------------------------------------------------
// correction round 3 — symmetric lanes, verified creation, per-case basis
// ---------------------------------------------------------------------------

test('observer: agent.created never trusts the payload — membership needs refresh-verified parentage', async t => {
  // S6: on this host agent.created also fires when ensureAgentLoaded
  // re-creates a persisted agent (agent-loading.ts → createAgent emits the
  // same event), so the payload's parentAgentId is a persisted claim to
  // verify — never fresh-creation proof. A created Peer whose refreshed
  // snapshot names a DIFFERENT parent is never registered.
  const agents = liveAgents({
    [PEER]: snap(PEER, 'slp-codex-peer', { labels: { 'paseo.parent-agent-id': OTHER_LEAD } }),
  });
  const { observer, paseo, home, calls } = await baseSetup(t, { agents });
  observer.onCreated(peerHook(), paseo); // payload CLAIMS parent LEAD
  await observer.idle();
  assert.ok(paseo.refreshed.includes(PEER), 'created peer went through refresh verification');
  observer.onTurn(peerTurn(), paseo);
  await settle(observer);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, 'recipient-refresh-failed', 'refreshed parentage disagrees — never registered');
  assert.equal(calls.length, 0);
});

test('observer: agent.created admits a peer once refresh verifies the claimed parent', async t => {
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  await observer.idle();
  assert.ok(paseo.refreshed.includes(PEER), 'membership was verified, not trusted');
  observer.onTurn(peerTurn(), paseo);
  await settle(observer);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].reason, GATED, 'a real case was created — not the unverified-membership stub');
  assert.ok(!rows[0].visibility.includes('recipient-refresh-failed'));
});

test('observer: gate-down empties retained bodies at detection, not at evaluation', async t => {
  // Spec §Configuration: a failed Jev gate "does not retain new message
  // bodies" — the privacy boundary drops already-captured bodies when the
  // gate is SEEN down, not lazily later.
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 60_000 })]);
  writeJev(home, JEV_CFG);
  let currentGate = GATE_OK;
  const { observer, paseo } = makeObserver(t, {
    home, agents: liveAgents(),
    gate: () => currentGate,
    ask: async () => { throw new Error('unreachable'); },
  });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  const fp = ringRows(home)[0].fingerprint;
  assert.ok(observer.retainedBodies(fp) > 0, 'bodies retained while the gate is green');
  // Gate flips down — the next event detects it and clears synchronously.
  // The added key file changes the gate stamp, busting the cache.
  currentGate = { ok: false, reason: 'jev-key-missing' };
  writeJev(home, JEV_CFG, { key: 'k'.repeat(32) });
  observer.onTurn(leadEnd([codexSend('c9', PEER, 'post-gate send')]), paseo);
  assert.equal(observer.retainedBodies(fp), 0, 'retained bodies emptied at gate-down detection');
  assert.equal(ringRows(home)[0].counts.roomMessages, 0, 'nothing appended while the gate is down');
  const rows = ringRows(home);
  assert.ok(rows[0].state === 'observed' || rows[0].state === 'unknown');
});

test('observer: an in-place mutation lands synchronously and re-arms the case (evidence-basis invalidation)', async t => {
  // The accept-time discard needs an in-flight Jev call; every case on this
  // host gates at localGate first (report-route-unverifiable), so — like
  // scenario 8 — the full path is unreachable here and the discard branch
  // stands by construction: `preEvidence` is captured before ask and
  // compared to `item.evidenceVersion`, which every mutation site bumps
  // (gate-down clearBodies, queue-overflow marks, lane pushes, pending-
  // elapsed flips). The reachable half IS asserted: a mid-open mutation
  // lands synchronously, re-arms the case dirty, and the case re-evaluates
  // on the NEW basis — it closes on capture-paused, never on stale
  // pre-mutation evidence.
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 40 })]);
  let currentGate = GATE_OK;
  const { observer, paseo } = makeObserver(t, {
    home, agents: liveAgents(),
    gate: () => currentGate,
    ask: async () => { throw new Error('unreachable'); },
  });
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  const fp = ringRows(home)[0].fingerprint;
  currentGate = { ok: false, reason: 'jev-key-missing' };
  writeJev(home, JEV_CFG, { key: 'k'.repeat(32) });
  observer.onTurn(leadEnd([codexSend('c9', PEER, 'dropped')]), paseo);
  assert.equal(observer.retainedBodies(fp), 0);
  // Gate recovers — the case evaluates on the mutated basis and gates on
  // the capture-paused flag the mutation added. A different key size makes
  // the stamp change deterministic (same-mtime identical rewrites can keep
  // a cached gate — the cache is stamp-keyed, not clock-keyed).
  currentGate = GATE_OK;
  writeJev(home, JEV_CFG, { key: 'z'.repeat(64) });
  await settle(observer);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'unknown');
  // capture-paused is recorded on the case; the earlier-ordered report
  // flag wins the single reason code.
  assert.equal(rows[0].reason, GATED);
  assert.ok(rows[0].visibility.includes('capture-paused'));
  assert.equal(observer.retainedBodies(fp), null, 'closed case is gone from the open map');
});

test('observer: a non-qualifying report send lands in the uncertain lane, symmetric with room sends', async t => {
  // One chronology rule for every send class: a send whose matching Lead
  // turn-start was NOT observed strictly after the Peer handback is
  // uncertain — never report evidence and never drift support.
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  // NO leadStart — the send's chronology cannot qualify. Both a Supervisor
  // report and a room send land in the uncertain lane together.
  observer.onTurn(leadEnd([
    codexSend('c1', SUP, 'status report'),
    codexSend('c2', PEER, 'maybe-early ack'),
  ]), paseo);
  await settle(observer);
  const rows = ringRows(home);
  assert.equal(rows[0].counts.reportMessages, 0, 'non-qualifying report is never report evidence');
  assert.equal(rows[0].counts.roomMessages, 0, 'non-qualifying room send is never repair evidence');
  assert.equal(rows[0].counts.uncertainRoomMessages, 2, 'both land in the uncertain lane');
  assert.ok(rows[0].visibility.includes('lead-start-unmatched'));
  assert.equal(rows[0].reason, 'lead-start-unmatched');
});

test('observer: a qualifying report send lands in the report lane', async t => {
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook(), paseo);
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', SUP, 'status report')]), paseo);
  await settle(observer);
  const rows = ringRows(home);
  assert.equal(rows[0].counts.reportMessages, 1);
  assert.equal(rows[0].counts.uncertainRoomMessages, 0);
  assert.equal(rows[0].messageIds.sendCallIds.includes('c1'), true);
  assert.equal(rows[0].messageIds.sendTurnIds.includes('turn-l1'), true,
    'the issuing Lead turn id persists beside the call id');
});

test('observer: ring rows persisted before the new fields existed still load', async t => {
  // Schema compat: new fields are optional-with-default — a readable older
  // row keeps its data instead of dropping the whole ring file.
  const home = makeHome(t);
  const dir = join(home, 'slp-runtime', 'state');
  mkdirSync(dir, { recursive: true });
  const oldRow = {
    fingerprint: 'a'.repeat(64), leadAgentId: LEAD, peerId: PEER, peerTurnId: 'turn-p1',
    observedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    state: 'unknown', reason: 'report-route-unverifiable',
    visibility: ['report-route-unverifiable'],
    counts: { roomMessages: 1, uncertainRoomMessages: 0, reportMessages: 0, peerSends: 0 },
    assessmentsUsed: 0, lastAssessment: { at: 'x', model: 'm', usage: null, choices: { leadBrief: 'satisfied' } },
  };
  writeFileSync(join(dir, 'supervision-cases.json'), JSON.stringify({ schemaVersion: 1, cases: [oldRow] }, null, 2));
  const { observer } = makeObserver(t, { home, agents: liveAgents() });
  const view = observer.shadow(join(home, 'slp-runtime'));
  assert.equal(view.observations.length, 1, 'older ring rows load, never silently dropped');
  const row = view.observations[0];
  assert.equal(row.counts.roomMessages, 1, 'existing data survives');
  assert.equal(row.counts.otherRoomMessages, 0, 'new count field defaults to zero');
  assert.equal(row.lastAssessment, null, 'a legacy assessment shape reads as null, not a dropped row');
  assert.deepEqual(row.messageIds, { brief: null, handback: null, sendCallIds: [], sendTurnIds: [] });
});
