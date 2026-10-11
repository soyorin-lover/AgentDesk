import { realpath, lstat, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { within } from './projects.ts';
import { ApiError, requireValue } from './errors.ts';
import type { RepositoryInspection } from './types.ts';

type Observation = RepositoryInspection['repository'];
const execute = promisify(execFile);
async function git(cwd: string, args: string[]) {
  // Parent GIT_DIR/WORK_TREE/CONFIG overrides must not redirect the submitted repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  return (await execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], { cwd, env, windowsHide: true, timeout: 15_000, maxBuffer: 12 * 1024 * 1024, encoding: 'utf8' })).stdout;
}
const absentRef = (error: unknown) => (error as { code?: unknown }).code === 1;
async function observe(path: string): Promise<Observation> {
  const actual = await realpath(path);
  requireValue((await lstat(actual)).isDirectory(), 422, 'repository_unavailable');
  requireValue((await git(actual, ['rev-parse', '--is-bare-repository'])).trim() === 'false', 422, 'bare_repository_unsupported');
  const root = await realpath((await git(actual, ['rev-parse', '--show-toplevel'])).trim());
  requireValue(root === actual, 422, 'repository_root_required');
  const gitDir = await realpath((await git(root, ['rev-parse', '--absolute-git-dir'])).trim());
  const commonDir = await realpath((await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
  let ref: string | null = null, head: string | null = null;
  try { ref = (await git(root, ['symbolic-ref', '-q', 'HEAD'])).trim(); } catch (e) { if (!absentRef(e)) throw e; }
  try { head = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim(); }
  catch (e) {
    if (!ref) throw e;
    try { await git(root, ['show-ref', '--verify', '--quiet', ref]); throw e; }
    catch (missing) { if (!absentRef(missing)) throw missing; }
  }
  const branch = ref?.replace(/^refs\/heads\//, '') ?? null;
  const headState = head ? (ref ? 'attached' : 'detached') : 'unborn';
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']);
  const index = await git(root, ['ls-files', '--stage', '-z']);
  // Hidden tracked changes cannot be certified by ordinary status.
  const flags = await git(root, ['ls-files', '-v', '-z']);
  requireValue(!flags.split('\0').some(row => row && (row[0] === 'S' || /[a-z]/.test(row[0]))), 422, 'repository_scan_unsupported');
  const worktreeText = await git(root, ['worktree', 'list', '--porcelain', '-z']);
  const worktrees: Observation['worktrees'] = [];
  let item: Observation['worktrees'][number] | undefined;
  for (const field of worktreeText.split('\0')) {
    if (field.startsWith('worktree ')) { item = { path: field.slice(9), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false }; worktrees.push(item); }
    else if (item) {
      if (field.startsWith('HEAD ')) item.head = /^0+$/.test(field.slice(5)) ? null : field.slice(5);
      else if (field.startsWith('branch ')) item.branch = field.slice(7).replace(/^refs\/heads\//, '');
      else if (field === 'bare') item.bare = true;
      else if (field === 'detached') item.detached = true;
      else if (field === 'locked' || field.startsWith('locked ')) item.locked = true;
      else if (field === 'prunable' || field.startsWith('prunable ')) item.prunable = true;
    }
  }
  const hash = createHash('sha256');
  const part = (kind: string, data: string | Buffer) => { const bytes = Buffer.from(data); hash.update(JSON.stringify([kind, bytes.length]) + '\n').update(bytes); };
  const identities = await Promise.all([root, gitDir, commonDir].map(async path => { const stat = await lstat(path, { bigint: true }); return [String(stat.dev), String(stat.ino)]; }));
  part('metadata', JSON.stringify([root, gitDir, commonDir, identities, ref, head, status, index, flags, worktreeText]));
  const changes = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  let bytes = 0, count = 0;
  const rows = status.split('\0');
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n]; if (!row) continue;
    requireValue(++count <= 2000, 422, 'repository_scan_limited');
    const code = row.slice(0, 2), name = row.slice(3);
    requireValue(row[2] === ' ' && name.length > 0, 422, 'repository_scan_unsupported');
    if (code === '??') changes.untracked++;
    else {
      if (code[0] !== ' ') changes.staged++;
      if (code[1] !== ' ') changes.unstaged++;
      if (code.includes('U') || ['AA', 'DD'].includes(code)) changes.conflicted++;
    }
    if (code.includes('R') || code.includes('C')) n++; // -z emits destination then source.
    const file = resolve(root, name);
    requireValue(within(root, file) && file !== root, 422, 'repository_scan_unsupported');
    // Never read through a changed parent symlink, nor recurse into submodules.
    let cursor = root;
    for (const component of relative(root, file).split(sep).slice(0, -1)) {
      cursor = resolve(cursor, component);
      try { requireValue(!(await lstat(cursor)).isSymbolicLink(), 422, 'repository_scan_unsupported'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; break; }
    }
    part('file', name);
    try {
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) part('symlink', await readlink(file));
      else {
        requireValue(stat.isFile(), 422, 'repository_scan_unsupported');
        requireValue(stat.size <= 1024 * 1024 && bytes + stat.size <= 10 * 1024 * 1024, 422, 'repository_scan_limited');
        requireValue(within(root, await realpath(file)), 422, 'repository_scan_unsupported');
        const content = await readFile(file); bytes += content.length;
        requireValue(content.length <= 1024 * 1024 && bytes <= 10 * 1024 * 1024, 422, 'repository_scan_limited');
        part('content', content);
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; part('deleted', ''); }
  }
  return { path: root, gitDir, commonDir, branch, head, headState, changes, worktrees, fingerprint: hash.digest('hex') };
}

/** No Git mutation, hooks, external diff driver or model invocation. */
export async function inspectImportRepository(path: string): Promise<Observation> {
  requireValue(typeof path === 'string' && path.length > 0 && path.length <= 4096 && !path.includes('\0') && isAbsolute(path), 400, 'invalid_repository_path');
  try {
    const first = await observe(path), second = await observe(path);
    requireValue(first.fingerprint === second.fingerprint, 409, 'repository_changed');
    return second;
  } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(422, 'repository_unavailable'); }
}
