# Contributor contract

For this repository, delegate through Paseo `create_agent` so the Human can
inspect and chat with each agent. Codex internal sub-agents are disabled; do not
use native spawn/delegation tools, including when a skill requests sub-agents.

Paseo SLP is an independent SLP policy package for Paseo. Before changing role
behavior, read docs/contract.md. The Human’s current assignment determines task
authority.

Keep one writer per moving scope and preserve unrelated work. Report exact
artifacts and actual checks on a stable candidate; local checks are not E2E
acceptance. Record missing host capabilities before adding workarounds.
Keep repository tactics in workspace-protocol.md, outside global roles.
Runtime installation, host configuration, live agents, commit and push require
task authority. Other repositories are read-only unless explicitly authorized.

When asked to run E2E or dogfood this package, read
skills/paseo-slp-e2e/SKILL.md and execute the requested scenarios from this session
(the whole manifest for a full-suite request). Resume an existing run when requested;
report every scenario, including blocked and unrun branches. Repository E2E tactics
live in e2e/workspace-protocol.md.

## Commits and releases

Commit messages must be conventional (`feat:`, `fix:`, `docs:`, `chore:`,
`refactor:`, `perf:`; optional scope; `!` suffix or `BREAKING CHANGE:` footer
for breaking changes). release-please generates CHANGELOG.md and version bumps
from these messages — never edit CHANGELOG.md release sections or the
package.json version field by hand, and never create git tags or GitHub
releases. Tags and releases are Human authority.
