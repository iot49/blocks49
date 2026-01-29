
import { users, layouts, images } from '../db/schema.js';
import { DriveClient } from './drive-api.js';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { CONFIG } from '../config.js';

// Use 'any' for the schema generic to allow both typed and untyped DB instances
export async function exportToDrive(db: BetterSQLite3Database<any> | DrizzleD1Database<any>, storage: any, env: any, folderName?: string) {
    // Default folder name based on environment if not provided
    if (!folderName) {
        // Check both NODE_ENV and internal env prop if available (Cloudflare often sets NODE_ENV via vars too)
        const isProduction = process.env.NODE_ENV === 'production' || env?.NODE_ENV === 'production';
        folderName = isProduction ? CONFIG.EXPORT.FOLDER_NAME_PROD : CONFIG.EXPORT.FOLDER_NAME_LOCAL;
    }
    // 1. Auth via DriveClient
    const clientId = process.env.RAILS49_EXPORT_CLIENT_ID;
    const clientSecret = process.env.RAILS49_EXPORT_CLIENT_SECRET;
    const refreshToken = process.env.RAILS49_EXPORT_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing OAuth Credentials (RAILS49_EXPORT_CLIENT_ID, RAILS49_EXPORT_CLIENT_SECRET, RAILS49_EXPORT_REFRESH_TOKEN)');
    }

    const drive = new DriveClient(clientId, clientSecret, refreshToken);

    // 2. Resolve/Create Backup Folder
    let folderId = await drive.findFolder(folderName);
    if (!folderId) {
        folderId = await drive.createFolder(folderName);
    }

    if (!folderId) {
        throw new Error(`Failed to resolve or create target folder: ${folderName}`);
    }

    // 3. Database Export
    const dbDump = {
        meta: {
            exportedAt: new Date().toISOString(),
        },
        data: {
            users: await db.select().from(users).all(),
            layouts: await db.select().from(layouts).all(),
            images: await db.select().from(images).all(),
        }
    };
    
    const dbFileName = `db-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const dbContent = JSON.stringify(dbDump, null, 2);

    await drive.uploadFile(dbFileName, dbContent, 'application/json', folderId);

    // 4. Image Export
    let uploaded = 0;
    let skipped = 0;
    let errors: string[] = [];

    // Get existing files to skip duplicates
    const existingFiles = await drive.listFiles(folderId);

    for (const img of dbDump.data.images) {
        const filename = `${img.id}.jpg`;
        
        if (existingFiles.has(filename)) {
            skipped++;
            continue;
        }
        
        try {
            // Retrieve file from Storage (R2 or Local)
            // PASS THE PROPER ENV!
            const mockContext = { env: env || process.env };
            
            const fileRes = await storage.get(mockContext, filename);
            
            if (fileRes && fileRes.ok) {
                // Get ArrayBuffer
                const buffer = await fileRes.arrayBuffer();
                
                await drive.uploadFile(filename, buffer, 'image/jpeg', folderId);
                uploaded++;
            } else {
                // Image missing in storage
                errors.push(`${filename} (missing)`);
            }
        } catch (e: any) {
             // console.error(e);
            errors.push(filename);
        }
    }

    return { 
        success: true, 
        folderId,
        folderName, // Return the human-readable name
        dbFile: dbFileName, 
        stats: { totalImages: dbDump.data.images.length, uploaded, skipped, errors: errors.length } 
    };
}
