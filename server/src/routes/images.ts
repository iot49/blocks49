import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { images, layouts } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';
import { eq } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Extend Hono environment
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();
const serverRoot = new URL('../../', import.meta.url).pathname;
const STORAGE_DIR = process.env.STORAGE_DIR || join(serverRoot, 'data/images');

// GET /api/images/:id
app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();

    // 1. Get Image Metadata
    const image = await db.select().from(images).where(eq(images.id, id)).get();
    if (!image) return c.json({ error: 'Image not found' }, 404);

    // 2. Auth Check (Must own layout)
    if (user.role !== 'admin') {
        const layout = await db.select().from(layouts).where(eq(layouts.id, image.layoutId!)).get();
        if (!layout || layout.userId !== user.email) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    }

    // 3. Serve File
    const ext = image.filename?.split('.').pop()?.toLowerCase() || 'jpg';
    const storageKey = `${image.id}.${ext}`; 
    // Wait, Upload route saved as `imageId.extension` where extension came from filename.
    
    const mimeMap: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp'
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    
    try {
        const buffer = await readFile(join(STORAGE_DIR, storageKey));
        return c.body(buffer, 200, {
            'Content-Type': contentType,
            'Cache-Control': 'private, max-age=86400' // Cache for 1 day
        });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            return c.json({ error: 'File not found on disk' }, 404);
        }
        return c.json({ error: 'File read error' }, 500);
    }
});

export default app;
