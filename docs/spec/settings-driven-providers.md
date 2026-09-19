# Settings-driven role providers and hook injection — post-v1 direction

Status: Phase 0 probes **ran on the live daemon 2026-09-19** — all gates
passed (results below). Phase 1 (settings-driven generation, `f3465cc`) and
Phase 2 (hook injection + sentinel-gated thin aliases) are implemented on
branch `feat/slp-paseo-plugin`. Phase 3 (mixed-artifact operations) remains
open. Not part of the Option A v1 contract
([paseo-plugin-implementation.md](paseo-plugin-implementation.md)).
Builds on the B0/B2 hook-seam findings in
[paseo-plugin-feasibility.md](paseo-plugin-feasibility.md).

## Phase 0 probe results (2026-09-19, daemon home ~/.paseo, Paseo 0.8.0)

Probe vehicle: one throwaway directory plugin `slp-probe`
(`.local-checks/slp-probe/`), registering `agent.create` + `agent.session_open`
before-hooks that dump hook-visible payloads to JSONL and inject a sentinel
`systemPrompt` on agents titled `slp-probe-*`. Removed after the probes; the
managed `paseo-slp` entries were never touched.

| Probe | Result | Evidence |
|---|---|---|
| S3 hook inject | **PASS** — all three hook families | Hook-set `config.systemPrompt` reached real seats: codex `f51582fe` echoed the sentinel at create and again on turn 2; pi `7abb3fe8` and claude `69d9288c` echoed at create. Turn-level persistence verified on codex; a process-level `session/load` resume was not exercised (limitation). |
| Config marker | **PASS** | `settings.features {slp_role:"probe-peer"}` arrived intact in hook-visible `config.featureValues` — arbitrary keys survive `create_agent` → `agent.create`. Hook-visible config keys observed: `cwd, featureValues, modeId, model, provider, thinkingOptionId, title` (+`systemPrompt`, `providerOptions`, `mcpServers`, `internal` when set). No `profileId`, `initialPrompt`, `labels`, or `env` (spawn env). |
| Model enumeration | **PASS** | `providers.listModels` live: codex=5, pi=473, claude=15 — the shipped `catalog` RPC already wraps this; a model picker inside the SLP UI is viable. |
| Sentinel | **PASS** — primitives proven, guard required | `agent.session_open` env reaches the provider process env (`SLP_PROBE_GRANT` visible in the codex seat's shell and on an `slp-codex-peer` seat alongside provider-entry env `SLP_MANAGED_RUNTIME`); hook env overlays provider env (`createProviderEnvSpec` applies `runtimeSettings.env` then launch overlays). With the plugin **disabled**, a spawn fired no hooks and started unroled — fail-open confirmed, so a sentinel guard (grant-check gate or marker command + hook `config.provider` rewrite — both viable per `lifecycle/index.js` which only forbids `cwd` changes) is mandatory for thin aliases. |
| Devin reconfirm | **PASS (as expected)** | Live negative control: the devin seat answered `NO-SENTINEL` although the hook set `systemPrompt` — the 0.8.0 ACP adapter still drops it (`acp-agent.js` `session/new` sends only `{cwd, mcpServers}`). Devin keeps the wrapper. |

Consequences: Phase 2 hook injection is **green-lit** for codex/pi/claude; the
config-marker pass makes the 4-provider variant (role via `featureValues`
marker, e.g. `slp_role`) implementable, with 12 thin aliases as fallback;
fail-closed during a hook gap requires a sentinel guard on every hook-family
entry; the devin path is unchanged.

## 1. Goal

Move role→provider choice out of the provider list and into plugin
settings, and use the `agent.create` hook seam where the contract proves it.

User-facing:

- The SLP surface shows one card per role: **Supervisor → [family] [model]**,
  **Lead → [family] [model]**, Peer → pool-driven (informational).
- Users pick *native* family names (`devin`, `codex`, `pi`, `claude`) and a
  model. They never see `slp-*` provider IDs or twelve provider entries.

Daemon-facing:

- Activation generates only the entries the settings use — typically 4–8
  providers instead of twelve. Hook-injectable families become thin aliases
  (`extends`, no shim/wrapper); devin keeps the full shim + wrapper.
- The plugin writes the two saved profiles already bound to the chosen
  provider and model — the Human no longer edits `slp-*` IDs in the Paseo
  profile editor.

Behavior contract (must stay uniform regardless of mechanism):

- Every managed seat receives byte-identical `roleBundle()` output whether
  it arrived through the hook path or the wrapper path.
- Failure surface is uniform: fail-closed with an actionable error. No
  silent bare spawn in a hook gap.

## 2. Why providers exist at all — constraint recap

The provider entry is the only seam Paseo gives a plugin inside the spawn
path; something must carry the role down to the injection point. The
candidate channels:

| Channel | Status |
|---|---|
| Provider ID → shim/argv (v1) | Proven — each entry owns its command/env |
| `config` marker via profile settings/features | Unverified — arbitrary keys may not survive profile→config, and the hook must be able to read them |
| `initialPrompt` marker | Rejected — visible in the tab, and profiles cannot set initialPrompt |

The `agent.create` hook adds a new *injection* seam (it can write
`config.systemPrompt`; source-proven for codex/pi/claude) but not a new
*signaling* seam: the hook sees only `config` + `env` — no `profileId`, no
`initialPrompt`, no labels. So even under hook injection, role identity
still has to arrive through `config` — normally the provider ID. Thin
aliases keep that signal; the config-marker probe (Phase 0) decides whether
four providers suffice instead of twelve.

Devin/ACP is the exception the design must absorb: the 0.8.0 ACP adapter
drops `systemPrompt` outright (`session/new` sends only `{cwd,
mcpServers}`), so devin keeps the wrapper transport under any variant.

## 3. Target architecture

```
SLP surface ── role cards (family + model per role)
      │ set-role-routing RPC
      ▼
slp-runtime/state/role-routing.json      {supervisor:{family,model,…}, lead:{…}}
      │ consumed at activation
      ▼
desiredProviderEntries(settings) ──► only chosen combos + peers
      │                              thin alias | shim+wrapper (devin)
      ▼
config.json ──► profiles slp-supervisor/slp-lead bound to chosen provider+model
```

Injection paths at runtime:

```
hook family (codex/pi/claude): create_agent → agent.create hook
      → config.provider / marker → roleBundle() → systemPrompt → native CLI
devin:                          create_agent → provider entry → shim
      → verify → role wrapper → roleBundle() → ACP transport
```

`roleBundle()` stays the single render point for both paths — parity is a
tested invariant, not a convention.

## 4. Phase 0 — contract probes (gate)

| Probe | Question | Pass → | Fail → |
|---|---|---|---|
| S3 hook inject | Does an `agent.create` hook-set `systemPrompt` reach a real codex/pi seat at session start and on resume? | Hook path viable | Keep A1 wrappers for all families; Phase 1 still ships |
| Config marker | Do profile settings/features reach hook-visible `config` intact? | 4 providers (role via marker) | 12 thin aliases (role via provider ID) |
| Model enumeration | Can the plugin RPC surface list models per provider? | Model picker inside SLP UI | Model/thinking stays in Paseo profile editor; settings pick family only |
| Sentinel | Can a thin alias + hook fail closed during a hook gap (reload/disable)? | B0 safe to build | Hook path needs another guard or is dropped |
| Devin reconfirm | Does the current build's ACP adapter still drop `systemPrompt`? | (expected) wrapper stays | Revisit devin via hook |

## 5. Phase 1 — settings-driven generation (independent of hook)

Valuable even if the hook path dies.

- `slp-runtime/state/role-routing.json` + `get-role-routing` /
  `set-role-routing` RPCs (same pattern as `communication-language`).
- `desiredProviderEntries` reads settings and generates only chosen
  supervisor/lead combos plus the four peer providers (peers stay
  pool-driven; gating peers by enabled families is a documented option but
  couples repo pools to daemon settings — default is all four).
- Plugin writes both profiles bound to the chosen provider (+model when
  enumeration proves out); reconcile defines who wins between
  settings-driven regeneration and the existing profile bound-edit flow.
- Surface: role cards with pickers; migration path rebinds existing v1
  installs through one re-activation.

## 6. Phase 2 — hook injection (implemented)

As built on `feat/slp-paseo-plugin`:

- `plugin/index.server.ts` registers two `server.before` hooks, implemented
  in `plugin/server/role-injection.ts`:
  - `agent.create` resolves the role from an owned
    `slp-(codex|pi|claude)-(supervisor|lead|peer)` provider id (or the
    `featureValues.slp_role` marker on an un-suffixed `slp-*` id), reads the
    active binding from the journal receipt, dynamically imports the
    materialized candidate's `src/role-bundle.mjs` (cached per candidate
    sha), and writes `config.systemPrompt` — role bundle first, a
    pre-existing prompt appended after it. Foreign providers and
    `slp-devin-*` pass through untouched; an `slp-*` provider whose role,
    binding or candidate cannot be resolved aborts the create (fail-closed).
    `config.provider` is never rewritten.
  - `agent.session_open` overlays a non-empty per-open
    `SLP_SESSION_OPEN_GRANT` onto the provider env for hook-family ids —
    every open reason (create/resume/refresh/import).
