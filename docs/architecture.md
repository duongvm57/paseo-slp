# Architecture — how SLP rides on Paseo

SLP is a way of organizing agents: a Supervisor watches, a Lead owns the
project's technical calls, Peers do bounded work. The plugin's whole job is
to make that organization exist **on a stock Paseo daemon** — using only
the primitives Paseo already has (custom providers, agent profiles,
`config.patch`, workspaces, agent parentage) plus one ingredient Paseo does
not have: a hidden instruction channel into each session.

This document draws that architecture. For requirements and file-level
contracts see [contract.md](contract.md); for the implementation spec see
[spec/paseo-plugin-implementation.md](spec/paseo-plugin-implementation.md).

## The role model

```
                        Human
                    owner authority
                          │
            ┌─────────────┴─────────────┐
            │                           │
       Supervisor                   Project Lead
   observation, governance      technical authority,
   anti-patterns, momentum      topology, acceptance
            │                           │
            └─────── observes ──────────┤
                                        │
                                     Peer(s)
                        Engineer / Architect / Reviewer / Scout
                              (disposition per task)
```

This is not a hard `Supervisor > Lead` chain of command — the two roles
hold different *kinds* of authority. The Lead is the authority inside its
project; the Supervisor stays outside the execution stream so it can see
bias the Lead cannot, relay Human decisions, and recover momentum. A Peer
is an independent co-worker: the same `slp-*-peer` provider can be an
Engineer, Architect, Reviewer or Scout depending on the assignment it is
born with. Peers never spawn agents.

Three separate layers carry three separate concerns:

- **Role policy** — who the seat is, what it may do (injected, see below)
- **Workspace protocol** — this repository's tactics, written per-repo
- **Assignment** — the specific task, in the visible prompt

## What the plugin adds to Paseo

```
┌────────────────────────── Paseo daemon ──────────────────────────┐
│                                                                  │
│   config.json                                                    │
│     agents.providers:                                            │
│       slp-claude-supervisor  slp-codex-supervisor                │
│       slp-pi-supervisor      slp-devin-supervisor   ─┐           │
│       slp-claude-lead        slp-codex-lead          │ up to 12  │
│       slp-pi-lead            slp-devin-lead          │ entries — │
│       slp-claude-peer        slp-codex-peer          │ settings- │
│       slp-pi-peer            slp-devin-peer         ─┘ driven    │
│     agentProfiles:                                               │
│       slp-supervisor → one slp-*-supervisor provider             │
│       slp-lead       → one slp-*-lead provider                   │
│                                                                  │
│   slp-runtime/                         ← plugin-managed          │
│     <candidateSha>/    immutable SLP payload (policy bytes,        │
│                        shims, role wrappers, gate, transports,    │
│                        helpers)                                  │
│     launchers/<sha>/   devin launcher files (hook families run    │
│                        the candidate's bin/slp-gate.mjs directly) │
│     state/receipt.json what the plugin believes it owns           │
│     state/communication-language                                   │
│                            optional injected language (toggleable) │
│     state/role-routing.json                                      │
│                            optional supervisor/lead family+model  │
│                            picks (settings-driven generation)     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The plugin is a **manager**, not an agent feature. It exposes a small set
of administrative operations (`status`, `activate`, `reconcile`,
`deactivate`, `local-target`, `catalog`) that a human drives from the SLP
sidebar. Agents never see these. Activation writes the provider entries
(up to twelve — all twelve without routing; the chosen supervisor/lead
combos plus all four peers when `role-routing.json` is set) and 2 profiles
into `config.json` atomically through `config.patch`,
materializes the SLP payload into an immutable `slp-runtime/<sha>` tree,
and records a receipt. Nothing changes on the daemon until a human
explicitly activates.

Two saved profiles are the only doors in: **SLP Supervisor** and **SLP
Lead**. Peers never get saved profiles — the Lead chooses a peer provider
per task from a routing catalog (`.paseo-slp/slp-routing.json`), which is
what lets one project mix e.g. a Codex Lead with Devin peers.

## Two lifecycles

Everything above is the **control plane**: it runs when a human clicks,
and it only ever touches `config.json` + `slp-runtime/`.

The **runtime plane** is what those config entries do afterwards, every
time an agent is created. Since Phase 2 there are two transports — both
render the same `roleBundle()` bytes from the same candidate:

```
hook families (codex / pi / claude) — thin alias + hooks

human or agent calls create_agent(profile/provider, prompt)
        │
        ▼
agent.create before-hook (plugin) reads the binding, resolves the role
from the slp-* provider id (or the slp_role feature marker), renders
roleBundle() from the materialized candidate and writes
config.systemPrompt — role bytes first, any pre-existing prompt appended
        │
        ▼
agent.session_open before-hook overlays a non-empty
SLP_SESSION_OPEN_GRANT onto the provider env
        │
        ▼
provider entry command: node <candidate>/bin/slp-gate.mjs <argv>
        │  gate verifies the grant is live — fails closed in a hook gap —
        ▼  then execs the real family binary (SLP_FAMILY_BIN)
provider session begins with SLP instructions already in its
durable context


devin — shim + role wrapper (unchanged)

human or agent calls create_agent(profile/provider, prompt)
        │
        ▼
Paseo resolves the slp-devin-* provider entry
        │
        ▼
launcher process starts  ── env: SLP_MANAGED_RUNTIME, SLP_NODE_BIN,
        │                      SLP_RUNTIME_ROOT, SLP_DAEMON_HOME
        ▼
slp-shim verifies the runtime payload (manifest digest + identity)
        │
        ▼
