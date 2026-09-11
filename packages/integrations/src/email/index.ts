import { ConsoleEmailAdapter, type EmailPort } from './port';
import { ResendAdapter } from './resend';

export * from './port';
export * from './resend';

/**
 * Qué adapter usar. Con `RESEND_API_KEY` y un remitente configurados manda de
 * verdad; sin eso deja el mail en el log y sigue. Que falte el proveedor no
 * puede romper el resto del sistema.
 */
export function emailAdapter(): EmailPort {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (apiKey && from) return new ResendAdapter(apiKey, from);
  return new ConsoleEmailAdapter();
}
