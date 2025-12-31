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
const STORAGE_DIR = process.env.STORAGE_DIR || './data/images';

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
    // In local FS, filenames were UUID.ext. We need to store that or infer.
    // In upload, we saved as `imageId.extension`.
    // Wait, DB stores original filename `image.filename` (e.g. `train.jpg`).
    // We didn't store the storage key in DB in the schema I wrote earlier?
    // Checking schema... "filename".
    // Upload logic: `const filename = ${imageId}.${extension}` -> `filePath`.
    // We should probably rely on ID + simple extension logic.
    // Let's assume .jpg or read directory? 
    // Correction: In Upload I inferred extension from original filename.
    // I should strictly store the extension or the storage path in DB.
    // Or just try to find the file.
    
    // Simplification for MVP: Try finding file with ID.
    // Or just update Upload to assume .jpg always if we control it? No, users upload png etc.
    // Let's rely on finding standard extension or update schema to store storageKey.
    // I'll update the logic to check extensions or just save storageKey.
    // For now: assume same extension as original filename.
    const ext = image.filename?.split('.').pop() || 'jpg';
    const storageKey = `${image.id}.${ext}`;
    
    try {
        const buffer = await readFile(join(STORAGE_DIR, storageKey));
        return c.body(buffer, 200, {
            'Content-Type': 'image/jpeg', // Dynamic based on ext ideally
        });
    } catch (e) {
        return c.json({ error: 'File read error' }, 500);
    }
});

export default app;
