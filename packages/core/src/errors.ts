/**
 * Los errores de dominio son valores, no excepciones: la UI muestra
 * mensajes, no stack traces, y el compilador obliga a manejarlos.
 */
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'SUBSCRIPTION_INACTIVE';

export type DomainError = {
  code: DomainErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: DomainError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = <T = never>(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Result<T> => ({ ok: false, error: { code, message, details } });

export const isOk = <T>(r: Result<T>): r is { ok: true; data: T } => r.ok;

/** Desenvuelve o lanza. Solo para tests y scripts, nunca en un request. */
export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  throw new Error(`${r.error.code}: ${r.error.message}`);
}
