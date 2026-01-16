import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { images, layouts, users } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';
import { eq } from 'drizzle-orm';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Extend Hono environment
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();
const projectRoot = new URL('../../../', import.meta.url).pathname;
const STORAGE_DIR = process.env.STORAGE_DIR || join(projectRoot, 'local/server/data/images');

// Helper to resolve User UUID from Email (duplicated to avoid refactor overhead)
async function ensureUserId(email: string): Promise<string> {
    const db = getDb();
    const existing = await db.select().from(users).where(eq(users.email, email)).get();
    
    if (existing) {
        return existing.id;
    }

    // Create if not exists
    const newId = randomUUID();
    await db.insert(users).values({
        id: newId,
        email: email,
        role: 'user', // Default
        createdAt: new Date()
    });
    return newId;
}

// PATCH /api/images/:id - Update Metadata (e.g., labels)
app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const body = await c.req.json();
    const db = getDb();

    // 1. Get Image Metadata
    const image = await db.select().from(images).where(eq(images.id, id)).get();
    if (!image) return c.json({ error: 'Image not found' }, 404);

    // 2. Auth Check (Must own layout)
    if (user.role !== 'admin') {
        const layout = await db.select().from(layouts).where(eq(layouts.id, image.layoutId!)).get();
        const userId = await ensureUserId(user.email);
        
        if (!layout || layout.userId !== userId) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    }

    // 3. Perform Update
    const updateData: any = {};
    if (body.markers !== undefined) {
        updateData.markers = body.markers;
    } else if (body.labels !== undefined) {
        // Compatibility for transition
        updateData.markers = body.labels;
    }
    // Add other fields if needed

    const updated = await db.update(images)
        .set(updateData)
        .where(eq(images.id, id))
        .returning()
        .get();

    return c.json({ image: updated });
});

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
        const userId = await ensureUserId(user.email);
        
        if (!layout || layout.userId !== userId) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    }

    // 3. Serve File (Forced to .jpg)
    const storageKey = `${image.id}.jpg`; 
    const contentType = 'image/jpeg';
    
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

// DELETE /api/images/:id - Delete Image (Disk + DB)
app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();

    // 1. Get Image Metadata
    const image = await db.select().from(images).where(eq(images.id, id)).get();
    if (!image) return c.json({ error: 'Image not found' }, 404);

    // 2. Auth Check (Must own layout)
    if (user.role !== 'admin') {
        const layout = await db.select().from(layouts).where(eq(layouts.id, image.layoutId!)).get();
        const userId = await ensureUserId(user.email);
        
        if (!layout || layout.userId !== userId) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    }

    // 3. Delete from Disk
    const storageKey = `${image.id}.jpg`;
    const filePath = join(STORAGE_DIR, storageKey);
    try {
        await unlink(filePath);
        console.log(`[Backend] Deleted file from disk: ${filePath}`);
    } catch (e: any) {
        if (e.code !== 'ENOENT') {
            console.error(`[Backend] Failed to delete file ${filePath}:`, e);
            // We continue even if file deletion fails (maybe it was already gone)
        }
    }

    // 4. Delete from Database
    await db.delete(images).where(eq(images.id, id)).run();
    console.log(`[Backend] Deleted image record from DB: ${id}`);

    return c.json({ success: true });
});

export default app;


