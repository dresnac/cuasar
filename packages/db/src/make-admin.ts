import './env';
import { eq, sql } from 'drizzle-orm';
import { dbAdmin, pgClient } from './client';
import * as schema from './schema';

/**
 * Da de alta un moderador de la plataforma.
 *
 *   pnpm db:make-admin tu@mail.com [SUPPORT|ADMIN]
 *
 * El panel de /plataforma no tiene alta desde la interfaz a propósito: quién
 * puede suspender agencias se decide con acceso a la base, no con un botón
 * que alguien pueda encontrar.
 */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const level = process.argv[3] === 'SUPPORT' ? 'SUPPORT' : 'ADMIN';

  if (!email) {
    console.error('Uso: pnpm db:make-admin <email> [SUPPORT|ADMIN]');
    process.exitCode = 1;
    return;
  }

  const [user] = await dbAdmin
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user) {
    console.error(
      `No hay ningún usuario con el mail ${email}. Entrá una vez a la aplicación con esa cuenta y volvé a correr esto.`,
    );
    process.exitCode = 1;
    return;
  }

  await dbAdmin
    .insert(schema.platformAdmins)
    .values({ userId: user.id, level })
    .onConflictDoUpdate({ target: schema.platformAdmins.userId, set: { level } });

  console.log(`✓ ${user.name ?? email} es moderador de la plataforma (${level}).`);
  console.log('  Entrá a /plataforma.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
