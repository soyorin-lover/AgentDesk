export class ApiError extends Error {
  status: number;
  code: string;
  currentVersion?: number;
  constructor(status: number, code: string, currentVersion?: number) {
    super(code); this.status = status; this.code = code; this.currentVersion = currentVersion;
  }
}
export function requireValue(condition: unknown, status = 400, code = 'invalid_input'): asserts condition {
  if (!condition) throw new ApiError(status, code);
}