- Thin aliases diverge from the "no command" sketch: a pure `extends` alias
  cannot fail closed (Phase 0 sentinel probe), so each hook-family entry
  keeps its `slp-*` identity + native `extends` and runs a generated
  gate launcher as its single-element `command`, with env carrying the
  managed backstop (`SLP_MANAGED_RUNTIME`, `SLP_NODE_BIN`,
  `SLP_RUNTIME_ROOT`, `SLP_DAEMON_HOME`, `PASEO_HOME`, the family's
  `SLP_*_BIN`) plus `SLP_SESSION_OPEN_GRANT: ""` and
  `SLP_FAMILY_BIN: <resolved binary>`. The gate launcher is a trivial
  `#!/bin/sh` exec script that bakes the verified Node path and exports
  the frozen `SLP_FAMILY_BIN`, then `exec`s
  `<candidate>/bin/slp-gate.mjs "$@"` — required because the host's
  availability probe runs `command[0] --version` with the command tail
  *and* provider env dropped (`resolveBinaryVersion`,
  `diagnostic-utils.js`), so argv0 must be a self-contained executable;
  a two-element `[node, gate]` command would measure Node's version, and
  a wrapper reading env vars cannot resolve them during the probe. The
  gate (`bin/slp-gate.mjs`, shipped in the embedded payload) refuses any
  launch whose grant stayed empty — the exact hook-gap case — and forwards
  argv/stdio/exit-status to the family binary otherwise. The bare
  `--version` probe answers through the real binary in every grant state
  (host availability probes run outside any session open).
