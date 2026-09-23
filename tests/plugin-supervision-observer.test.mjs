// tests/plugin-supervision-observer.test.mjs — Phase B shadow observer:
// provider-aware capture (per-family fixtures), the serialized queue,
// archive generations, monotonic chronology, stale-assessment invalidation,
// the nine spec scenarios, and the bounded metadata ring. The Jev transport
// is an injected seam — no network, no daemon, isolated homes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSupervisionObserver } from '../plugin/server/supervision/observer.ts';
import { capture, extractSends } from '../plugin/server/supervision/capture.ts';
import { parseAssessmentResponse, decide } from '../plugin/server/supervision/assessment.ts';
import { resolveSupervision, askJevDecision, assertRedacted, JevRequestError } from '../plugin/server/jev.ts';
import { makeHome } from './helpers/plugin-doubles.mjs';

const LEAD = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const PEER2 = '55555555-5555-4555-8555-555555555555';
const SUP = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
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
const makePaseo = agents => ({
  agents: {
    ref(id) {
      return {
        refresh: async () => ({ agent: agents[id] ?? null }),
      };
    },
  },
});

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
    gate: () => gate,
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
  assert.equal(decide(parsed.answers, { flags: [], uncertainRoomMessages: [], pendingWindowElapsed: true, brief: { text: 'b', messageId: 'm', visibility: [] } }, null), 'unknown');
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

// ---------------------------------------------------------------------------
// observer — the nine spec scenarios
// ---------------------------------------------------------------------------

test('observer: handled path — brief + handback + confirmed post-handback send → evaluated', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'acknowledged — continue')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 1);
  const rows = ringRows(home);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'evaluated');
  assert.equal(rows[0].counts.roomMessages, 1);
  assert.equal(rows[0].assessmentsUsed, 1);
});

test('observer scenario 1: different room — send to unrelated recipient never proves handling', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { responses: [ALL_DRIFT] });
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', OTHER, 'unrelated work')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.state.roomMessages.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'suspected_drift');
  assert.equal(rows[0].counts.roomMessages, 0);
});

test('observer scenario 2: unobserved direct action — Lead turn without send_agent_prompt', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { responses: [ALL_DRIFT] });
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([userMsg('next'), asstMsg('I fixed it myself — no message sent')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.state.roomMessages.length, 0);
  assert.equal(ringRows(home)[0].state, 'suspected_drift');
});

test('observer scenario 3: assignmentFile pointer — local gate, Jev never called', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { route: { pendingDelayMs: 0 } });
  observer.onCreated(peerHook());
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
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  // Lead answers in prose only — no send_agent_prompt anywhere.
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([asstMsg('Looks good, thanks')]), paseo);
  await settle(observer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.state.roomMessages.length, 0);
  assert.equal(calls[0].request.state.peerSends.length, 0);
  assert.equal(ringRows(home)[0].state, 'suspected_drift');
});

test('observer scenario 5: overlapping Lead turns — send start ambiguous → uncertain, no violation', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook());
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

test('observer scenario 6: failed tool send — no structured success, not proof', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t, { responses: [ALL_DRIFT] });
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  const failedSend = codexSend('c1', PEER, 'ack', { status: 'failed', error: { message: 'send failed' } });
  observer.onTurn(leadEnd([failedSend]), paseo);
  await settle(observer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.state.roomMessages.length, 0);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'suspected_drift');
  assert.ok(rows[0].visibility.includes('send-not-completed'));
});

test('observer scenario 7: canceled Lead turn with confirmed send still counts', async t => {
  const { observer, paseo, home, calls } = await baseSetup(t);
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'ack')], { outcome: { kind: 'canceled', reason: 'user stop' } }), paseo);
  await settle(observer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.state.roomMessages.length, 1);
  const rows = ringRows(home);
  assert.equal(rows[0].state, 'evaluated');
  assert.ok(rows[0].visibility.includes('lead-turn-not-completed'));
});

test('observer scenario 8: stale assessment — evidence mid-flight invalidates the judgment', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 0 })]);
  const calls = [];
  let releaseAsk;
  const ask = async (provider, auth, request) => {
    calls.push(request);
    if (calls.length === 1) await new Promise(r => { releaseAsk = r; });
    return { model: ALL_DRIFT.model, answers: ALL_DRIFT.answers, usage: ALL_DRIFT.usage, raw: ALL_DRIFT };
  };
  const { observer, paseo } = makeObserver(t, { home, agents: liveAgents(), ask });
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  // Assessment is in flight — wait until the ask call is registered, then
  // land new evidence before it resolves.
  while (calls.length === 0) await sleep(5);
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'late ack')]), paseo);
  releaseAsk();
  await observer.idle();
  const rows = ringRows(home);
  // The stale drift judgment is discarded; the late send is applied to the
  // still-open case and the re-armed evaluation counts it — a closed
  // first judgment would leave roomMessages at 0 and assessmentsUsed at 1.
  assert.equal(calls.length, 2);
  assert.equal(rows[0].counts.roomMessages, 1);
  assert.equal(rows[0].assessmentsUsed, 2);
  assert.equal(rows[0].state, 'suspected_drift');
});

test('observer scenario 9: archive/restore — tombstone drops work, refresh verifies restoration', async t => {
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook());
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
  observer.onCreated(leadHook());
  await observer.idle();
  // A new peer turn for the restored lead observes again.
  observer.onCreated(peerHook(PEER2));
  observer.onTurn(peerEnd([userMsg('new brief'), asstMsg('done')], { peerId: PEER2, turnId: 'turn-p2' }), paseo);
  await settle(observer);
  rows = ringRows(home);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.peerId === PEER2).state, 'evaluated');
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
  observer.onCreated(peerHook());
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
  observer.onCreated(peerHook());
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
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  assert.equal(calls.length, 0, 'no assessment before the delay elapses');
  await sleep(120);
  await observer.idle();
  assert.equal(calls.length, 1, 'tick job marks the delay elapsed and evaluates');
});

test('observer: ring persists metadata only — no bodies, survives reload', async t => {
  const { observer, paseo, home } = await baseSetup(t);
  observer.onCreated(peerHook());
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

test('observer: Jev payload carries only the allowed fields', async t => {
  const { observer, paseo, calls } = await baseSetup(t);
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  observer.onStart(leadStart('turn-l1'));
  observer.onTurn(leadEnd([codexSend('c1', PEER, 'ack')]), paseo);
  await settle(observer);
  const state = calls[0].request.state;
  const keys = Object.keys(state).sort();
  assert.deepEqual(keys, ['bound', 'brief', 'caseId', 'flags', 'handback', 'peerSends', 'peerTurnId', 'pendingWindowElapsed', 'reportMessages', 'roomMessages', 'uncertainRoomMessages']);
  assert.deepEqual(Object.keys(state.bound).sort(), ['leadAgentId', 'peerId', 'supervisorAgentId']);
});

test('observer: route removed between capture and evaluation → unknown, no Jev', async t => {
  const home = makeHome(t);
  writeRoutes(home, [route({ pendingDelayMs: 60 })]);
  const { ask, calls } = makeAsk([ALL_HANDLED]);
  const { observer, paseo } = makeObserver(t, { home, agents: liveAgents(), ask });
  observer.onCreated(peerHook());
  observer.onTurn(peerTurn(), paseo);
  await observer.idle();
  writeRoutes(home, []); // route removed before the delay elapsed
  await sleep(120);
  await observer.idle();
  assert.equal(calls.length, 0);
  assert.equal(ringRows(home)[0].reason, 'route-removed');
});
