import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

let nodeDbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getSqliteDb() {
    if (nodeDbInstance) return nodeDbInstance;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const projectRoot = join(__dirname, '../../..');
    const dbPath = process.env.DB_URL || join(projectRoot, 'local/server/data.db');

    console.log(`[DB] SQLite Database File: ${dbPath}`);
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');

    nodeDbInstance = drizzle(sqlite, { schema });

    try {
        const migrationsFolder = join(projectRoot, 'server/drizzle');
        migrate(nodeDbInstance, { migrationsFolder });
    } catch (error) {
        console.error(`[DB] SQLite Migration failed:`, error);
    }

    return nodeDbInstance;
}
