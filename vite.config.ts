import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __GM__: JSON.stringify(mode !== 'production' || process.env.FORGE_GM === '1'),
  },
  build: {
    outDir: 'dist',
    target: 'es2019',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
