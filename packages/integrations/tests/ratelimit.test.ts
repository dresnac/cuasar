import { describe, expect, it } from 'vitest';
import { clientIp, rateLimit, RULES } from '../src/ratelimit';

/**
 * Sin Redis configurado el límite cae al contador en memoria, que es lo que
 * se prueba acá. El comportamiento global con Redis se verifica en el
 * despliegue; lo que estos tests cuidan es la lógica de la ventana.
 */

const uniqueKey = (name: string) => `${name}:${Math.random().toString(36).slice(2)}`;

describe('límite de pedidos', () => {
  it('deja pasar hasta el tope y después corta', async () => {
    const key = uniqueKey('tope');
    const rule = { limit: 3, windowSeconds: 60 };

    expect((await rateLimit(key, rule)).ok).toBe(true);
    expect((await rateLimit(key, rule)).ok).toBe(true);

    const third = await rateLimit(key, rule);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);

    expect((await rateLimit(key, rule)).ok).toBe(false);
  });

  it('cada clave lleva su propia cuenta', async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    const a = uniqueKey('ip-a');
    const b = uniqueKey('ip-b');

    expect((await rateLimit(a, rule)).ok).toBe(true);
    expect((await rateLimit(a, rule)).ok).toBe(false);

    // Que una IP se haya pasado no puede afectar a otra.
    expect((await rateLimit(b, rule)).ok).toBe(true);
  });

  it('la ventana se libera al vencer', async () => {
    const key = uniqueKey('ventana');
    const rule = { limit: 1, windowSeconds: 1 };

    expect((await rateLimit(key, rule)).ok).toBe(true);
    expect((await rateLimit(key, rule)).ok).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await rateLimit(key, rule)).ok).toBe(true);
  });

  it('avisa que el límite es por instancia cuando no hay Redis', async () => {
    const result = await rateLimit(uniqueKey('aviso'), RULES.publicLead);
    expect(result.distributed).toBe(false);
  });

  it('el tope del formulario público es más alto que el de la base', async () => {
    // El límite por IP es la primera barrera; el durable son tres por hora por
    // teléfono, en la base. Si el de IP fuera más bajo, el otro nunca actuaría.
    expect(RULES.publicLead.limit).toBeGreaterThan(3);
  });
});

describe('IP del visitante', () => {
  it('toma la primera de la cadena de proxies', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' });
    expect(clientIp(headers)).toBe('203.0.113.7');
  });

  it('cae a x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('sin ninguna, limita a todos juntos antes que a nadie', () => {
    expect(clientIp(new Headers())).toBe('sin-ip');
  });
});
