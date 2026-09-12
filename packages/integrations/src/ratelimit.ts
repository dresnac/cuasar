/**
 * Límite de pedidos.
 *
 * Con Redis configurado el límite es global: cuenta igual desde cualquier
 * instancia. Sin Redis cae a un contador en memoria del proceso, que es
 * honestamente peor —cada instancia lleva su propia cuenta, así que el tope
 * real se multiplica por la cantidad de instancias— pero sigue frenando el
 * caso que importa, que es alguien golpeando el mismo endpoint en loop.
 *
 * El límite durable de verdad para las consultas del sitio público está en la
 * base (tres por hora por teléfono, en `createPublicLead`): eso no depende de
 * ningún caché y no se puede saltear reiniciando nada.
 */

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: Date;
  /** `false` cuando el límite es por instancia y no global. */
  distributed: boolean;
};

export type RateLimitRule = { limit: number; windowSeconds: number };

export const RULES = {
  /** Consultas desde el sitio público, por IP. */
  publicLead: { limit: 8, windowSeconds: 3600 },
  /** Invalidación de caché entre despliegues. */
  revalidate: { limit: 120, windowSeconds: 60 },
  /** Tokens de subida de fotos, por agencia. */
  upload: { limit: 200, windowSeconds: 3600 },
} satisfies Record<string, RateLimitRule>;

interface RateLimitStore {
  readonly distributed: boolean;
  hit(key: string, rule: RateLimitRule): Promise<{ count: number; resetAt: Date }>;
}

/**
 * Ventana fija en memoria del proceso.
 *
 * Se limpia sola: cada acceso descarta las ventanas vencidas, así que el mapa
 * no crece indefinidamente con IPs que pasaron una vez.
 */
class MemoryStore implements RateLimitStore {
  readonly distributed = false;
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, rule: RateLimitRule) {
    const now = Date.now();

    if (this.windows.size > 10_000) {
      for (const [k, window] of this.windows) {
        if (window.resetAt <= now) this.windows.delete(k);
      }
    }

    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + rule.windowSeconds * 1000;
      this.windows.set(key, { count: 1, resetAt });
      return { count: 1, resetAt: new Date(resetAt) };
    }

    existing.count += 1;
    return { count: existing.count, resetAt: new Date(existing.resetAt) };
  }
}

/** Upstash por REST: un INCR y un EXPIRE en un pipeline. */
class UpstashStore implements RateLimitStore {
  readonly distributed = true;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async hit(key: string, rule: RateLimitRule) {
    const response = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        // NX: el vencimiento se fija solo la primera vez, así la ventana no se
        // renueva con cada pedido y quien golpea en loop no la extiende.
        ['EXPIRE', key, String(rule.windowSeconds), 'NX'],
        ['TTL', key],
      ]),
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) throw new Error(`Upstash respondió ${response.status}`);

    const [incr, , ttl] = (await response.json()) as { result: number }[];
    const seconds = ttl?.result && ttl.result > 0 ? ttl.result : rule.windowSeconds;

    return { count: incr?.result ?? 1, resetAt: new Date(Date.now() + seconds * 1000) };
  }
}

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (store) return store;

  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  store = url && token ? new UpstashStore(url, token) : new MemoryStore();
  return store;
}

/**
 * Consume un intento. Si el store falla, deja pasar.
 *
 * Es una decisión: un Redis caído no puede dejar a las agencias sin poder
 * publicar ni a los compradores sin poder consultar. El riesgo de una ventana
 * sin límite es menor que el de una plataforma caída por su propio guardia.
 */
export async function rateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const active = getStore();

  try {
    const { count, resetAt } = await active.hit(`rl:${key}`, rule);
    return {
      ok: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
      distributed: active.distributed,
    };
  } catch (error) {
    console.warn('[cuasar:ratelimit] el store falló, se deja pasar', { key, error });
    return {
      ok: true,
      remaining: rule.limit,
      resetAt: new Date(Date.now() + rule.windowSeconds * 1000),
      distributed: active.distributed,
    };
  }
}

/**
 * La IP del visitante detrás del proxy de Vercel.
 *
 * `x-forwarded-for` puede traer una cadena; la primera es el cliente. Si no
 * hay ninguna, se devuelve una clave fija: es mejor limitar a todos juntos que
 * no limitar a nadie.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'sin-ip';
}
