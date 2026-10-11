import { BackendService } from '../../src/backend/service.ts';
const service = await BackendService.open({ workspace: process.argv[2], database: process.argv[3], mainProject: process.argv[4], adapter: { start: async () => ({ result: new Promise(() => {}), interrupt: async () => {}, close: async () => {} }) } });
const task = await service.createTask({ title: 'crash fixture', goal: 'wait', acceptanceCriteria: ['hold'], agentInstanceId: 'codex-local' }, 'create');
const run = await service.startRun(task.id, { expectedVersion: task.version }, 'start');
const timer = setInterval(() => { if (service.run(run.id).phase === 'executing') { clearInterval(timer); console.log(JSON.stringify({ taskId: task.id, runId: run.id })); } }, 10);
setInterval(() => {}, 1000);
