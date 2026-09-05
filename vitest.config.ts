import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // 'server-only' throws on import outside a React Server Component, which
      // would make every service untestable. Stub it: the guard exists to catch
      // an accidental *client* import, and a Node test is neither.
      'server-only': fileURLToPath(new URL('./server/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./server/test/setup.ts'],
    include: ['server/**/*.test.ts', 'lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts'],
    },
  },
});
