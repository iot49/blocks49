import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { getStorage } from '../services/storage.js';
import { exportToDrive } from '../services/export-service.js';

const exportRoutes = new Hono();

exportRoutes.post('/', async (c) => {
    try {
        const db = getDb(c);
        const storage = getStorage(c);
        const result = await exportToDrive(db, storage, c.env);
        return c.json(result);
    } catch (e: any) {
        console.error('Export failed', e);
        return c.json({ error: 'Export failed', details: e.message }, 500);
    }
});

export { exportRoutes };
