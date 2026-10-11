import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Event } from './types.ts';

/** A cooperative single-process lease. Never kills another process or guesses corrupt leases. */
export function acquireLease(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true });
  const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const guard = path + '.guard';
  let guardFd: number;
  try { guardFd = openSync(guard, 'wx'); } catch { throw Error('workspace/database locked'); }
  try {
    try {
      const prior = JSON.parse(readFileSync(path, 'utf8'));
      if (!Number.isSafeInteger(prior.pid) || prior.pid <= 0) throw Error('invalid lease');
      let dead = false;
      try { process.kill(prior.pid, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (!dead) throw Error('workspace/database locked');
      unlinkSync(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const fd = openSync(path, 'wx');
    try { writeFileSync(fd, token); } finally { closeSync(fd); }
  } finally { closeSync(guardFd); unlinkSync(guard); }
  return () => { if (readFileSync(path, 'utf8') !== token) throw Error('lease owner changed'); unlinkSync(path); };
}

export class Store {
  #db: DatabaseSync;
  #release: () => void;
  #closed = false;
  constructor(path: string) {
    this.#release = acquireLease(path + '.lock');
    try {
      this.#db = new DatabaseSync(path);
      this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS documents(kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS events(task TEXT NOT NULL, seq INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(task,seq));`);
    } catch (e) { this.#release(); throw e; }
  }
  transaction<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (e) { if (this.#db.isTransaction) this.#db.exec('ROLLBACK'); throw e; }
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.#db.prepare('SELECT value FROM documents WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.value as string) as T : undefined;
  }
  put(kind: string, id: string, value: unknown) {
    this.#db.prepare('INSERT INTO documents(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind, id, JSON.stringify(value));
  }
  list<T>(kind: string): T[] {
    return this.#db.prepare('SELECT value FROM documents WHERE kind=? ORDER BY rowid').all(kind).map(row => JSON.parse(row.value as string) as T);
  }
  lastSeq(taskId: string): number {
    return Number(this.#db.prepare('SELECT coalesce(max(seq),0) AS n FROM events WHERE task=?').get(taskId)!.n);
  }
  append(taskId: string, type: string, data: Record<string, unknown>, runId?: string): Event {
    const seq = this.lastSeq(taskId) + 1;
    const event: Event = { schemaVersion: 1, id: randomUUID(), taskId, runId, seq, occurredAt: new Date().toISOString(), type, data };
    this.#db.prepare('INSERT INTO events(task,seq,value) VALUES(?,?,?)').run(taskId, seq, JSON.stringify(event));
    return event;
  }
  events(taskId: string, after: number, limit: number): Event[] {
    return this.#db.prepare('SELECT value FROM events WHERE task=? AND seq>? ORDER BY seq LIMIT ?').all(taskId, after, limit).map(row => JSON.parse(row.value as string) as Event);
  }
  acceptanceInvalidation(taskId: string, acceptanceId: string): Event | undefined {
    const row = this.#db.prepare("SELECT value FROM events WHERE task=? AND json_extract(value,'$.type')='task.acceptance_invalidated' AND json_extract(value,'$.data.acceptanceId')=? ORDER BY seq DESC LIMIT 1").get(taskId, acceptanceId);
    return row ? JSON.parse(row.value as string) as Event : undefined;
  }
  close() { if (!this.#closed) { this.#db.close(); this.#release(); this.#closed = true; } }
}
