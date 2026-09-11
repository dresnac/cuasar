import { config } from 'dotenv';

/**
 * Los scripts de DB corren desde packages/db, pero las variables las
 * escribe `vercel env pull` en la raíz del monorepo.
 */
config({ path: ['.env.local', '.env', '../../.env.local', '../../.env'], quiet: true });
