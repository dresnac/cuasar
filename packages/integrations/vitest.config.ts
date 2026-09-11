import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['@cuasar/db/env'], fileParallelism: false },
});
