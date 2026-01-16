import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema.js'; 
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Check if we are in a Cloudflare Worker environment or Node
// For Phase 1 (Local Script), we assume Node.js + better-sqlite3

// Type for the DB instance
type DB = ReturnType<typeof drizzle<typeof schema>>;
let dbInstance: DB | undefined;

export function getDb(): DB {
    if (dbInstance) return dbInstance;
    
    // Get absolute path to this file's directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // The server root is 2 levels up from src/db/index.ts
    // Local data is in <root>/local/server
    const projectRoot = join(__dirname, '../../..');
    const dbPath = process.env.DB_URL || join(projectRoot, 'local/server/data.db');
    
    console.log(`[DB] Database File: ${dbPath}`);
    const sqlite = new Database(dbPath);
    
    // Enable WAL mode for better concurrency in local dev
    sqlite.pragma('journal_mode = WAL');
    
    dbInstance = drizzle(sqlite, { schema });

    // Automatically apply migrations on startup/connection
    try {
        const migrationsFolder = join(projectRoot, 'server/drizzle');
        console.log(`[DB] Applying migrations from: ${migrationsFolder}`);
        migrate(dbInstance, { migrationsFolder });
        console.log(`[DB] Migrations applied successfully.`);
    } catch (error) {
        console.error(`[DB] Migration failed:`, error);
    }

    return dbInstance;
}
