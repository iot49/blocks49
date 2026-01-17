import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

let nodeDbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getSqliteDb() {
    if (nodeDbInstance) return nodeDbInstance;

    // Use absolute path resolved from project root
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../');
    const dbPath = process.env.DB_URL || join(projectRoot, 'local/server/data.db');
    
    console.log(`[DB] SQLite Database File: ${dbPath}`);
    
    // Ensure directory exists
    try {
        mkdirSync(dirname(dbPath), { recursive: true });
    } catch (e) {
        console.warn(`[DB] Failed to ensure directory for ${dbPath}`, e);
    }

    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');

    nodeDbInstance = drizzle(sqlite, { schema });

    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const migrationsFolder = join(__dirname, '../../drizzle');
        console.log(`[DB] Migrations Folder: ${migrationsFolder}`);
        migrate(nodeDbInstance, { migrationsFolder });
    } catch (error) {
        console.error(`[DB] SQLite Migration failed:`, error);
    }

    return nodeDbInstance;
}
