#!/usr/bin/env node
// Generate plugin/server/generated/runtime-payload.ts — the embedded immutable
// install unit for the Option A manager plugin (spec §5). Runs from the repo
// root during development/release preparation; `--check` regenerates in memory
// and byte-compares against the committed module for CI.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, identity, json } from '../src/package.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'plugin/server/generated/runtime-payload.ts');
const check = process.argv.includes('--check');

const fail = message => {
  console.error(`generate-plugin-payload: ${message}`);
  process.exit(1);
};

// POSIX-relative install-unit paths: package.json, install.sh, every regular
// file under bin/, optional skills/, and src/. Symlinks and non-regular
// entries are rejected rather than followed or skipped.
const walk = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
  const path = `${directory}/${entry.name}`;
  if (entry.isSymbolicLink()) throw new Error(`payload symlink unsupported: ${path}`);
  if (entry.isDirectory()) return walk(path);
  if (!entry.isFile()) throw new Error(`payload entry is not a regular file: ${path}`);
  return [path];
});
const statFile = path => {
  const stat = lstatSync(join(root, path));
  if (stat.isSymbolicLink()) throw new Error(`payload symlink unsupported: ${path}`);
  if (!stat.isFile()) throw new Error(`payload entry is not a regular file: ${path}`);
  return stat;
};
const walkRoot = directory => {
  const stat = lstatSync(join(root, directory));
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`payload entry is not a directory: ${directory}`);
  return walk(directory);
};
const optionalRoot = directory => {
  try { lstatSync(join(root, directory)); } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  return walkRoot(directory);
};
let paths;
try {
  paths = ['package.json', 'install.sh', ...walkRoot('bin'), ...optionalRoot('skills'), ...walkRoot('src')].sort();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

// Path keys stay portable: relative POSIX separators, no empty/dot/dot-dot
// components, no absolute or drive-prefixed forms, no duplicates or
// case-colliding names.
if (new Set(paths).size !== paths.length) fail('duplicate payload paths');
if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length) fail('case-colliding payload paths');
for (const path of paths) {
  const valid = path.length > 0 && !path.includes('\0') && !path.includes('\\')
    && !path.startsWith('/') && !/^[A-Za-z]:/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
  if (!valid) fail(`invalid payload path: ${path}`);
}

// Modes are permission bits only; setuid/setgid/sticky package files are
// rejected instead of silently converted.
const files = paths.map(path => {
  const stat = statFile(path);
  if (stat.mode & 0o7000) fail(`setuid/setgid/sticky payload file refused: ${path}`);
  const bytes = readFileSync(join(root, path));
  return { path, sha256: hash(bytes), mode: stat.mode & 0o777, base64: bytes.toString('base64') };
});

const candidate = { sha256: hash(json(files.map(({ path, sha256 }) => ({ path, sha256 })))), files: files.map(({ path, sha256 }) => ({ path, sha256 })) };
// The embedded candidate identity must equal the installed runtime's own
// identity() contract exactly — same paths, same order, same serialization.
const actual = identity(root);
if (json(actual) !== json(candidate)) fail(`embedded candidate diverges from identity(): ${actual.sha256} != ${candidate.sha256}`);
// Every decoded byte must hash back to its declared sha256 before emitting.
for (const file of files) {
  if (hash(Buffer.from(file.base64, 'base64')) !== file.sha256) fail(`decoded payload hash mismatch: ${file.path}`);
}
const payloadSha256 = hash(json(files.map(({ path, sha256, mode }) => ({ path, sha256, mode }))));
const payload = { schemaVersion: 1, candidate, payloadSha256, files };

const module_ = `// generated — do not edit. Produced by scripts/generate-plugin-payload.mjs
// from the install unit (package.json, install.sh, bin/, skills/, src/).
// Regenerate with \`npm run generate:plugin-payload\`; CI verifies with
// \`npm run check:plugin-payload\` (--check byte-compares this file).
import type { EmbeddedPayload } from "../../shared/contracts.ts";

export const embeddedPayload: EmbeddedPayload = ${JSON.stringify(payload, null, 2)};
`;

if (check) {
  const current = existsSync(output) ? readFileSync(output, 'utf8') : null;
  if (current !== module_) fail(`${output} is stale; run npm run generate:plugin-payload`);
  console.log(`runtime-payload.ts is current (candidate ${candidate.sha256}, ${files.length} files)`);
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, module_);
  console.log(`wrote ${output} (candidate ${candidate.sha256}, ${files.length} files, payload ${payloadSha256})`);
}
