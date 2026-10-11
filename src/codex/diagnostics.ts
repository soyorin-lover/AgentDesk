/** Allowlisted metadata only: never copy error messages, URLs, commands, or auth data. */
export function diagnostic(method: string, params: any) {
  const error = params?.error || params || {};
  const text = String(error.message || '');
  const kind = /model.*(not|support|exist|access)|unsupported.*model/i.test(text) ? 'model-unavailable' : /unauthori|auth|401|403/i.test(text) ? 'authentication' : /quota|rate.limit|429/i.test(text) ? 'rate-limit' : /network|connect|stream|retry|request/i.test(text) ? 'network-or-upstream' : /sandbox/i.test(text) ? 'sandbox' : 'other';
  const info = error.codexErrorInfo;
  const rawCode = typeof info === 'string' ? info : info && Object.keys(info)[0];
  const codes = ['contextWindowExceeded', 'sessionBudgetExceeded', 'usageLimitExceeded', 'rateLimitExceeded', 'serverOverloaded', 'cyberPolicy', 'misalignmentPolicyViolation', 'httpConnectionFailed', 'responseStreamConnectionFailed', 'internalServerError', 'unauthorized', 'badRequest', 'threadRollbackFailed', 'sandboxError', 'responseStreamDisconnected', 'responseTooManyFailedAttempts', 'activeTurnNotSteerable', 'other'];
  const code = codes.includes(rawCode) ? rawCode : undefined;
  const http = code && typeof info === 'object' ? info[code]?.httpStatusCode : undefined;
  return { method, kind, ...(/websocket/i.test(text) ? { transport: 'websocket' } : /\bSSE\b/i.test(text) ? { transport: 'sse' } : {}), ...(code ? { errorCode: code } : {}), ...(Number.isInteger(http) && http >= 100 && http <= 599 ? { httpStatusCode: http } : {}) };
}
