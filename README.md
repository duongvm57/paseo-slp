<h1 align="center">Paseo SLP</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">An independent Supervisor–Lead–Peer role pack for Paseo.</p>

Install once, pick **SLP Supervisor** in Paseo and hand it an objective. Role
instructions load automatically; the Supervisor observes an existing Lead or
creates one per assignment, and the Lead delegates to Peers through Paseo. You
can keep chatting in the existing Supervisor session — no need to re-enter the
role prompt.

## Requirements

- Node >=22, the Paseo CLI/daemon, and the Codex/Pi CLIs matching the
  providers you want to use.
- Each provider's credentials on the daemon host.
- Pi needs repeatable `--append-system-prompt` support (the tested Pi build
  has it).
- The installer integrates into an existing Paseo; it does not download or
  replace Paseo/Codex.

## Installation

```bash
./install.sh
# or: npm run install:slp
```

This installs the Markdown policies and CLI into `~/.local/share/paseo-slp`,
adds the twelve providers `slp-codex-{supervisor,lead,peer}`,
`slp-pi-{supervisor,lead,peer}`, `slp-devin-{supervisor,lead,peer}` and
`slp-claude-{supervisor,lead,peer}`, plus
two saved profiles **SLP Supervisor** and **SLP Lead** to
`$PASEO_HOME/config.json` (default `~/.paseo`), enables MCP injection and
reloads.

- No agent is created during install. The three roles stay intact.
- **Peers need no saved profile** — the Lead picks each Peer's runtime from
  the project pool in `.paseo-slp/slp-routing.json`.
- Repos keep their tactics in `.paseo-slp/WORKSPACE_PROTOCOL.md`; onboarding
  guides you through both files.
- Override the install location with `SLP_HOME=/absolute/path` and the host
  config with `PASEO_HOME=/absolute/home`. Run the installer on the daemon's
  host.
- Reinstalling the same candidate does not overwrite settings you have tuned.
  A different candidate or a conflicting ID is refused, preserving the
  current install.

To preview the entries before writing:

```bash
node bin/slp.mjs install /absolute/new/destination --paseo-home /absolute/paseo-home
# add --apply to write; add --reload to activate on the running daemon
```

## Upgrading

To upgrade an installed copy, cut over to a new directory; the command keeps
profile settings and leaves the old files for sessions still using them:

```bash
node bin/slp.mjs upgrade "$HOME/.local/share/paseo-slp.next" \
  --from "$HOME/.local/share/paseo-slp" --apply --reload
```

Drop `--apply --reload` for a dry run. Existing sessions keep their provider
process; the new profiles apply to later launches. Upgrade preserves the
current settings of `slp-peer` and any SLP-owned retired disposition profiles
by recording them in `paseo-binding.json` → `retiredProfiles` before removing
them from active profiles. The Supervisor/Lead profiles keep their chosen
settings; the project pool is neither modified nor auto-filled from old
profiles. An existing catalog and user-owned profiles outside this install
are preserved.

Keep the old directory around until dependent sessions have finished; do not
uninstall the old copy to remove entries that moved to the new one. `.next`
is only a temporary cutover path: after old sessions settle, move the
verified candidate back to the canonical `~/.local/share/paseo-slp`, reload,
then delete the temporary directory. Always use the path the providers
actually reference for `init` and `prepare`.

## Getting started

1. Install the package (above), then open a work workspace in Paseo.
2. Pick **SLP Supervisor** and enter an objective plus a normal authority
   scope, e.g. "Fix the cart-total display bug; you may edit code/tests in
   this repo; no commit/push/deploy."
3. Initialize each work repo once and onboard it (below).

Supervisor and Lead already carry the procedures for picking child profiles,
keeping parentage and using finish notifications. **SLP Lead** also works
when you want to hand work straight to a Lead.

## Skills

The onboarding skill teaches your agent how to set up this pack for a repo.

```bash
npx skills add duongvm57/paseo-slp --skill paseo-slp-onboarding
```

- `paseo-slp-onboarding` — interviews you for the Peer pool decision,
  communication language and Supervisor notebook, then writes `.paseo-slp/`
  correctly. Once installed it auto-triggers when you ask an agent to
  onboard/set up SLP.

