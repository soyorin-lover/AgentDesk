import { realpath, mkdir, lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';
import { inspectRepository, git } from './repository.ts';
import type { ProjectConfig, Repository, StoredWorkspace } from './types.ts';
import type { Store } from './store.ts';
import { createHash } from 'node:crypto';

export async function sourceIdentity(path: string) {
  const cwd = await realpath(path);
  if (await realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim()) !== cwd) throw Error('repository_root_required');
  const gitDir = await realpath((await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim());
  const commonDir = await realpath((await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
  const identities = await Promise.all([cwd, gitDir, commonDir].map(async p => { const stat = await lstat(p, { bigint: true }); return [String(stat.dev), String(stat.ino)]; }));
  return { cwd, gitDir, commonDir, fingerprint: createHash('sha256').update(JSON.stringify([cwd, gitDir, commonDir, identities])).digest('hex') };
}
async function directoryIdentity(path: string) { const stat = await lstat(path, { bigint: true }); if (!stat.isDirectory()) throw Error('workspace_root_changed'); return JSON.stringify([String(stat.dev), String(stat.ino)]); }

export function within(root: string, path: string) {
  const part = relative(root, path); return part === '' || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part));
}
async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const parent = dirname(path); if (parent === path) throw e; return resolve(await canonicalPath(parent), basename(path)); }
}
export class ProjectRegistry {
  readonly project: ProjectConfig;
  readonly repository: Repository;
  readonly workspaceRoot: string;
  readonly identity: Awaited<ReturnType<typeof sourceIdentity>>;
  readonly sourcePath: string;
  readonly workspaceRootIdentity: string;
  private constructor(project: ProjectConfig, repository: Repository, workspaceRoot: string, identity: Awaited<ReturnType<typeof sourceIdentity>>, sourcePath: string, workspaceRootIdentity: string) { this.project = project; this.repository = repository; this.workspaceRoot = workspaceRoot; this.identity = identity; this.sourcePath = sourcePath; this.workspaceRootIdentity = workspaceRootIdentity; }
  static async open(configs: ProjectConfig[], root: string, main: string, store: Store) {
    if (!Array.isArray(configs) || configs.length !== 1) throw Error('one project required; duplicate IDs are not allowed');
    const config = configs[0];
    if (!config || !/^[a-zA-Z0-9_-]{1,80}$/.test(config.id) || typeof config.name !== 'string' || !config.name.trim() || config.name.length > 200 || typeof config.path !== 'string' || !isAbsolute(config.path) || typeof root !== 'string' || !isAbsolute(root)) throw Error('invalid project configuration');
    if (store.get('private', 'repository')) throw Error('legacy database cannot be rebound to project mode');
    const saved = store.get<{ config: ProjectConfig; repository: Repository; workspaceRoot: string; identity?: Awaited<ReturnType<typeof sourceIdentity>>; workspaceRootIdentity?: string }>('private', 'project');
    const repository = await inspectRepository(config.path, main, saved?.repository);
    const actualRoot = await canonicalPath(resolve(root)), actualMain = await realpath(main);
    for (const protectedRoot of [repository.cwd, actualMain]) {
      if (within(protectedRoot, actualRoot) || within(actualRoot, protectedRoot)) throw Error('workspace root overlaps source/main project');
    }
    if (saved && (saved.config.id !== config.id || saved.workspaceRoot !== actualRoot)) throw Error('project binding changed');
    await mkdir(actualRoot, { recursive: true });
    if (!(await lstat(actualRoot)).isDirectory() || await realpath(actualRoot) !== actualRoot) throw Error('workspace root changed');
    const project = { ...config, path: repository.cwd };
    const identity = await sourceIdentity(config.path);
    if (saved?.identity && saved.identity.fingerprint !== identity.fingerprint) throw Error('source_identity_changed');
    const workspaceRootIdentity = await directoryIdentity(actualRoot);
    if (saved?.workspaceRootIdentity && saved.workspaceRootIdentity !== workspaceRootIdentity) throw Error('workspace_root_changed');
    store.put('private', 'project', { config: project, repository, workspaceRoot: actualRoot, identity, workspaceRootIdentity });
    return new ProjectRegistry(project, repository, actualRoot, identity, config.path, workspaceRootIdentity);
  }
  static async authorized(config: ProjectConfig, root: string, main: string) {
    if (!config || !/^[a-zA-Z0-9_-]{1,80}$/.test(config.id) || typeof config.name !== 'string' || !config.name.trim() || config.name.length > 200 || typeof config.path !== 'string' || !isAbsolute(config.path) || typeof root !== 'string' || !isAbsolute(root)) throw Error('invalid execution grant configuration');
    const identity = await sourceIdentity(config.path), actualRoot = await canonicalPath(root), actualMain = await realpath(main);
    for (const protectedRoot of [identity.cwd, actualMain]) if (within(protectedRoot, actualRoot) || within(actualRoot, protectedRoot) || within(actualMain, identity.cwd) || within(identity.cwd, actualMain)) throw Error('execution grant overlaps source/main');
    const baseHead = (await git(identity.cwd, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    await mkdir(actualRoot, { recursive: true });
    if (await realpath(actualRoot) !== actualRoot || !(await lstat(actualRoot)).isDirectory()) throw Error('workspace_root_changed');
    return new ProjectRegistry({ ...config, path: identity.cwd }, { cwd: identity.cwd, baseHead, kind: 'dedicated_repository' }, actualRoot, identity, config.path, await directoryIdentity(actualRoot));
  }
  async assertSource(baseHead: string) {
    if ((await sourceIdentity(this.sourcePath)).fingerprint !== this.identity.fingerprint || await realpath(this.workspaceRoot) !== this.workspaceRoot || await directoryIdentity(this.workspaceRoot) !== this.workspaceRootIdentity) throw Error('source_identity_changed');
    if (!/^[0-9a-f]{40,64}$/.test(baseHead)) throw Error('invalid_baseline');
    await git(this.repository.cwd, ['cat-file', '-e', baseHead + '^{commit}']);
  }
  list() { return [{ id: this.project.id, name: this.project.name }]; }
  async create(workspace: StoredWorkspace): Promise<StoredWorkspace> {
    await this.assertSource(workspace.baseHead!);
    if (await realpath(this.workspaceRoot) !== this.workspaceRoot || workspace.cwd !== resolve(this.workspaceRoot, workspace.id)) throw Error('workspace_root_changed');
    try { await lstat(workspace.cwd); throw Error('workspace_path_conflict'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if ((await git(this.repository.cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads/' + workspace.branch])).trim()) throw Error('workspace_branch_conflict');
    const hooks = await mkdtemp(resolve(this.workspaceRoot, '.empty-hooks-'));
    await git(this.repository.cwd, ['-c', 'core.hooksPath=' + hooks, 'worktree', 'add', '-b', workspace.branch!, '--', workspace.cwd, workspace.baseHead!]);
    const gitDir = (await git(workspace.cwd, ['rev-parse', '--absolute-git-dir'])).trim();
    const ready = { ...workspace, gitDir, status: 'ready' as const };
    await writeFile(resolve(gitDir, 'agentdesk-workspace.json'), JSON.stringify(ready), { flag: 'wx' });
    await this.verify(ready);
    return ready;
  }
  async verify(workspace: StoredWorkspace) {
    await this.assertSource(workspace.baseHead!);
    if ((!workspace.gitDir && workspace.status !== 'preparing') || await realpath(this.workspaceRoot) !== this.workspaceRoot || workspace.cwd !== resolve(this.workspaceRoot, workspace.id) || await realpath(workspace.cwd) !== workspace.cwd) throw Error('workspace_identity_changed');
    const gitDir = (await git(workspace.cwd, ['rev-parse', '--absolute-git-dir'])).trim();
    const marker = JSON.parse(await readFile(resolve(gitDir, 'agentdesk-workspace.json'), 'utf8'));
    if ((workspace.gitDir && gitDir !== workspace.gitDir) || marker.gitDir !== gitDir || marker.id !== workspace.id || marker.taskId !== workspace.taskId || marker.projectId !== workspace.projectId || marker.baseHead !== workspace.baseHead || marker.cwd !== workspace.cwd || marker.branch !== workspace.branch || (await git(workspace.cwd, ['symbolic-ref', '--short', 'HEAD'])).trim() !== workspace.branch || (await git(workspace.cwd, ['rev-parse', 'HEAD'])).trim() !== workspace.baseHead) throw Error('workspace_identity_changed');
    const common = (await git(workspace.cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    if (common !== (await git(this.repository.cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()) throw Error('workspace_identity_changed');
  }
}
