import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
export const exec = promisify(execFile);
export async function git(cwd: string, args: string[]) {
  return (await exec('git', ['-c', 'core.autocrlf=false', ...args], { cwd, windowsHide: true, timeout: 15_000 })).stdout;
}
export async function createSample(root: string, name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('invalid sample name');
  const cwd = join(root, name);
  await mkdir(cwd); // never reuse or overwrite an existing sample
  await writeFile(join(cwd, 'sample.txt'), 'baseline\n');
  await writeFile(join(cwd, 'AGENTS.md'), '# Protocol verification sample\nOnly perform the exact user task. Only edit sample.txt. Do not delegate, install dependencies, read outside this repository, or use external integrations. No planning documents are needed.\n');
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['add', 'sample.txt', 'AGENTS.md']);
  await mkdir(join(cwd, '.git', 'empty-hooks'));
  await git(cwd, ['-c', 'user.name=AgentDesk Probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + join(cwd, '.git', 'empty-hooks'), 'commit', '-m', 'sample baseline']);
  return cwd;
}
export async function checkSample(cwd: string, expected: string, changed: boolean) {
  const actual = await readFile(join(cwd, 'sample.txt'), 'utf8');
  if (actual !== expected) throw new Error('sample content does not match expected fixture');
  const status = (await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])).trim();
  if (status !== (changed ? 'M sample.txt' : '')) throw new Error('unexpected workspace changes');
  const diff = await git(cwd, ['diff', '--', 'sample.txt']);
  if (Boolean(diff.trim()) !== changed) throw new Error('Git diff assertion failed');
  return { changed, diff };
}
export async function auditSample(cwd: string, baselineHead: string) {
  const tracked = (await git(cwd, ['diff', '--no-renames', '--name-only', '-z', 'HEAD'])).split('\0').filter(Boolean);
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const files = new Set([...tracked, ...untracked]);
  return { sampleChanged: files.has('sample.txt'), unexpectedChanges: [...files].some(p => p !== 'sample.txt'), changedFiles: files.size, headUnchanged: (await git(cwd, ['rev-parse', 'HEAD'])).trim() === baselineHead };
}