role wrapper renders the role bundle and rewrites the session/new
request — this is the injection — then starts the real provider
transport (ACP)
        │
        ▼
provider session (devin) begins with SLP
instructions already in its durable context
```

Devin keeps the wrapper transport because its ACP adapter drops
`systemPrompt` outright — the hook path cannot reach it (Phase 0 probe,
2026-09-19). For hook families the plugin is in the loop at session entry
via the two before-hooks, but never afterwards — no proxy, no monitoring
daemon, no session interception. The gate is what makes a hook gap (plugin
disabled or reloading) fail visibly instead of spawning an unroled seat.

## The hidden channel

A seat's context arrives through **two channels**, and only one is visible
in the UI:

1. **`initialPrompt` — visible.** Whatever the spawner passes to
   `create_agent`: the human's typed text for profile-pick spawns, or the
   planner's assignment block for `prepare`-rendered spawns.
2. **Session-entry injection — hidden.** Bytes appended to the provider's
   durable instruction channel while the session is being built — by the
   `agent.create` hook's `systemPrompt` write for codex/pi/claude, or by
   the role wrapper's `session/new` rewrite for devin. The seat sees it;
   the human does not — it never appears in the agent tab, the
   conversation view, or `initialPrompt`.

```
what the human sees              what the seat's context contains
┌─────────────────────┐          ┌──────────────────────────────────┐
│ initialPrompt:      │          │ SLP role=supervisor              │
│ "điều tra repo X,   │          │ common policy                    │
│  report về <id>"    │    +     │ supervisor role contract         │
└─────────────────────┘          │ delegation rules                 │
                                 │ managed runtime helpers          │
                                 │ communication language (if set)  │
                                 │ spawn kit (MCP signatures)       │
                                 │ policy locators (path + sha256)  │
                                 └──────────────────────────────────┘
                                    ^ injected at session entry — hook
                                      systemPrompt or role wrapper —
                                      invisible in UI
```

For the Devin (ACP) transport this lands in `appendSystemPrompt`; each
family has its own durable channel. The daemon's own global
`daemonAppendSystemPrompt` still applies too — separate owners, both reach
the session.

Why this design: the carrier used to live inside `prepare`-emitted
`initialPrompt`, which meant it was *visible but only existed on the
prepare path* — a profile-picked spawn silently lost its spawn kit and
policy locators. Moving the carrier into session entry makes it
*guaranteed on every `slp-*` launch but invisible*. The trade-off is
deliberate: correctness over transparency-by-default. Verification paths
exist — spawn a probe seat and ask it to enumerate its injected sections,
or render the bundle offline via `roleBundle()`.

What each spawn path puts in the visible prompt:

| Content | `prepare` spawn | Profile-pick spawn |
|---|---|---|
| Role instructions | hidden (injected) | hidden (injected) |
| Spawn kit + policy locators | visible in emitted prompt | hidden (injected) |
| `Launch binding:` record | visible | absent — shim cannot read profile fields |
| Structured assignment | planner-built | whatever the human types |
| Title (`Supervisor — <task>`) | planner-built | human-typed |

## The delegation loop

SLP orchestration is just Paseo primitives used in a disciplined order:

```
Human ──create_agent(profile=slp-supervisor)──▶ Supervisor seat
                                                    │ runs `prepare`
                                                    │ (renders title,
                                                    │  assignment,
                                                    │  binding, kit)
                                                    ▼
                              create_agent(provider=slp-*-lead)
                                                    │
                                                    ▼
                                              Lead seat ──prepare──▶
                              create_agent(provider=slp-*-peer, disposition)
                                                    │
                                                    ▼
                                              Peer seat ──handback──▶ Lead
                                                    │
                                              Lead ──handback──▶ Supervisor
                                                    │
                                              Supervisor ──▶ Human
```

`prepare` is the standalone planner: given a request (role, family, repo,
assignment, report-recipient), it emits the complete `create_agent`
argument record — correct title format, structured assignment, launch
binding, workspace. Orchestrating seats are instructed to route every
spawn through it, which is what keeps the chain consistent when humans
aren't in the loop. The spawn kit in each injected bundle is what lets a
seat call `create_agent`/`send_agent_prompt` without first paying the
MCP schema-discovery tax.

Peers return results by prompting the agent ID named in their assignment
(`report-recipient`) — Paseo agent messaging, no special channel.

## Ownership, state and recovery

The plugin treats the daemon home as something it borrows, not owns:

- **Receipt** (`slp-runtime/state/receipt.json`) records what the plugin
  believes it owns: which target, which binding hashes, which baseline.
- **Exclusive window**: mutating RPCs require the caller to assert that no
  other writer is touching the daemon home; concurrent operations get
  `BUSY` rather than a silent interleave.
- **Journal**: an operation's intent is persisted before its effects
  complete, so a crash mid-activate leaves a resumable intent instead of
  silent drift.
- **Reconcile**: `inspect` reports divergence between receipt and live
  config; `complete` finishes an interrupted operation; `restore-before`
  rolls it back. Foreign drift is reported, never auto-overwritten.

Deactivation detaches the owned provider/profile entries and restores the
shared MCP flag — but retains all runtime files, because live sessions may
still be executing from them.

## Boundaries

- The plugin installs and manages; it does **not** orchestrate. No
  agent-facing tools, no `create_agent`, no delegation logic.
- No background watchers — status is computed when asked.
- The Supervisor/Lead/Peer intelligence is **policy text + Paseo
  primitives**, not code in the plugin. The plugin's correctness job ends
  at "the right bytes reach the right session through the right channel."
