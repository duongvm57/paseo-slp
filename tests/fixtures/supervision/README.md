# Supervision host-capability evidence and sanitized family fixtures

Evidence collected 2026-09-23 for `docs/spec/supervision-integration.md`
(implementation order step 1: host evidence first — record missing shapes
before any parser workaround). Sources, all read-only:

- Installed plugin SDK declarations `@getpaseo/plugin@0.8.0`,
  `@getpaseo/client@0.8.0`, `@getpaseo/protocol@0.8.0` under `node_modules/`
  (this checkout, after `npm ci`).
- Installed daemon provider mappers `@getpaseo/server@0.9.1` under
  `~/.local/share/fnm/.../@getpaseo/cli/node_modules/@getpaseo/server/dist/
  server/server/agent/providers/` (the running daemon's normalization layer —
  a different package than the 0.8.0 plugin SDK; cited as `S/...` below where
  `S` = that providers directory).
- Upstream `hoangnb24/paseo-supervision` `docs/INPUT_SHAPES.md` @
  `1bad19b8ee6c58482494f56a3d8c6edb4f969ee1` (read via GitHub; it documents one
  normalized Codex `send_agent_prompt` shape and explicitly does not establish
  the same shape for other providers).
- Provider-side session records observed read-only on this machine:
  Devin `~/.local/share/devin/cli/sessions.db` `tool_call_state` rows,
  Pi `~/.pi/agent/sessions/*.jsonl` toolCall/toolResult pairs,
  Claude `~/.claude/projects/*/*.jsonl` tool_use/tool_result blocks.
- This session's own agent record: `labels["paseo.parent-agent-id"]` is the
  parent-link carrier on snapshots (verified live).

## Host capability matrix

| # | Spec row / capability claim | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Lifecycle hooks `server.on("agent.created" | "agent.archived" | "agent.turn_started" | "agent.turn_ended")` and `server.before("agent.create" | "agent.session_open")` exist in the pinned 0.8.0 SDK | confirmed | `node_modules/@getpaseo/plugin/dist/server/lifecycle.d.ts:44-90` — `PluginLifecycleEvents` (turn_started/turn_ended/permission_*/archived/created/workspace.*) and `PluginBeforeRequests` (agent.create/agent.session_open/workspace.create) with `on`/`before` registrations. Hook context is `{paseo: PaseoApi, signal: AbortSignal}` (same file, lines 4-7). |
| 2 | Hook agent record carries `parentAgentId` directly | confirmed | `lifecycle.d.ts:15-22` — `PluginHookAgent {id, workspaceId, parentAgentId, provider, cwd, title}`. `agent.turn_ended` payload is `{agent, turnId: string\|null, outcome: PluginTurnOutcome, timeline: readonly AgentTimelineItem[]}` (lines 49-54); `PluginTurnOutcome` also repeats `parentAgentId` + `labels` (lines 32-43). |
| 3 | Snapshot/agent record exposes parentage | confirmed-with-indirection | `AgentSnapshotPayloadSchema` (`@getpaseo/protocol/dist/messages.d.ts:465-530`) has NO `parentAgentId` field; parentage is `labels["paseo.parent-agent-id"]` (line 520 labels record). Verified live: this session's own agent labels carry the Lead's ID under that key. `archivedAt` is optional-nullable (line 528), `workspaceId` optional (line 469). |
| 4 | `registerSettings()` gives the server a read/subscription handle | **gap confirmed** | `node_modules/@getpaseo/plugin/dist/server/contracts.d.ts:11` — `registerSettings(...)` returns `void` in pinned 0.8.0. No server-side settings read exists. Design response per spec: private `slp-runtime/state/supervision.json` file, loaded at plugin start — no client bootstrap. |
| 5 | `AgentTimelineItem` shape (user_message, assistant_message, tool_call) | confirmed | `@getpaseo/protocol/dist/agent-types.d.ts:303-325` — the union; tool_call items are `ToolCallTimelineItem` (lines 255-280): `{type:"tool_call", callId, name, detail: ToolCallDetail, metadata?, status: running\|completed\|failed\|canceled, error}` with `detail.type:"unknown"` carrying free-form `input`/`output`. |
| 6 | Per-item turn ID on timeline messages | **gap confirmed (hook path)** | `AgentTimelineItem` union (agent-types.d.ts:303-325) carries no `turnId`. `agent.turn_ended` hook items are bare `AgentTimelineItem[]` (lifecycle.d.ts:49-54) and its event-level `turnId` may be `null`. Wrappers do carry optional `turnId`: stream `timeline` events (agent-types.d.ts:369-374) and timeline-refetch entries `AgentTimelineEntryPayloadSchema` (messages.d.ts:10737-10751, plus `timestamp`/`seqStart`/`seqEnd`/`sourceSeqRanges`). Design response: correlate on matched start/end observation order; ambiguity is unknown. |
| 7 | Normalized `send_agent_prompt` shape per SLP family | partial — per family below | Upstream observed the emitted item only for Codex. Devin/Pi/Claude fixtures here are provider-record + mapper-source derived; the daemon-emitted item was not directly observable (row 11). Families without a verified fixture stay `unknown` in the parser. |
| 8 | Agent refresh through the connected SDK | confirmed | `@getpaseo/client/dist/index.d.ts:259` — `PaseoAgentHandle.refresh(requestId?) → Promise<PaseoAgentRefetchResult \| null>`; result `{agent: PaseoAgent, project}` (lines 170-173); `null` when the agent is unknown. `PaseoAgent` carries `provider`, `workspaceId?`, `archivedAt?`, `labels`, `status` (snapshot schema above). |
| 9 | Cancel an already-issued `agents.ref(id).send()` | **gap confirmed** | `index.d.ts:260` — `send(text, options?: PaseoAgentSendOptions): Promise<void>`; options are `messageId`/`images`/`attachments` only (lines 181-188). No abort parameter. Design response: revalidate before send, bound the wait, mark before dispatch, report uncertain outcome without retry (notify phase — not implemented in this assignment). |
| 10 | `assignmentFile` visibility / Lead read receipts | **gap confirmed** | Lifecycle events (lifecycle.d.ts:44-76, complete list) carry no file-read or read-receipt signal; a brief can embed only a path string. Design response: mark brief-visibility and Lead-receipt unknown; never read arbitrary files. |
| 11 | Structured report-recipient ID distinct from parent | **gap confirmed** | Hook record has `parentAgentId` (lifecycle.d.ts:18) and snapshots have only the parent label; neither carries the assignment's report route. This session's own assignment names a report recipient — it arrives in prompt text only. Route compliance stays unknown. |
| 12 | Read-only daemon/SDK timeline fetch from a Peer session | **gap confirmed** | `connect()` to the local daemon WS (127.0.0.1:6767) fails from this context (close 1006; the hello handshake needs session-bound auth). Provider-side stores (Devin `sessions.db`, Pi/Claude transcripts) remain readable; fixtures below derive normalized items from those records through the installed mapper source. |

