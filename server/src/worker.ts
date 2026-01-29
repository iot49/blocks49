import app from './app.js';
import { CONFIG } from './config.js';
import { getDb } from './db/index.js';
import { getStorage } from './services/storage.js';
import { exportToDrive } from './services/export-service.js';

export default {
    fetch: app.fetch,
    
    async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
        console.log('[Cron] Starting scheduled export...');
        
        try {
            // 1. Setup DB
            const mockC = { env } as any;
            const db = getDb(mockC);
            
            // 2. Setup Storage
            const storage = getStorage(mockC);

            // 3. Run Export
            // Pass env to allow R2 storage access
            const result = await exportToDrive(db, storage, env, CONFIG.EXPORT.FOLDER_NAME_PROD);
            console.log('[Cron] Export Result:', result);

        } catch (e: any) {
            console.error('[Cron] Export failed:', e);
        }
    }
}
