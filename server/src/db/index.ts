import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import * as schema from './schema.js'; 
import type { Context } from 'hono';

let nodeDbInstance: any;

export function setNodeDb(db: any) {
    nodeDbInstance = db;
}

// Check if we are in a Cloudflare Worker environment or Node
// For Phase 1 (Local Script), we assume Node.js + better-sqlite3

export function getDb(c?: Context): any {
    // 1. Cloudflare D1 Mode (if context and DB binding provided)
    if (c?.env?.DB) {
        return drizzleD1(c.env.DB, { schema });
    }

    // 2. Node.js / Local Mode
    if (!nodeDbInstance) {
        throw new Error('[DB] nodeDbInstance not initialized. Call setNodeDb first.');
    }
    
    return nodeDbInstance;
}
