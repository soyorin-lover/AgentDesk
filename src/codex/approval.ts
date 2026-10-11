import { resolve, join } from 'node:path';
import type { Message } from './rpc.ts';
export type FileProposal = { threadId: string; turnId: string; itemId: string; changes: { path: string; kind: { type: string; move_path?: string | null } }[] };
export function samplePatchAllowed(request: Message, proposal: FileProposal | undefined, expectedThread: string, cwd: string) {
  const p = request.params;
  return Boolean(request.method === 'item/fileChange/requestApproval' && proposal &&
    p.threadId === expectedThread && proposal.threadId === p.threadId && proposal.turnId === p.turnId && proposal.itemId === p.itemId &&
    !p.grantRoot && proposal.changes.length > 0 && proposal.changes.every(c =>
      resolve(cwd, c.path) === join(cwd, 'sample.txt') && c.kind.type === 'update' && !c.kind.move_path));
}
