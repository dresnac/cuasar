export const COST_CATEGORIES = [
  ['MECHANICAL', 'Mecánica'],
  ['BODYWORK', 'Chapa y pintura'],
  ['DETAILING', 'Limpieza y detailing'],
  ['PAPERWORK', 'Papeles y trámites'],
  ['TRANSPORT', 'Traslado'],
  ['MARKETING', 'Publicación'],
  ['OTHER', 'Otros'],
] as const;

export const COST_LABEL: Record<string, string> = Object.fromEntries(COST_CATEGORIES);
