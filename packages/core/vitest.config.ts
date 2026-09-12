import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * 20 segundos y no los 5 por defecto.
     *
     * Estos tests hablan con una base remota: cada operación de dominio son
     * diez o quince viajes de ida y vuelta de ~70 ms cada uno. No son lentos
     * por el código, son lentos por la red, y un timeout ajustado los vuelve
     * intermitentes según cómo esté el enlace ese día.
     */
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // El loader de env tiene que correr antes de que se importe el cliente
    // de base: los tests de dominio no lo necesitan, los de integración sí.
    setupFiles: ['@cuasar/db/env'],
    // Las transiciones y proyecciones tocan las mismas filas del seed.
    fileParallelism: false,
  },
});
