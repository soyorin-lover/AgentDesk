import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSample } from '../src/workspace.ts';
import type { BackendService } from '../src/backend/service.ts';
import type { EngineAdapter, ExecutionContext, ExecutionResult } from '../src/backend/types.ts';
export async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agentdesk-project-'));
  const path = await createSample(root, 'source');
  const config = { projects: [{ id: 'fixture', name: 'Fixture', path }], workspaceRoot: join(root, 'workspaces'), database: join(root, 'state.sqlite'), mainProject: process.cwd(), adapter: { start: async () => { throw Error('not used'); } } as EngineAdapter };
  return { root, path, config };
}
export const taskInput = { projectId: 'fixture', title: 'Task', goal: 'change file', acceptanceCriteria: ['correct'], agentInstanceId: 'codex-local' };
export async function waitFor(check: () => boolean, timeout = 10000) {
  const until = Date.now() + timeout;
  while (!check()) { if (Date.now() > until) throw Error('condition timeout'); await new Promise(r => setTimeout(r, 10)); }
}
export async function settled(s: BackendService, id: string) { await waitFor(() => s.workspace(id).status !== 'preparing'); return s.workspace(id); }
export class FixtureEngine implements EngineAdapter {
  contexts: ExecutionContext[] = [];
  finish!: (result: ExecutionResult) => void;
  async start(context: ExecutionContext) {
    this.contexts.push(context); context.onSession(context.sessionId ?? 'session-' + this.contexts.length);
    let resolve!: (r: ExecutionResult) => void;
    const result = new Promise<ExecutionResult>(r => { resolve = r; }); this.finish = resolve;
    return { result, interrupt: async () => resolve({ status: 'aborted' }), close: async () => resolve({ status: 'aborted' }) };
  }
}
