import type { Role } from '@cuasar/db';

/**
 * Qué puede hacer cada rol DENTRO de su agencia.
 *
 * Es la segunda capa de autorización; la primera es RLS en Postgres, que
 * impide ver otra agencia. Esta capa decide qué ve cada persona de la suya.
 *
 * Decisión de producto: SALES no ve adquisición, costos ni margen. Y no se
 * resuelve ocultando columnas en la UI — los servicios de dominio no
 * devuelven esos campos, porque un dato oculto en el front igual viaja
 * en el payload del RSC.
 */
export const PERMISSIONS = [
  'vehicle:read',
  'vehicle:write',
  'vehicle:transition',
  'vehicle:publish',
  'vehicle:delete',
  'price:list:write',
  'price:floor:read',
  'finance:read',
  'finance:write',
  'lead:read',
  'lead:write',
  'appointment:read',
  'appointment:write',
  'member:manage',
  'agency:settings',
  'billing:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  SALES: [
    'vehicle:read',
    'vehicle:write',
    'vehicle:transition',
    'vehicle:publish',
    'price:floor:read',
    'lead:read',
    'lead:write',
    'appointment:read',
    'appointment:write',
  ],
  VIEWER: ['vehicle:read', 'lead:read', 'appointment:read'],
};

export const can = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

export const permissionsFor = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];

/** El único lugar donde se decide si alguien ve plata de costos y márgenes. */
export const canSeeFinancials = (role: Role): boolean => can(role, 'finance:read');
