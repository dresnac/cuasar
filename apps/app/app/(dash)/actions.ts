'use server';

import { revalidatePath } from 'next/cache';
import { switchAgency } from '@/lib/tenant';

export async function selectAgency(agencyId: string) {
  await switchAgency(agencyId);
  revalidatePath('/', 'layout');
}
