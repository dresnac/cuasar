'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { dbAdmin, eq, schema } from '@cuasar/db';
import { currentLocalUser, switchAgency } from '@/lib/tenant';

export type FormState = { error?: string };

const { agencies, agencySettings, memberships, subscriptions } = schema;

/**
 * Alta de una agencia. Se hace con el rol dueño y no con `withTenant`,
 * porque en este punto todavía no hay agencia a la cual acotarse: es la
 * única escritura del backoffice que legítimamente ocurre fuera de RLS.
 */
export async function createAgencyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await currentLocalUser();

  const name = String(fd.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre de la agencia.' };

  const baseCurrency = String(fd.get('baseCurrency')) === 'ARS' ? 'ARS' : 'USD';
  const slug = await availableSlug(name);

  const agencyId = await dbAdmin.transaction(async (tx) => {
    const [agency] = await tx
      .insert(agencies)
      .values({ name, slug, baseCurrency, status: 'ACTIVE' })
      .returning({ id: agencies.id });

    const id = agency!.id;

    await tx.insert(agencySettings).values({ agencyId: id });

    await tx.insert(memberships).values({
      agencyId: id,
      userId: user.id,
      role: 'OWNER',
      status: 'ACTIVE',
      activatedAt: new Date(),
    });

    // Arranca en prueba: la agencia puede cargar su patio antes de pagar.
    // El proveedor de cobro se elige al suscribirse, no ahora.
    await tx.insert(subscriptions).values({
      agencyId: id,
      planCode: 'base',
      status: 'TRIALING',
      provider: 'STRIPE',
      seatsPurchased: 5,
      currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000),
    });

    return id;
  });

  await switchAgency(agencyId);
  revalidatePath('/', 'layout');
  redirect('/vehiculos');
}

async function availableSlug(name: string) {
  const stem =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'agencia';

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? stem : `${stem}-${i + 1}`;
    const [taken] = await dbAdmin
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${stem}-${Date.now().toString(36)}`;
}
