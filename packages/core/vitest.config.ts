import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // El loader de env tiene que correr antes de que se importe el cliente
    // de base: los tests de dominio no lo necesitan, los de integración sí.
    setupFiles: ['@cuasar/db/env'],
    // Las transiciones y proyecciones tocan las mismas filas del seed.
    fileParallelism: false,
  },
});
