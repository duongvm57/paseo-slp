import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync, readlinkSync, mkdirSync, writeFileSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
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
  const entries = names.map(path => {
    try {
      const stat = lstatSync(join(root, path));
      if (stat.isDirectory()) throw new Error(`Submodules/directories unsupported: ${path}`);
      return { path, mode: stat.mode & 0o777, sha256: hash(stat.isSymbolicLink() ? readlinkSync(join(root, path)) : readFileSync(join(root, path))), kind: stat.isSymbolicLink() ? 'symlink' : 'file' };
    } catch (error) {
      if (error.code === 'ENOENT') return { path, deleted: true };
      throw error;
    }
  });
  let head = null;
  try { head = git(['rev-parse', '--verify', '--quiet', 'HEAD']).toString().trim(); }
  catch (error) { if (error.status !== 1) throw error; }
  return { root, head, sha256: hash(json({ head, entries })), files: entries };
}
export function separate(a, b) {
  a = realpathSync(a); b = realpathSync(b);
  const inside = (x, y) => { const rel = relative(x, y); return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/')); };
  return !inside(a, b) && !inside(b, a);
}
