# Settings-driven role providers and hook injection — post-v1 direction

Status: design sketch, gated on the Phase 0 probes below. Not scheduled and
not part of the Option A v1 contract
([paseo-plugin-implementation.md](paseo-plugin-implementation.md)). Builds on
the B0/B2 hook-seam findings in
[paseo-plugin-feasibility.md](paseo-plugin-feasibility.md).

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

## 6. Phase 2 — hook injection (conditional on S3)

- Register `agent.create` hook: read `config.provider`/marker → role →
  `roleBundle()` → `systemPrompt`.
- Hook families become thin `extends` aliases — no command, no shim, no
  launch-set entry.
- Sentinel so a launch during a hook gap fails visibly instead of
  spawning without a role contract.
- Byte-parity test between hook-rendered and wrapper-rendered bundles.
- Devin wrapper path untouched.

## 7. Phase 3 — mixed-artifact operations

- Reconcile/inspect understands both entry kinds (alias vs shim+env).
- Status surfaces mechanism per family only for diagnostics — the user
  contract stays uniform.
- Recovery semantics for agents spawned in a hook gap.
- Drift/receipt/journal entries record which mechanism each entry uses.

## 8. Explicit non-changes

Peer selection stays repo-pool + Lead judgment per delegation. Delegation
loop, role policies, `initialPrompt` as the visible channel, and the whole
Option A management plane (exclusive window, journal, receipt, reconcile,
immutable candidates) are unchanged. This is a distribution/UX refactor of
how role→provider is chosen and how instructions reach three of the four
families — not a behavior redesign.
