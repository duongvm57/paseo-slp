// tests/plugin-routing.test.mjs — Phase 1 settings-driven provider
// generation (docs/spec/settings-driven-providers.md §5): the plugin-owned
// role-routing file at slp-runtime/state/role-routing.json, the
// get/set-role-routing RPCs, routing-driven provider/profile generation,
// rebind removal of non-chosen combos, the dependent-reference guard, and
// the absent/legacy → all-twelve backward-compatibility decision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createManager } from '../plugin/server/manager.ts';
import {
  OWNED_IDS,
  activateInput,
  deactivateInput,
  makeBinaries,
  makeDaemon,
  makeDeps,
  makeHome,
  opConflicts,
  readConfigJson,
  readReceipt,
  slpProvidersOf,
  targetOf,
  waitTerminal,
} from './helpers/plugin-doubles.mjs';

const routingPath = home => join(home, 'slp-runtime', 'state', 'role-routing.json');
const writeRoutingFile = (home, text) => {
  mkdirSync(dirname(routingPath(home)), { recursive: true });
  writeFileSync(routingPath(home), text, { mode: 0o600 });
};

const setRouting = (manager, home, supervisor, lead) =>
  manager.setRoleRouting({ schemaVersion: 1, target: targetOf(home), routing: { schemaVersion: 1, supervisor, lead } });
const getRouting = (manager, home) =>
  manager.getRoleRouting({ schemaVersion: 1, target: targetOf(home) });

// The six generated ids under a routing: chosen supervisor + chosen lead
// combos plus all four pool-driven peers — nothing else.
const generatedIds = (supFamily, leadFamily) =>
  [`slp-${supFamily}-supervisor`, `slp-${leadFamily}-lead`, 'slp-codex-peer', 'slp-pi-peer', 'slp-devin-peer', 'slp-claude-peer'].sort();
const absentIds = (supFamily, leadFamily) =>
  OWNED_IDS.filter(id => !generatedIds(supFamily, leadFamily).includes(id));

// ---------------------------------------------------------------------------
// State file + RPC surface
// ---------------------------------------------------------------------------

test('role-routing file round-trips through get/set before any activation', async t => {
  const home = makeHome(t);
  const manager = createManager(makeDeps());
  const file = routingPath(home);

  // Unset → null (the legacy all-twelve generation applies).
  assert.equal(existsSync(file), false);
  assert.deepEqual(await getRouting(manager, home), { schemaVersion: 1, routing: null });

  // Set → lands atomically with private mode; get returns the stored value.
  const choice = {
    supervisor: { family: 'pi', model: 'pi-model', modeId: 'fast' },
    lead: { family: 'devin', model: 'swe-2-max', thinkingOptionId: 'high', featureValues: { auto_accept: true } },
  };
  const set = await setRouting(manager, home, choice.supervisor, choice.lead);
  assert.deepEqual(set, { schemaVersion: 1, routing: { schemaVersion: 1, ...choice } });
  assert.equal(lstatSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { schemaVersion: 1, ...choice });
  assert.deepEqual(await getRouting(manager, home), { schemaVersion: 1, routing: { schemaVersion: 1, ...choice } });

  // Overwrite → the whole document is replaced (no field merge).
  const next = { family: 'claude' };
  await setRouting(manager, home, choice.supervisor, next);
  const read = await getRouting(manager, home);
  assert.deepEqual(read.routing.lead, next, 'a saved routing replaces the previous document verbatim');
  assert.equal(read.routing.supervisor.model, 'pi-model');

  // No tmp siblings survive the atomic write.
  const stateDir = join(home, 'slp-runtime', 'state');
  assert.deepEqual(
    (await import('node:fs')).readdirSync(stateDir).filter(name => name.endsWith('.tmp')),
    [],
  );
});

test('set-role-routing rejects malformed input and unknown keys', async t => {
  const home = makeHome(t);
  const manager = createManager(makeDeps());
  const target = targetOf(home);
  const base = { family: 'codex' };
  const cases = [
    ['unknown top-level key', { schemaVersion: 1, target, routing: { schemaVersion: 1, supervisor: base, lead: base, extra: 1 } }],
    ['unknown RoleChoice key', { schemaVersion: 1, target, routing: { schemaVersion: 1, supervisor: { ...base, bogus: 'x' }, lead: base } }],
    ['unknown family', { schemaVersion: 1, target, routing: { schemaVersion: 1, supervisor: { family: 'gpt' }, lead: base } }],
    ['missing lead', { schemaVersion: 1, target, routing: { schemaVersion: 1, supervisor: base } }],
    ['empty model string', { schemaVersion: 1, target, routing: { schemaVersion: 1, supervisor: { ...base, model: '' }, lead: base } }],
    ['non-record featureValues', { schemaVersion: 1, target, routing: { schemaVersion: 1, supervisor: { ...base, featureValues: 'x' }, lead: base } }],
    ['wrong schemaVersion', { schemaVersion: 1, target, routing: { schemaVersion: 2, supervisor: base, lead: base } }],
    ['missing routing', { schemaVersion: 1, target }],
  ];
  for (const [name, input] of cases) {
    await assert.rejects(() => manager.setRoleRouting(input), /invalid set-role-routing input/, name);
  }
  await assert.rejects(
    () => manager.getRoleRouting({ schemaVersion: 1 }),
    /invalid get-role-routing input/,
  );
  assert.equal(existsSync(routingPath(home)), false, 'a rejected write never creates the file');
});

