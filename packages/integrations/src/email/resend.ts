import type { EmailMessage, EmailPort } from './port';

/**
 * Resend, por HTTP.
 *
 * Sin SDK a propósito: es un POST con una API key, y una dependencia menos
 * es una superficie menos que actualizar. Si el día de mañana hace falta algo
 * que la API REST no da, se cambia acá adentro.
 */
export class ResendAdapter implements EmailPort {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        reply_to: message.replyTo,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // El error sube: el worker lo guarda y reintenta con espera creciente.
      throw new Error(`Resend respondió ${response.status}: ${detail.slice(0, 200)}`);
    }
  }
}
