import './env';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, 'sql');

/**
 * Orden importante:
 *   1. bootstrap  — uuidv7() tiene que existir antes de crear las tablas
 *   2. drizzle    — DDL generado desde el esquema
 *   3. el resto   — roles, RLS y triggers, que necesitan las tablas ya creadas
 *
 * Todos los archivos de sql/ son idempotentes: se reaplican en cada deploy.
 */
async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_UNPOOLED o DATABASE_URL requerida');

  // Sin pooler y con una sola conexión: el DDL necesita una sesión estable.
  const client = postgres(url, { max: 1, prepare: false });

  try {
    const files = (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();
    const bootstrap = files.filter((f) => f.startsWith('0001'));
    const rest = files.filter((f) => !f.startsWith('0001'));

    for (const f of bootstrap) await run(client, f);

    console.log('→ migraciones de Drizzle');
    await migrate(drizzle(client), { migrationsFolder: join(here, '..', 'drizzle') });

    for (const f of rest) await run(client, f);

    console.log('\n✓ base de datos al día');
  } finally {
    await client.end();
  }
}

async function run(client: postgres.Sql, file: string) {
  console.log(`→ ${file}`);
  const body = await readFile(join(sqlDir, file), 'utf8');
  await client.unsafe(body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
