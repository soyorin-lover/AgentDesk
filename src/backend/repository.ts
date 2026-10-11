import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Repository, Changes, ReviewFile } from './types.ts';
const execute = promisify(execFile);
export async function git(cwd: string, args: string[], maxBuffer = 12 * 1024 * 1024) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  return (await execute('git', ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args], { cwd, env, windowsHide: true, timeout: 15_000, maxBuffer, encoding: 'utf8' })).stdout;
}
function within(root: string, path: string) {
  const part = relative(root, path); return part === '' || (!part.startsWith('..' + sep) && part !== '..' && !isAbsolute(part));
}
export async function inspectRepository(cwd: string, mainProject: string, saved?: Repository): Promise<Repository> {
  const actual = await realpath(cwd), main = await realpath(mainProject);
  if (within(main, actual) || within(actual, main)) throw Error('main project cannot be the execution workspace');
  const root = await realpath((await git(actual, ['rev-parse', '--show-toplevel'])).trim());
  if (root !== actual) throw Error('workspace must be a repository root');
  const head = (await git(actual, ['rev-parse', '--verify', 'HEAD'])).trim();
  if (saved) { if (saved.cwd !== actual) throw Error('workspace binding changed'); return saved; }
  if ((await git(actual, ['status', '--porcelain=v1', '--untracked-files=all'])).trim()) throw Error('new workspace must be clean');
  return { cwd: actual, baseHead: head, kind: (await lstat(resolve(actual, '.git'))).isFile() ? 'external_worktree' : 'dedicated_repository' };
}
export async function workspaceLeasePath(repo: Repository) {
  const dir = (await git(repo.cwd, ['rev-parse', '--absolute-git-dir'])).trim();
  return resolve(dir, 'agentdesk-backend.lock');
}
export async function captureChanges(repo: Repository, limits: { fileBytes?: number; totalBytes?: number } = {}): Promise<Changes> {
  const fileLimit = limits.fileBytes ?? 1024 * 1024, totalLimit = limits.totalBytes ?? 10 * 1024 * 1024;
  const head = (await git(repo.cwd, ['rev-parse', 'HEAD'])).trim();
  const index = await git(repo.cwd, ['ls-files', '--stage', '-z']);
  const tree = await git(repo.cwd, ['ls-tree', '-r', '-z', repo.baseHead]);
  const specialModes = new Map<string, 'symlink' | 'submodule'>();
  for (const entry of (index + tree).split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab > 0 && (entry.startsWith('120000 ') || entry.startsWith('160000 '))) specialModes.set(entry.slice(tab + 1), entry.startsWith('120000 ') ? 'symlink' : 'submodule');
  }
  const unstaged = await git(repo.cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', repo.baseHead]);
  const staged = await git(repo.cwd, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', repo.baseHead]);
  const others = await git(repo.cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  const names = [...new Set((unstaged + staged + others).split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  const hashPart = (type: string, data: string | Buffer) => {
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    hash.update(JSON.stringify([type, bytes.length]) + '\n').update(bytes);
  };
  hashPart('repository', JSON.stringify([repo.baseHead, head, index]));
  const files: ReviewFile[] = [];
  const captured = new Map<string, Buffer | undefined>();
  let total = 0, completeness: Changes['completeness'] = head === repo.baseHead ? 'complete' : 'unsupported';
  for (const name of names) {
    const file: ReviewFile = { id: randomUUID(), path: name, kind: 'text' }; files.push(file); hashPart('path', name);
    if (specialModes.has(name)) { file.kind = specialModes.get(name)!; completeness = 'unsupported'; continue; }
    const path = resolve(repo.cwd, name);
    if (!within(repo.cwd, path)) { file.kind = 'unreadable'; completeness = 'unsupported'; continue; }
    try {
      // Inspect every component: never follow a changed symlink or a directory symlink outside the workspace.
      let linked = false;
      const parts = relative(repo.cwd, path).split(sep); let cursor = repo.cwd;
      for (const part of parts) { cursor = resolve(cursor, part); try { if ((await lstat(cursor)).isSymbolicLink()) { linked = true; break; } } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
      if (linked) { file.kind = 'symlink'; completeness = 'unsupported'; hashPart('symlink', ''); continue; }
      let content: Buffer | undefined;
      try {
        const stat = await lstat(path);
        if (!stat.isFile()) { file.kind = 'submodule'; completeness = 'unsupported'; continue; }
        if (stat.size > fileLimit || total + stat.size > totalLimit) { file.kind = 'limited'; completeness = 'limited'; hashPart('limited', String(stat.size)); continue; }
        if (!within(repo.cwd, await realpath(path))) throw Error('outside repository');
        content = await readFile(path); hashPart('content', content); total += content.length;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; hashPart('deleted', ''); }
      if (content?.includes(0)) { file.kind = 'binary'; completeness = 'unsupported'; continue; }
      captured.set(path, content);
      const args = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--src-prefix=a/', '--dst-prefix=b/'];
      file.diff = await git(repo.cwd, ['diff', ...args, repo.baseHead, '--', name], fileLimit + 64 * 1024);
      file.stagedDiff = await git(repo.cwd, ['diff', '--cached', ...args, repo.baseHead, '--', name], fileLimit + 64 * 1024);
      if (file.diff.includes('Binary files ') || file.stagedDiff.includes('Binary files ')) { file.kind = 'binary'; delete file.diff; delete file.stagedDiff; completeness = 'unsupported'; continue; }
      if (!file.diff && !file.stagedDiff && content) file.diff = `--- /dev/null\n+++ ${JSON.stringify(name)}\n@@ -0,0 +1,${content.toString('utf8').split('\n').length} @@\n` + content.toString('utf8').split('\n').map(line => '+' + line).join('\n');
      total += Buffer.byteLength(file.diff + file.stagedDiff);
      if (total > totalLimit || Buffer.byteLength(file.diff + file.stagedDiff) > fileLimit) { file.kind = 'limited'; delete file.diff; delete file.stagedDiff; completeness = 'limited'; }
    } catch (e) {
      file.kind = (e as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'limited' : 'unreadable';
      completeness = file.kind === 'limited' ? 'limited' : 'unsupported';
    }
  }
  // Revalidate the enumerated paths and bytes as well as HEAD/index. A scan is not an atomic
  // filesystem snapshot: disagreement is explicitly unsupported rather than a false green.
  const finalUnstaged = await git(repo.cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', repo.baseHead]);
  const finalStaged = await git(repo.cwd, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', repo.baseHead]);
  const finalOthers = await git(repo.cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (JSON.stringify(names) !== JSON.stringify([...new Set((finalUnstaged + finalStaged + finalOthers).split('\0').filter(Boolean))].sort())) completeness = 'unsupported';
  for (const [path, content] of captured) {
    try {
      const stat = await lstat(path);
      if (!content || !stat.isFile() || stat.isSymbolicLink() || stat.size !== content.length || !within(repo.cwd, await realpath(path))) { completeness = 'unsupported'; continue; }
      if (!(await readFile(path)).equals(content)) completeness = 'unsupported';
    } catch (e) { if (content || (e as NodeJS.ErrnoException).code !== 'ENOENT') completeness = 'unsupported'; }
  }
  if (head !== (await git(repo.cwd, ['rev-parse', 'HEAD'])).trim() || index !== await git(repo.cwd, ['ls-files', '--stage', '-z'])) completeness = 'unsupported';
  return { baseHead: repo.baseHead, head, contentDigest: hash.digest('hex'), files, completeness, checks: 'not_run', lastCheckedAt: new Date().toISOString() };
}
