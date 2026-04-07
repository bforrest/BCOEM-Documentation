import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,mjs}', 'scripts/**/*.test.mjs'],
    passWithNoTests: true,
  },
});
