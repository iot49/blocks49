import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';

import { getDb } from '../db/index.js';
import { layouts, images } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';

// Extend Hono environment to include AuthUser
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();

// Local Storage Path (Docker Volume)
const projectRoot = new URL('../../../', import.meta.url).pathname;
const STORAGE_DIR = process.env.STORAGE_DIR || join(projectRoot, 'local/server/data/images');

// Helper to scope image queries by ownership (via layout)
async function getScopedImage(imageId: string, user: AuthUser) {
    const db = getDb();
    const isAdmin = user.roles.includes('admin');

    if (isAdmin) {
        return await db.select().from(images).where(eq(images.id, imageId)).get();
    }

    // Join with layouts to verify ownership implicitly in the query
    const result = await db.select({
        image: images
    })
    .from(images)
    .innerJoin(layouts, eq(images.layoutId, layouts.id))
    .where(and(
        eq(images.id, imageId),
        eq(layouts.userId, user.id)
    ))
    .get();

    return result?.image;
}

// PATCH /api/images/:id - Update Metadata (e.g., labels)
app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const body = await c.req.json();
    const db = getDb();

    // 1. Get Image Metadata (Scoped)
    const image = await getScopedImage(id, user);
    if (!image) return c.json({ error: 'Image not found or unauthorized' }, 404);

    // 2. Perform Update
    const updateData: any = {};
    if (body.markers !== undefined) {
        updateData.markers = body.markers;
    } else if (body.labels !== undefined) {
        updateData.markers = body.labels;
    }

    const updated = await db.update(images)
        .set(updateData)
        .where(eq(images.id, id))
        .returning()
        .get();

    return c.json({ image: updated });
});

// GET /api/images/:id - Serve Binary
app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;

    // 1. Get Image Metadata (Scoped)
    const image = await getScopedImage(id, user);
    if (!image) return c.json({ error: 'Image not found or unauthorized' }, 404);

    // 2. Serve File
    const storageKey = `${image.id}.jpg`; 
    
    try {
        const buffer = await readFile(join(STORAGE_DIR, storageKey));
        return c.body(buffer, 200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'private, max-age=86400'
        });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            return c.json({ error: 'File not found on disk' }, 404);
        }
        return c.json({ error: 'File read error' }, 500);
    }
});

// DELETE /api/images/:id - Delete Image
app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();

    // 1. Get Image Metadata (Scoped)
    const image = await getScopedImage(id, user);
    if (!image) return c.json({ error: 'Image not found or unauthorized' }, 404);

    // 2. Delete from Disk
    const storageKey = `${image.id}.jpg`;
    try {
        await unlink(join(STORAGE_DIR, storageKey));
    } catch (e: any) {
        // Log skip if doesn't exist, but don't fail
    }

    // 3. Delete DB Record
    await db.delete(images).where(eq(images.id, id)).run();

    return c.json({ success: true });
});

export default app;