(`paseo-slp-e2e` is not installed — it runs from a source checkout; see
[E2E](#e2e).)

No skills installed? Paste this into any agent:

```text
Help me understand and set up Paseo SLP. Read
https://raw.githubusercontent.com/duongvm57/paseo-slp/main/docs/agent-guide.md
first, then walk me through it step by step.
```

## Agent profiles

To set per-role model and reasoning:

1. Open **Settings → the host running the work → Agents → Agent profiles**.
2. Edit **SLP Supervisor** or **SLP Lead**.
3. Pick the matching `slp-codex-{role}`, `slp-pi-{role}`, `slp-devin-{role}`
   or `slp-claude-{role}` provider, then choose **Model**, **Thinking**, **Mode**
   where the provider offers them, plus features, then **Save**.
4. When creating a session directly, pick the saved profile in the model
   picker. For Peers, use onboarding to set up the repo pool; the Lead picks
   a suitable option from the pool and passes that provider/model/settings
   into `create_agent`.

**Thinking** is reasoning effort; **Mode** is the permission/approval level —
two separate settings. Pick values the provider/model actually offers. Agents
use `list_profiles`, `list_models` and `inspect_provider` for discovery; the
profile's `thinkingOptionId` is passed through as
`settings.thinkingOptionId` when creating the agent.

Editing a profile affects the next selection/launch; it does not update a
running session. For a live session, Paseo offers `update_agent` to change
model/thinking within the same provider when supported. The profile keeps its
own default for future sessions. See
[Paseo agent profiles](https://paseo.sh/docs/agent-profiles.md).

## Repository setup

Initialize each work repo once:

```bash
node "$HOME/.local/share/paseo-slp/bin/slp.mjs" init /absolute/job-repo --apply
```

Init only creates missing files and never overwrites existing ones:

- `.paseo-slp/WORKSPACE_PROTOCOL.md`: operating procedure, risk levels,
  proof gates, budget and fallback authority.
- `.paseo-slp/slp-routing.json`: the Peer runtime pool. Init seeds the
  [task-type skeleton](src/templates/slp-routing.json) — disabled seats
  named for kinds of work; onboarding fills real models from discovery
  before delegation. While a repo has no such file, the runtime reads the
  user-scope catalog `$PASEO_HOME/slp-routing.json` (default `~/.paseo`).
- `.paseo-slp/notebook.md`: the default Supervisor notebook; the protocol
  records its owner and the actual retrieval method (this file or
  `timeline:<agentId>`).

The user-scope catalog `$PASEO_HOME/slp-routing.json` exists because
`install`/`upgrade --apply` seeds the same skeleton when the file is absent;
it is never overwritten if it already exists. Its seats stay disabled until
onboarding or the Human fills in models — a skeleton-only user catalog means
no fallback pool, not an error. `uninstall` removes it only while it is still
byte-identical to the scaffold (hash recorded in `paseo-binding.json`); once
you have edited it, uninstall preserves it.

### Onboarding

The onboarding skill is installed separately so agents can auto-trigger it.
From a repo you want to use, install it project-locally (creates
`.agents/skills/paseo-slp-onboarding`, committable with the repo):

```bash
npx skills@latest add /absolute/path/to/paseo-slp \
  --skill paseo-slp-onboarding --copy --yes
```

Or install it globally for all of the user's repos:

```bash
npx skills@latest add /absolute/path/to/paseo-slp \
  --skill paseo-slp-onboarding --global --copy --yes
```

Once the package is published to GitHub, replace the local path with the
published URL/repository, e.g. `duongvm57/paseo-slp`. Use project mode or add
`--global` as above; pass `--agent <name>` to target one agent instead of
every detected one. Project skills land in `.agents/skills`, global skills
in `~/.agents/skills`; Codex and Pi discover both scopes directly, and the
installer also links them into each agent's own skills directory (e.g.
`.claude/skills`), so Claude picks them up the same way. Verify with
`npx skills@latest list` or add `--global` for user scope. Open a fresh session after installing, then
ask to onboard/set up SLP for the repo; the skill description triggers the
workflow. See the [source skill](skills/paseo-slp-onboarding/SKILL.md).

Protocol and catalog are two separate files: the protocol is operating
guidance, the JSON is machine-checkable data that changes often. Both belong
to the repo and can be versioned with the code; do not embed JSON inside
Markdown. The Lead reads the protocol and pool before every Peer delegation,
picks an option by task/budget, then passes the relevant constraints into the
assignment. A new worktree needs these files present in the base candidate or
an authorized copy; each worktree reads its own configuration.

### Importing an existing catalog

If you already have a global table from an earlier version, import it once
into the repo:

```bash
node "$HOME/.local/share/paseo-slp/bin/slp.mjs" init /absolute/job-repo \
  --routing-from /absolute/previous/slp-routing.json --apply
```

Import only creates a catalog when none exists; it does not overwrite, merge
silently or keep a link to the source file. Afterwards the Human edits the
repo copy. A repo with no catalog reads the user-scope catalog
`$PASEO_HOME/slp-routing.json`; an empty catalog in the repo is still
authoritative (it blocks delegation) until removed. A repo never reads
another repo's catalog.

## How the roles work

The protocol picks topology and proof gates by risk: a small task may use a
single Engineer; architecture/lifecycle-sensitive work gets an Architect, an
independent Reviewer or several lanes. The Peer role receives its disposition
through the assignment, independent of the runtime option. The Lead keeps
integration and technical acceptance; the Supervisor keeps observation and
relays Human decisions.

Supervisor/Lead prefer events first, with heartbeats as a safety net when the
task calls for it and authority allows; cadence and stop conditions belong to
the protocol/assignment. The installed references cover creating/removing
heartbeats on the right session, keeping a causal notebook, recovery and the
20 anti-patterns from the guide. Roles read references per situation; Peers
receive the relevant constraints through assignments. This is a policy pack
for agents using Paseo primitives — there is no monitoring daemon or semantic
detector in the package; `monitor` (below) is a caller-invoked, delta-only
signal scan.

## Peer runtime pool

**Runtime sources:** Supervisor/Lead use the two saved profiles the Human
configures in Paseo. Peers use the repo pool `.paseo-slp/slp-routing.json`,
or the user-scope catalog `$PASEO_HOME/slp-routing.json` when the repo has
none. Each option carries a `pi`/`codex`/`devin`/`claude` provider, model, settings,
`suitableFor`, `avoidFor`, `notes`, `priority` and an
`enabled`/`availability` state. The Lead chooses per task — Engineer,
Architect and Reviewer are not hard-mapped to models. Two Peers can differ in
provider/model/effort without any extra saved profile. The seeded
[task-type skeleton](src/templates/slp-routing.json) shows the shape: each
seat names a kind of work, and `model` stays blank until filled from live
discovery on the host.

The Lead reads the current pool, records its choice rationale and validates
option/hash via `prepare` before launching. With no valid pool/option at
either scope, finish onboarding first; there is no fallback to `slp-peer`, to
the Lead's own settings, or to another repo's catalog. `priority` is a
selection hint, not a replacement for suitability and budget judgment.

### Peer quota fallback

Configure it right in `.paseo-slp/slp-routing.json`:

```json
"quotaFallback": { "enabled": true, "optionIds": ["luna-code", "glm-design"] }
```

The IDs must exist in `options`; use the repo's real IDs. By default (or when
misconfigured) a branch stops when its quota runs out. The Lead picks a
remaining, suitable option from this list; `prepare` additionally accepts
`route.quotaFallbackFrom`, the ID of the option that ran out of quota. Do not
switch models outside the pool via `update_agent`, do not use a provider
default, and do not treat another model on the same account as fresh quota.
When no valid fallback remains, report BLOCKED; keep ownership and evidence
before handing off.

## Lead provider handoff

Switching a Lead to Pi when Codex runs out of quota: change the **SLP Lead**
profile's provider to `slp-pi-lead`, pick the matching model/thinking and
Save for later launches. To move work already running, tell the Supervisor:
"Codex is out of quota — move this Lead to Pi, keep the current scope and
hand off per the saved profile." The Supervisor checks the old Lead has
stopped orchestrating, collects state/evidence and creates a new Lead with
the same policy on Pi. If the old Lead cannot respond, the Supervisor pulls
state from the timeline/artifacts; no need to call the out-of-quota model
just for a summary. Without a Supervisor, the Human moves the handoff to a
new Lead session and confirms ownership.

This is a handoff to a new session: the host does not switch providers in
place and does not reparent Peers. The procedure preserves Peer
IDs/ownership, handles descendant access and wake sources; the new Lead takes
over after checking the handover state. If you want automatic standby
provider selection, record the fallback plus budget/authority in the protocol
beforehand; a quota error alone does not grant provider-switch authority.
Changing model/thinking within the same provider can use `update_agent`,
subject to provider capability.

## Agent naming

Agent naming uses `Supervisor — <task>`, `Lead — <task>` and
`Peer — <Disposition> — <task>`. For example `Peer — Engineer — checkout
totals` and `Peer — Reviewer — checkout totals` distinguish two jobs sharing
the Peer role. Pass `taskLabel` and `disposition` into `prepare`; with
multiple reviewers, add a scope to the taskLabel, e.g. `checkout totals /
API`. When omitted, taskLabel falls back to the repo directory name and the
disposition shows `General`. Resume keeps the name; a handed-off session adds
`Handoff`. The agent ID remains the identifier used for ownership and
reporting.

## CLI reference

### `prepare` / `prepare-handoff`

The optional offline path: `prepare` accepts role, repository, workspaceId
and assignment. Supervisor/Lead additionally take the `profiles`/`providers`
inventory; a Peer takes `providers` and `route: {optionId, catalogSha256}`
from `routes`. Profiles may accompany a Peer request for discovery, but they
never replace the pool. Two more optional fields, both also honored by
`prepare-handoff`:

- `inventoryFile`: absolute path to a JSON object carrying
  `providers`/`profiles`; these arrays only fill request fields that are not
  inline — an explicit inline array (even `[]`) always wins.
- `assignmentFile`: absolute path to the full assignment brief (must exist,
  be a regular file and be readable). The prompt keeps `assignment` as a
  short brief and appends `Assignment file: <path> — read it first; it is
  authoritative for scope details.`; the file content is not inlined.

An option decides the whole bundle and maps to
`slp-pi-peer`/`slp-codex-peer`/`slp-devin-peer`/`slp-claude-peer`; a model containing `/` is
kept verbatim. An explicit `binding` without profiles only supports
Supervisor/Lead when the Human authorizes it. Peers must always pick a pool
option, including during handoff and recovery.

The plan also surfaces the spawn's intended mode — top-level `modeId`
mirroring `create.settings.modeId`, plus `warnings` when the binding lacks
one — and two locator payloads carried inside `create.initialPrompt` so the
spawned seat actually receives them: `spawnKit`, role-scoped approximate
Paseo MCP tool signatures (verify against live `mcp_list_tools`), and
`orientation`, policy-byte locators (`path`, `bytes`, `sha256`, or
`missing: true` for declared files the install does not ship). Locators
only — interpretation stays with the seat.

`prepare-handoff <request.json>` adds the snapshot and handoff packet to the
create_agent arguments; see the
[handoff example](examples/provider-handoff.request.json).
Both commands only prepare arguments; Supervisor/Lead use Paseo to actually
create the agent.

### `inventory` / `agents`

Two read-only commands support discovery and work offline (no daemon or
`paseo` on PATH required):

```bash
node bin/slp.mjs inventory [--paseo-home /absolute/paseo-home]
node bin/slp.mjs agents [--paseo-home /absolute/paseo-home]
```

`inventory` prints `{providers, profiles, source}` in exactly the shape
`prepare` consumes. It only calls `paseo provider ls --json` when the given
home's `paseo.pid` names a live process; otherwise it reads
`agents.providers` from that home's own `config.json` — it never takes
providers from another daemon and never creates directories. Live providers
are normalized to `{id, enabled, status}` (`enabled` may be `null` when the
state is unrecognized), while config yields `{id, enabled, extends}`;
profiles always come from `daemon.agentProfiles`. On multi-daemon hosts, the
live listing reflects whichever daemon the `paseo` CLI reaches. `agents`
lists `<home>/agents/*/<id>.json` as `{id, title, provider, cwd,
workspaceId, status, lastActivityAt, nativeHandle, attach}`; `attach` is a shell-quoted `cd
<cwd> && devin -r <nativeHandle>` hint for devin providers with a handle.
Because `paseo inspect`/`ls` do not return `persistence.nativeHandle`, this
command reads daemon persistence — a host detail, best-effort, not a
contract.

### `snapshot`

`snapshot <repo>` records a work snapshot covering HEAD, tracked/untracked
non-ignored paths, contents, symlinks, permission modes and deleted markers.
An untracked directory that is the root of a nested Git repo is snapshotted
recursively and recorded under `nested` (each sub-repo gets its own `{path,
head, sha256, files}` and may carry its own `nested`, all counted in the
overall sha256). Staged submodule gitlinks (mode 160000) and listed
directories that are not repos remain unsupported.

### `materialize`

`.paseo-slp/` is gitignored local state with absolute paths, so a fresh
worktree lacks the protocol and catalog entirely. `materialize` clones them
from an existing checkout:

```bash
node bin/slp.mjs materialize /absolute/target-repo --from /absolute/source-repo
# dry-run by default; add --apply to write
```

It copies only `.paseo-slp/WORKSPACE_PROTOCOL.md` and
`.paseo-slp/slp-routing.json` (validated) — `notebook.md` is Supervisor-owned
state and is never copied. Absolute source-root paths inside the protocol's
YAML frontmatter are rebased to the target root (a longer sibling path like
`<source>-old` is not a boundary match and stays put). Like `init`, existing
target files are preserved rather than overwritten; each file reports
`preserved`/`applied`, plus `sha256` for files it would write. The protocol
entry also reports `rebased`, and a written copy that found no source-root
path carries a `warning` instead of silently keeping stale paths. There is
no fallback to the user-scope catalog or the package template — the source
checkout is explicit.

### `monitor`

`monitor` is an on-demand signal scan for an observing Supervisor/Lead —
one invocation is one scan, not a daemon, and it emits candidates, never
verdicts:

```bash
node bin/slp.mjs monitor /absolute/request.json
```

The request names `agents` (`id`, optional `cwd` — falls back to the state
file's `cwd` — and optional `scope` prefix/glob list), plus optional
`paseoHome` (default `$PASEO_HOME`/`~/.paseo`), `devinSessionsDb` (absolute
path, opt-in), `thresholds` (`idleMinutes`, `churnScans`; `toolWindow`
default 20, `toolShare` default 0.8 and `cadenceEdits` default 3 for the
sessions-db signals), a `signals` subset and a `stateFile` checkpoint path.
Evidence comes from `<paseoHome>/agents/*/<id>.json` and `git
status`/`git log` in each `cwd`; a missing or non-repo `cwd` is recorded as
an evidence gap instead of crashing. With `devinSessionsDb` it also probes
that devin CLI sessions db (read-only; typically
`~/.local/share/devin/cli/sessions.db`) for devin-provider agents; a missing
or unreadable db is a gap entry, not an error. Signal kinds: `attention`
(only when `requiresAttention` is true — a stale `attentionReason` is just
evidence), `follow-up-round` (user bumps without an intervening commit),
`idle-dirty`, `scope-drift`, `test-mirror`, `file-churn` (the same dirty
path edited again across scans, tracked by mtime), `tool-mix` and
`correction-cadence` (sessions-db candidates, require `devinSessionsDb`). With `stateFile`, only new
fingerprints are emitted and the checkpoint — the command's only write — is
rewritten atomically every run; without it the scan is flagged `stateless`
and emits everything detectable. Rendered `paseo logs` output is never
parsed; `get_agent_activity` returns only a curated, `limit`-bounded tail
(long sessions truncate into overflow files), so a complete structured
timeline stays a recorded host gap.

### `notebook`

`notebook` locates the governance notebook for a repository when the active
run lives in another checkout — a worktree Supervisor's record sits at
`<its-checkout>/.paseo-slp/notebook.md`, invisible from the main checkout:

```bash
node bin/slp.mjs notebook /absolute/repository [--paseo-home /absolute/paseo-home]
```

It resolves the repository's git common dir — the property linking a
worktree back to its repository — then lists Supervisor agents (provider
containing `supervisor`, or a `Supervisor`-titled state file) whose `cwd`
shares it. Output is candidates only: `{agentId, title, status, cwd,
lastActivityAt, notebook, notebookExists}` sorted by most recent activity,
plus `gaps` for agent cwds that fail the git probe. Read-only — it never
copies, merges or edits notebook content, and picks no authoritative
candidate; where governance lives stays per-checkout.

## Uninstall

Uninstall after the sessions using the install have finished:

```bash
node bin/slp.mjs uninstall "$HOME/.local/share/paseo-slp" --apply --reload
```

Uninstall removes the entries the install created and restores the two MCP
flags from before; it keeps other config and a Human-edited catalog. The
user-scope catalog scaffold is removed only while still unmodified (recorded
hash), so a catalog you populated survives. If an
installed profile/provider/file has been modified, the command stops and
leaves everything in place for you to decide how to keep the changes. The
protocol in the work repo is preserved. A reload failure does not roll back
the file writes: the output reports `reloadRequired`/`reloadError`; rerun
`PASEO_HOME=/absolute/home paseo reload --json` after fixing the cause. The
installer never restarts the daemon itself nor answers agent permission
prompts.

## Testing

```bash
npm test
npm run check
```

Local checks cover install–uninstall, config preservation, protocol and the
stdio adapter; they do not prove role compliance with the operating guide.
The transport was previously cross-checked against Paseo 0.7.2/Codex
0.153.4; there is no E2E acceptance for this revision yet. Roles are
behavioral instructions, not a filesystem/MCP sandbox. The transport supports
Codex, Pi, Devin and Claude; routing, adapter, upgrade and handoff have local checks. Live
provider switching, heartbeat, council, recovery and concurrent writers are
not yet E2E-accepted. Capability and policy-load paths are recorded in the
trace table below.

## E2E

To dogfood from an open session on this **source checkout**, ask: **"run the
package's full E2E"**. The [E2E skill](skills/paseo-slp-e2e/SKILL.md) walks
the session through the whole [scenario manifest](e2e/scenarios.mjs), using
child sessions on a real Paseo, collecting evidence, reviewing independently
and cleaning up, then returns one combined report. Granted permissions, host
and budget are reused; branches missing prerequisites are recorded BLOCKED.
`npm run e2e` only prints the session entrypoint (exit 2, does not run live);
the fixture/evidence/verdict subcommands are described in the
[E2E guide](e2e/README.md). This harness has no live acceptance yet; adding
the entrypoint does not change the unverified E2E states above.

To run a `basic-*` scenario, configure the two Supervisor/Lead
profiles and the fixture's Peer pool for the matching family. The coordinator
prepares fixture/protocol, pool and baseline; the Supervisor creates a Lead
per the saved profile, the Lead picks the Peer option itself. There is no
pre-launch confirmer for basic. U2 cross-checks profiles for Supervisor/Lead
and option/hash for the Peer. `mixed-peer` checks a pool containing both
Codex/Pi — no extra saved profile needed and no forcing the Lead's family per
Peer. Scenarios outside the scope stay NOT_RUN.

The offline path remains: `install <dir> --apply` without `--paseo-home` only
stages the package; `prepare <request.json>` emits create_agent arguments
with a role envelope. This path registers no profile and creates no agent
itself.

## Documentation

- [Agent setup guide](docs/agent-guide.md)
- [File map and contract](docs/contract.md)
- [Guide → policy, procedure and protocol trace](docs/guide-coverage.md)
- [Independent acceptance checklist](docs/review-checklist.md)

Referenced host mechanisms:
[custom providers](https://paseo.sh/docs/custom-providers.md),
[agent profiles](https://paseo.sh/docs/agent-profiles.md),
[Codex app-server](https://learn.chatgpt.com/docs/app-server#threads).
