import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // WxtVitest gives tests the same path aliases and auto-imports as the build.
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Coverage is reported for the pure core only (spec: "Report test
      // coverage for src/core/"). UI and Chrome glue are tested manually.
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.test.ts', 'src/core/testing.ts'],
      reporter: ['text', 'html'],
    },
  },
});
