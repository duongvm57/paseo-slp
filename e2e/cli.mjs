#!/usr/bin/env node
import { readJson, json } from '../src/package.mjs';
import { scenarios } from './scenarios.mjs';
import { initialize, begin, fixture, collect, collectCoordinator, collectResources, seal, review, reviewAddendum, defer, summary } from './collector.mjs';

const [command, ...args] = process.argv.slice(2);
try {
  let result;
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
      result = { execution: 'SESSION_REQUIRED', skill: 'skills/paseo-slp-e2e/SKILL.md',
        instruction: 'Read the skill and execute the Human-selected scenarios (the entire manifest for a full-suite request) using Paseo from this session. Human must configure saved SLP profiles for basic-codex/basic-pi before testing; verify them and complete fixture protocol before launch. Continue through collection, independent review and cleanup; this help output ran no live tests.',
        scenarios: scenarios.length, commands: ['plan [scenario-id]', 'init <new-run-directory>', 'begin <run> <scenario-id> <config.json>', 'fixture <attempt>', 'collect <attempt> <kind> <source-file>', 'collect-coordinator <attempt> <native-session.jsonl> <native-session-id>', 'collect-resources <attempt> <settlement.json>', 'seal <attempt> [gaps.json]', 'review <attempt> <review.json>', 'review-addendum <attempt> <review.json>', 'defer <run> <scenario-id> <reason.json>', 'summary <run>'] };
      if (!command) process.exitCode = 2;
      break;
    case 'plan': result = args[0] ? scenarios.find(row => row.id === args[0]) : scenarios; if (!result) throw new Error('Unknown scenario'); break;
    case 'init': result = initialize(args[0]); break;
    case 'begin': result = begin(args[0], args[1], readJson(args[2])); break;
    case 'fixture': result = { workspace: fixture(args[0]) }; break;
    case 'collect': result = collect(args[0], args[1], args[2]); break;
    case 'collect-coordinator': result = collectCoordinator(args[0], args[1], args[2]); break;
    case 'collect-resources': result = collectResources(args[0], args[1]); break;
    case 'seal': result = seal(args[0], args[1] ? readJson(args[1]) : undefined); break;
    case 'review': result = review(args[0], readJson(args[1])); break;
    case 'review-addendum': result = reviewAddendum(args[0], readJson(args[1])); break;
    case 'defer': result = defer(args[0], args[1], readJson(args[2])); break;
    case 'summary': result = summary(args[0]); process.exitCode = result.status === 'FAIL' ? 1 : result.gateReady ? 0 : 2; break;
    default: throw new Error('Unknown E2E command; use --help');
  }
  process.stdout.write(json(result));
} catch (error) {
  process.stderr.write(json({ error: error.message }));
  process.exitCode = 1;
}
