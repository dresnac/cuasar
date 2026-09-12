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
    fileParallelism: false,
  },
});