// ---------------------------------------------------------------------------
// Backward compatibility: absent/legacy routing → v1 all-twelve generation
// ---------------------------------------------------------------------------

test('malformed or legacy-version routing file degrades to all-twelve generation', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t);
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  writeRoutingFile(home, '{"schemaVersion":2,"supervisor":{"family":"pi"},"lead":{"family":"pi"}}\n');
  assert.deepEqual(await getRouting(manager, home), { schemaVersion: 1, routing: null });
  writeRoutingFile(home, 'not json at all');
  assert.deepEqual(await getRouting(manager, home), { schemaVersion: 1, routing: null });

  const act = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  const done = await waitTerminal(manager, home, act.operation.operationId, daemon);
  assert.equal(done.state, 'ACTIVE');
  assert.equal(Object.keys(slpProvidersOf(readConfigJson(home))).length, 12, 'legacy routing keeps v1 generation');
});

// ---------------------------------------------------------------------------
// Settings-driven generation
// ---------------------------------------------------------------------------

test('routing generates the two chosen combos plus all four peers', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t);
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  await setRouting(
    manager, home,
    { family: 'pi', model: 'pi-model', modeId: 'fast' },
    { family: 'devin', model: 'swe-2-max', thinkingOptionId: 'high', featureValues: { auto_accept: true } },
  );
  const act = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  const done = await waitTerminal(manager, home, act.operation.operationId, daemon);
  assert.equal(done.state, 'ACTIVE');

  const providers = slpProvidersOf(readConfigJson(home));
  assert.deepEqual(Object.keys(providers).sort(), generatedIds('pi', 'devin'));
  for (const id of absentIds('pi', 'devin')) {
    assert.equal(providers[id], undefined, `${id} must be absent under the routing`);
  }

  const profiles = readConfigJson(home).daemon.agentProfiles;
  const supervisor = profiles.find(p => p.id === 'slp-supervisor');
  const lead = profiles.find(p => p.id === 'slp-lead');
  assert.equal(supervisor.provider, 'slp-pi-supervisor');
  assert.equal(supervisor.model, 'pi-model');
  assert.equal(supervisor.modeId, 'fast');
  assert.equal(lead.provider, 'slp-devin-lead');
  assert.equal(lead.model, 'swe-2-max');
  assert.equal(lead.thinkingOptionId, 'high');
  assert.deepEqual(lead.featureValues, { auto_accept: true });

  // The recorded projection still spans all twelve owned ids — the
  // non-chosen six are present:false, which is what drives removal.
  const binding = readReceipt(home).binding;
  assert.deepEqual(Object.keys(binding.owned.providers).sort(), OWNED_IDS);
  for (const id of absentIds('pi', 'devin')) {
    assert.equal(binding.owned.providers[id].present, false, `${id} recorded absent`);
  }
  for (const id of generatedIds('pi', 'devin')) {
    assert.equal(binding.owned.providers[id].present, true, `${id} recorded present`);
  }
});

test('explicit profiles input overrides routing; a family override generates its provider', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t);
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  await setRouting(manager, home, { family: 'pi', model: 'routing-model' }, { family: 'devin' });
  const act = await manager.activate(
    activateInput(home, deps.payload, randomUUID(), {
      profiles: {
        supervisor: { model: 'override-model' },
        lead: { family: 'claude', model: 'swe-2-max' },
      },
    }),
    daemon,
  );
  const done = await waitTerminal(manager, home, act.operation.operationId, daemon);
  assert.equal(done.state, 'ACTIVE');

  const profiles = readConfigJson(home).daemon.agentProfiles;
  const supervisor = profiles.find(p => p.id === 'slp-supervisor');
  const lead = profiles.find(p => p.id === 'slp-lead');
  assert.equal(supervisor.provider, 'slp-pi-supervisor', 'routing still supplies the provider');
  assert.equal(supervisor.model, 'override-model', 'explicit model wins over routing');
  assert.equal(lead.provider, 'slp-claude-lead', 'explicit family repoint wins over routing');
  assert.equal(lead.model, 'swe-2-max');

  const providers = slpProvidersOf(readConfigJson(home));
  assert.equal(providers['slp-claude-lead']?.enabled, true, 'the overridden family provider is generated');
  assert.equal(providers['slp-devin-lead'], undefined, 'the routing-chosen lead family is no longer generated');
});

test('routing that selects an unavailable family fails closed at plan time', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t, ['codex', 'pi', 'devin']); // claude unresolved
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  await setRouting(manager, home, { family: 'claude' }, { family: 'codex' });
  const act = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  const done = await waitTerminal(manager, home, act.operation.operationId, daemon);
  assert.equal(done.operation.outcome, 'failed');
  assert.ok(opConflicts(home, act.operation.operationId).includes('EXECUTABLE_UNAVAILABLE'));
  assert.equal(Object.keys(slpProvidersOf(readConfigJson(home))).length, 0, 'a rejected routing writes nothing');
});

