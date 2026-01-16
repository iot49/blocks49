import { defineConfig } from 'vitest/config';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

export default defineConfig({
  test: {
    globalSetup: '../test/server/global-setup.ts',
    environment: 'node',
    include: ['../test/server/**/*.test.ts'],
  },
});