## Provider-family fixtures

One file per family: `<family>.send-agent-prompt.json`. Each carries
`providerRecord` (the sanitized provider-side evidence where observed),
`items[]` (the normalized `AgentTimelineItem` the daemon mapper produces),
and `expect` (what the phase-B parser must extract: recipient, prompt,
confirmed flag). All IDs, bodies and call IDs are synthetic — no real session
content.

| Family | File | Status | Normalized `send_agent_prompt` shape |
| --- | --- | --- | --- |
| codex | `codex.send-agent-prompt.json` | **confirmed** (upstream observed the emitted item; mapper verified) | `name: "paseo.send_agent_prompt"`, `detail:{type:"unknown", input:{agentId,prompt,...}, output:{structuredContent:{success:true,...}}}`. Mapper: `S/codex/tool-call-mapper.js:461-470,704-722`, `S/codex/tool-call-detail-parser.js` deriveCodexToolDetail unknown fallback. |
| devin | `devin.send-agent-prompt.json` | provider-observed, mapper-derived | `name` is the ACP title `"Calling send_agent_prompt from paseo"` (kind is absent on MCP calls → title wins); `detail:{type:"unknown", input: rawInput, output: null}` — **the MCP result body is dropped, so `structuredContent.success` is not observable**; `status:"completed"` is the only delivery signal. Failed calls with text content normalize to `detail.type:"plain_text"`. Mapper: `S/acp-agent.js:2444-2452,2463-2492,2506-2548,2605-2626`. Provider record: `tool_call_state` rows with `_meta["cognition.ai/toolName"]="mcp__paseo__send_agent_prompt"`. |
| pi | `pi.send-agent-prompt.json` | provider-observed, mapper-derived | `name:"paseo.send_agent_prompt"` (resolved from `result.details.server`+`details.tool`, else from `args.tool` split); `detail:{type:"unknown", input:{tool:"paseo_send_agent_prompt", args:"<JSON STRING>"}, output:{details:{mcpResult:{structuredContent:{success:true}},server,tool}, isError:false}}`. **The args payload is a nested JSON string** — a second `JSON.parse` is required; malformed args stay unknown. Mapper: `S/pi/tool-call-mapper.js:135-165` + `mapToolDetail` default. Provider records: `~/.pi/agent/sessions/…/*.jsonl`. |
| claude | `claude.send-agent-prompt.json` | provider-observed, mapper-derived | `name` keeps the verbatim wire form `"mcp__paseo__send_agent_prompt"`; `detail:{type:"unknown", input:{agentId,prompt,...}, output:<tool_result content>}`. Observed results carry content as a JSON-encoded string (`"{\"success\":true,…}"`) — parse and require `success === true`; accept a structured object too. Mapper: `S/claude/tool-call-mapper.js` resolveClaudeToolKind→`unknown`, name passthrough; `S/claude/tool-call-detail-parser.js:107-128`. |

### Known caveats carried into phase B

- Only codex has an *observed normalized* item (upstream). The other three
  fixtures are derived by tracing the installed mapper over a real provider
  record — the transform is source-verified, the emitted item is not
  byte-observed. If live observation later contradicts a fixture, the fixture
  is wrong and the family reverts to `unknown`.
- Devin cannot prove `structuredContent.success`; its `completed` status is
  weaker evidence than the other families' result bodies.
- Pi's nested-string args and Claude's `mcp__`-prefixed name mean a naive
  `name === "paseo.send_agent_prompt" && typeof input.agentId === "string"`
  parser misses them entirely — they need per-family extraction, and anything
  unrecognized must return `unknown`, never a guess.
- No fixture contains credentials, real prompts, real agent IDs, or native
  session IDs.
