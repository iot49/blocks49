import { defineConfig } from 'vitest/config';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts',
    environment: 'node',
  },
});
