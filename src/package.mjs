import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync, readlinkSync, mkdirSync, writeFileSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export function files(root, prefix = '') {
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    const path = join(prefix, name);
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Package symlink unsupported: ${path}`);
    return stat.isDirectory() ? files(root, path) : [path];
  });
}
export function identity(root) {
  const paths = ['package.json', 'install.sh', ...files(root, 'bin'),
    ...(existsSync(join(root, 'skills')) ? files(root, 'skills') : []), ...files(root, 'src')].sort();
  const entries = paths.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  return { sha256: hash(json(entries)), files: entries };
}
export function verifyInstall(root) {
  const expected = readJson(join(root, 'installed.json'));
  const actual = identity(root);
  if (json(actual) !== json(expected.candidate)) throw new Error('Installed candidate changed');
  if (expected.paseoBindingSha256 && hash(readFileSync(join(root, 'paseo-binding.json'))) !== expected.paseoBindingSha256) throw new Error('Installed Paseo binding changed');
  return expected;
}
export function install(source, destination) {
  const candidate = identity(source);
  // Exclusive destination: no current binding, runtime configuration or session is touched.
  mkdirSync(destination);
  try {
    for (const entry of candidate.files) {
      const target = join(destination, entry.path);
      mkdirSync(resolve(target, '..'), { recursive: true });
      copyFileSync(join(source, entry.path), target);
    }
    writeFileSync(join(destination, 'installed.json'), json({ source: realpathSync(source), candidate }), { flag: 'wx' });
    verifyInstall(destination);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  return { destination: realpathSync(destination), candidate };
}
export function uninstall(destination) {
  const manifest = verifyInstall(destination);
  if (manifest.paseoBindingSha256) throw new Error('Use the CLI uninstall to detach Paseo configuration first');
  const expected = [...manifest.candidate.files.map(f => f.path), 'installed.json'].sort();
  if (json(files(destination).sort()) !== json(expected)) throw new Error('Extra files: preserve directory for manual review');
  rmSync(destination, { recursive: true });
}
export function snapshot(root) {
  root = realpathSync(root);
  const git = args => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 });
  if (git(['rev-parse', '--show-toplevel']).toString().trim() !== root) throw new Error('Snapshot requires repository root');
  const names = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean))].sort();
  // Staged gitlinks (submodule entries, mode 160000) remain unsupported; an
  // untracked directory that is itself a git work-tree root snapshots nested.
  const gitlinks = new Set(git(['ls-files', '-z', '-s']).toString().split('\0')
    .filter(line => line.startsWith('160000 ')).map(line => line.slice(line.indexOf('\t') + 1)));
  const nested = [];
  const entries = names.flatMap(name => {
    try {
      const stat = lstatSync(join(root, name));
      if (stat.isDirectory()) {
        const path = name.replace(/\/+$/, '');
        if (!gitlinks.has(path) && existsSync(join(root, path, '.git'))) {
          const sub = snapshot(join(root, path));
          nested.push({ path, head: sub.head, sha256: sub.sha256, files: sub.files,
            ...(sub.nested ? { nested: sub.nested } : {}) });
          return [];
        }
        throw new Error(`Submodules/directories unsupported: ${name}`);
      }
      return [{ path: name, mode: stat.mode & 0o777, sha256: hash(stat.isSymbolicLink() ? readlinkSync(join(root, name)) : readFileSync(join(root, name))), kind: stat.isSymbolicLink() ? 'symlink' : 'file' }];
    } catch (error) {
      if (error.code === 'ENOENT') return [{ path: name, deleted: true }];
      throw error;
    }
  });
  let head = null;
  try { head = git(['rev-parse', '--verify', '--quiet', 'HEAD']).toString().trim(); }
  catch (error) { if (error.status !== 1) throw error; }
  return { root, head, sha256: hash(json(nested.length ? { head, entries, nested } : { head, entries })), files: entries,
    ...(nested.length ? { nested } : {}) };
}
