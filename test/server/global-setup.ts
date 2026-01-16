import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';

export async function setup() {
  const projectRoot = join(__dirname, '../../');
  
  const testDbPath = join(projectRoot, 'local/tmp/test-data.db');
  const testStorageDir = join(projectRoot, 'local/tmp/test-images');

  // Set environment variables for tests
  process.env.DB_URL = testDbPath;
  process.env.STORAGE_DIR = testStorageDir;
  process.env.NODE_ENV = 'test';

  // Ensure fresh state for tests
  rmSync(dirname(testDbPath), { recursive: true, force: true });
  mkdirSync(testStorageDir, { recursive: true });

  console.log(`[Test Setup] DB: ${testDbPath}`);
  console.log(`[Test Setup] Storage: ${testStorageDir}`);
}

export async function teardown() {
  console.log(`[Test Teardown] Cleaning up test artifacts...`);
  if (process.env.DB_URL) {
    rmSync(process.env.DB_URL, { force: true });
    rmSync(`${process.env.DB_URL}-shm`, { force: true });
    rmSync(`${process.env.DB_URL}-wal`, { force: true });
  }
  if (process.env.STORAGE_DIR) {
    rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
  }
}