- Launch sets publish all twelve launchers: the nine hook-family gate
  launchers plus the three devin shim dispatchers. The launch manifest
  still records all four family resolutions for shim validation, and new
  manifests carry `launcherFamilies` (all four families) plus
  `gateFamilies` (codex/pi/claude) so verify replays the right script per
  file (pre-Phase-2 manifests without the fields replay the legacy
  all-shim 12-launcher plan).
- Byte-parity test between hook-rendered and wrapper-rendered bundles
  across all twelve owned ids (tests/plugin-role-injection.test.mjs).
- Devin wrapper path untouched.
- Live-daemon smoke remains pending — unit/parity coverage plus the Phase 0
  live evidence stand in per the assignment.

## 7. Phase 3 — mixed-artifact operations

- Reconcile/inspect understands both entry kinds (alias vs shim+env).
- Status surfaces mechanism per family only for diagnostics — the user
  contract stays uniform.
- Recovery semantics for agents spawned in a hook gap. The deferred
  failure mode: if the `agent.create` hook is down but the launch itself
  somehow proceeds past the gate (e.g. a spawn path that bypasses the
  sentinel), the seat is created without role bytes — and nothing marks
  it. A later resume/reload of that agent re-opens the session through
  `agent.session_open`, which only supplies the grant; the role-injection
  hook does not re-fire on resume, and the gate cannot tell that the
  seat's durable context is missing its role. Such an agent resumes
  permanently unroled. Phase 3 must decide how to detect and handle these
  gap-spawned seats (e.g. marking creates with a durable role marker the
  gate or reconcile can check on resume).
- Drift/receipt/journal entries record which mechanism each entry uses.

## 8. Explicit non-changes

Peer selection stays repo-pool + Lead judgment per delegation. Delegation
loop, role policies, `initialPrompt` as the visible channel, and the whole
Option A management plane (exclusive window, journal, receipt, reconcile,
immutable candidates) are unchanged. This is a distribution/UX refactor of
how role→provider is chosen and how instructions reach three of the four
families — not a behavior redesign.
