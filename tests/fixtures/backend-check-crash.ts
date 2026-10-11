import { readFile, access } from 'node:fs/promises';
import { BackendService } from '../../src/backend/service.ts';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const service = await BackendService.open({ ...config, adapter: { start: async () => ({ result: Promise.resolve({ status: 'succeeded' }), interrupt: async () => {}, close: async () => {} }) } });
const task = await service.createTask({ projectId: 'fixture', title: 'crash', goal: 'fixture', acceptanceCriteria: ['fixture'], agentInstanceId: 'codex-local' }, 'create');
await service.prepareWorkspace(task.id, { expectedVersion: task.version }, 'prepare');
while (service.workspace(task.id).status === 'preparing') await new Promise(r => setTimeout(r, 10));
const run = await service.startRun(task.id, { expectedVersion: service.task(task.id).version }, 'run');
while (service.run(run.id).status === 'running') await new Promise(r => setTimeout(r, 10));
const snapshot = await service.snapshot(task.id, { expectedVersion: service.task(task.id).version }, 'snapshot');
const check = await service.startCheck(task.id, { expectedVersion: service.task(task.id).version, presetId: 'crash', snapshotId: snapshot.id }, 'check');
while (true) { try { await access(process.argv[3]); break; } catch { await new Promise(r => setTimeout(r, 10)); } }
console.log(JSON.stringify({ taskId: task.id, checkId: check.id }));
setInterval(() => {}, 1000);
