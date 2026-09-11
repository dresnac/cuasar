/**
 * Mandar un mail.
 *
 * El dominio nunca importa un SDK: encola en `outbox` y el worker llama a
 * este puerto. Cambiar de proveedor es escribir otro adapter.
 */
export type EmailMessage = {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
};

export interface EmailPort {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * El adapter por defecto: escribe el mail en el log y no manda nada.
 *
 * Es lo que corre hasta que haya un dominio verificado. Deliberadamente no
 * falla: un mail que no se puede mandar todavía no tiene por qué frenar la
 * cola ni llenar la tabla de errores. Lo que sí hace es dejar rastro de que
 * la notificación existió.
 */
export class ConsoleEmailAdapter implements EmailPort {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    console.info('[cuasar:email] sin proveedor configurado, no se envió', {
      to: message.to,
      subject: message.subject,
    });
  }
}
