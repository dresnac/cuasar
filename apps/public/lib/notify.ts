import 'server-only';
import { after } from 'next/server';
import { drainOutbox } from '@cuasar/integrations';

/**
 * Manda los avisos pendientes después de contestarle al visitante.
 *
 * El cron de la cola corre una vez por día —el plan Hobby de Vercel no permite
 * más—, y una consulta que tarda veinticuatro horas en avisarle a la agencia no
 * sirve para vender un auto. Así que además del cron, cada consulta que entra
 * dispara un drenaje justo después de que la respuesta ya salió.
 *
 * `after` es lo que hace que esto sea seguro: corre fuera del camino de la
 * respuesta, así que si el proveedor de mail está caído la persona igual ve su
 * "consulta enviada" y el mensaje queda en la cola para el próximo intento.
 */
export function drainAfterResponse() {
  after(async () => {
    try {
      await drainOutbox(5);
    } catch (error) {
      console.warn('[cuasar] no se pudo drenar la cola después del request', error);
    }
  });
}
