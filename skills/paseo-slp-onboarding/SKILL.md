---
name: paseo-slp-onboarding
description: Set up or revise a repository's Paseo SLP protocol and check its Human-configured agent profiles. Use when asked to onboard, set up or reconfigure SLP for a repo; skip ordinary Peer implementation.
---

# Paseo SLP repo onboarding

Configure repository tactics in .paseo-slp/WORKSPACE_PROTOCOL.md. Runtime settings
come from the Human's saved Paseo agent profiles: slp-supervisor, slp-lead and
slp-peer. Each must use its matching installed SLP role provider, a Human-selected
model and supported optional thinking/mode/features. Keep one Peer profile;
Engineer, Architect and Reviewer are assignment dispositions.

## Establish context

Resolve the assigned repository and host. Read AGENTS.md, existing protocol and
relevant project scripts/docs. Preserve Human settings and unrelated work. Locate
the installed bin/slp.mjs and read its src/templates/WORKSPACE_PROTOCOL.md and
src/references/provider-routing.md. Missing installation is a reported prerequisite;
repo onboarding does not grant host installation or profile edit authority.

Read Paseo list_profiles and list_providers, then discover models/settings for the
saved providers. Ask Human to configure missing/incompatible profile fields in
Paseo Settings → Agents → Agent profiles. Report exact profile IDs and mismatches.
Discovery verifies the saved choices; it does not authorize picking replacements,
changing profiles, copying model choices from the coordinator or bypassing profiles
with a repository catalog. Never store credentials in repo files or chat.

## Set up repository tactics

Use node <slp-cli> init <absolute-repo> to preview, then --apply within setup
authority. This creates the missing protocol and an empty optional routing catalog;
it preserves each existing file. Complete the protocol with task classes, ownership,
topology, proof, budget, escalation, allowed operations and settlement. Keep global
role bytes out of the protocol. An empty catalog is valid for saved-profile tasks.

For explicitly requested catalog experiments or migrations, preserve and validate
.paseo-slp/slp-routing.json using routes <absolute-repo>. Catalog options are a
separate runtime path for that assignment, never an automatic override of saved
profiles. --routing-from seeds only a missing catalog from an explicitly chosen
source; do not import another repository or host catalog implicitly. Read the
catalog schema in src/routing.mjs when editing that optional branch.

For layout migrations, inspect old/new paths, preserve bytes and reconcile
collisions before moving files. Configure only the assigned repo. Install this
skill separately in native project/user scope; do not place it in .paseo-slp.

## Verify and hand back

Check that the protocol expresses the supplied authority and required tactics.
Record actual profile/provider discovery and unresolved Human configuration needs.
Optional offline prepare with fresh profiles/providers verifies exact launch
arguments without requiring catalog options or starting an agent. Live tests require
separate authority. Report exact changed files, checks and profile blockers.