// ---------------------------------------------------------------------------
// Rebind / migration
// ---------------------------------------------------------------------------

test('routing change on an existing binding removes non-chosen providers and repoints profiles in one re-activation', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t);
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  // Legacy all-twelve binding first.
  const first = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  await waitTerminal(manager, home, first.operation.operationId, daemon);
  assert.equal(Object.keys(slpProvidersOf(readConfigJson(home))).length, 12);

  // Route supervisor → devin, lead → pi; re-activate the same candidate.
  await setRouting(manager, home, { family: 'devin', model: 'swe-2-high' }, { family: 'pi' });
  const second = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  const done = await waitTerminal(manager, home, second.operation.operationId, daemon);
  assert.equal(done.operation.outcome, 'succeeded');

  const providers = slpProvidersOf(readConfigJson(home));
  assert.deepEqual(Object.keys(providers).sort(), generatedIds('devin', 'pi'));
  const profiles = readConfigJson(home).daemon.agentProfiles;
  assert.equal(profiles.find(p => p.id === 'slp-supervisor').provider, 'slp-devin-supervisor');
  assert.equal(profiles.find(p => p.id === 'slp-supervisor').model, 'swe-2-high');
  assert.equal(profiles.find(p => p.id === 'slp-lead').provider, 'slp-pi-lead');

  // The one dispatched patch both writes the kept providers and removes the
  // non-chosen combos — migration is a single re-activation.
  const lastPatch = daemon.patchCalls.at(-1);
  assert.deepEqual([...lastPatch.removeProviders].sort(), absentIds('devin', 'pi'));
  assert.deepEqual(Object.keys(lastPatch.providers).sort(), generatedIds('devin', 'pi'));
});

test('routing → routing rebind swaps the role providers in one re-activation', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t);
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  await setRouting(manager, home, { family: 'pi' }, { family: 'devin' });
  const first = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  await waitTerminal(manager, home, first.operation.operationId, daemon);
  assert.deepEqual(Object.keys(slpProvidersOf(readConfigJson(home))).sort(), generatedIds('pi', 'devin'));

  await setRouting(manager, home, { family: 'claude' }, { family: 'codex' });
  const second = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  const done = await waitTerminal(manager, home, second.operation.operationId, daemon);
  assert.equal(done.operation.outcome, 'succeeded');

  const providers = slpProvidersOf(readConfigJson(home));
  assert.deepEqual(Object.keys(providers).sort(), generatedIds('claude', 'codex'));
  const profiles = readConfigJson(home).daemon.agentProfiles;
  assert.equal(profiles.find(p => p.id === 'slp-supervisor').provider, 'slp-claude-supervisor');
  assert.equal(profiles.find(p => p.id === 'slp-lead').provider, 'slp-codex-lead');
});

test('a foreign profile referencing a removed provider blocks the rebind with DEPENDENT_REFERENCE', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t);
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  await setRouting(manager, home, { family: 'pi' }, { family: 'devin' });
  const first = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  await waitTerminal(manager, home, first.operation.operationId, daemon);

  // A foreign profile now depends on a provider the next routing removes.
  const config = readConfigJson(home);
  config.daemon.agentProfiles.push({ id: 'user-helper', name: 'Mine', provider: 'slp-pi-supervisor' });
  writeFileSync(join(home, 'config.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const daemon2 = await makeDaemon(t, home); // live view re-reads persisted config

  await setRouting(manager, home, { family: 'codex' }, { family: 'devin' });
  const second = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon2);
  const done = await waitTerminal(manager, home, second.operation.operationId, daemon2);
  assert.equal(done.operation.outcome, 'failed');
  assert.ok(opConflicts(home, second.operation.operationId).includes('DEPENDENT_REFERENCE'));
  assert.ok(readConfigJson(home).agents.providers['slp-pi-supervisor'], 'the referenced provider survives');
});

test('deactivation under a settings-driven binding still removes every owned id', async t => {
  const home = makeHome(t);
  const binaries = makeBinaries(t);
  const daemon = await makeDaemon(t, home);
  const deps = makeDeps({ execOpts: { binaries } });
  const manager = createManager(deps);

  await setRouting(manager, home, { family: 'pi' }, { family: 'devin' });
  const act = await manager.activate(activateInput(home, deps.payload, randomUUID()), daemon);
  const doneAct = await waitTerminal(manager, home, act.operation.operationId, daemon);
  assert.equal(Object.keys(slpProvidersOf(readConfigJson(home))).length, 6);

  const deact = await manager.deactivate(
    deactivateInput(home, randomUUID(), doneAct.binding.bindingSha256),
    daemon,
  );
  const done = await waitTerminal(manager, home, deact.operation.operationId, daemon);
  assert.equal(done.operation.outcome, 'succeeded');
  assert.equal(Object.keys(slpProvidersOf(readConfigJson(home))).length, 0);
});
