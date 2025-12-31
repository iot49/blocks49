import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js'; 
import { join } from 'path';

// Check if we are in a Cloudflare Worker environment or Node
// For Phase 1 (Local Script), we assume Node.js + better-sqlite3

// Type for the DB instance
type DB = ReturnType<typeof drizzle<typeof schema>>;
let dbInstance: DB | undefined;

export function getDb(): DB {
    if (dbInstance) return dbInstance;
    
    // Default to local file for dev scripts
    const serverRoot = new URL('../../', import.meta.url).pathname;
    const dbPath = process.env.DB_URL || join(serverRoot, 'data.db');
    
    console.log(`[DB] Using database at: ${dbPath}`);
    const sqlite = new Database(dbPath);
    dbInstance = drizzle(sqlite, { schema });
    return dbInstance;
}
