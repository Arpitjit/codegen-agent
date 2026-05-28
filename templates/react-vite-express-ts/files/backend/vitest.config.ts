import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: ['default'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
