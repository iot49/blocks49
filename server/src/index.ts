import { serve } from '@hono/node-server';
import app from './app.js';
import * as dotenv from 'dotenv';
import { setNodeDb } from './db/index.js';
import { getSqliteDb } from './db/sqlite.js';

dotenv.config();

// Initialize Local DB for Node.js
setNodeDb(getSqliteDb());

const port = Number(process.env.PORT) || 3000;

console.log(`Server is running on port ${port}`);

import cron from 'node-cron';
import { exportToDrive } from './services/export-service.js';
import { getStorage } from './services/storage.js';

// ... imports

// Schedule Daily Backup at 2 AM
cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Starting daily export...');
    try {
        const db = getSqliteDb();
        // Mock context for getStorage in Node environment
        const storage = getStorage({} as any); 
        const result = await exportToDrive(db, storage);
        console.log('[Cron] Export completed:', result);
    } catch (e: any) {
        console.error('[Cron] Export failed:', e.message);
    }
});

serve({
  fetch: app.fetch,
  port
});
