import { Hono, type Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { getStorage } from '../services/storage.js';
import { layouts, images } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';

// Extend Hono environment to include AuthUser
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();

// Helper to scope image queries by ownership (via layout)
async function getScopedImage(c: Context, imageId: string, user: AuthUser) {
    const db = getDb(c);
    const isAdmin = user.roles.includes('admin');

    if (isAdmin) {
        return await db.select().from(images).where(eq(images.id, imageId)).get();
    }

    const result = await db.select({
        image: images
    })
    .from(images)
    .innerJoin(layouts, eq(images.layoutId, layouts.id))
    .where(and(
        eq(images.id, imageId),
        eq(layouts.userId, user.id)
    ))
    .get() as { image: typeof images.$inferSelect } | undefined;

    return result?.image;
}

// PATCH /api/images/:id - Update Metadata (e.g., labels)
app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const body = await c.req.json();
    const db = getDb(c);

    // 1. Get Image Metadata (Scoped)
    const image = await getScopedImage(c, id, user);
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
    const image = await getScopedImage(c, id, user);
    if (!image) return c.json({ error: 'Image not found or unauthorized' }, 404);

    // 2. Serve File
    try {
        const storage = getStorage(c);
        return await storage.get(c, `${image.id}.jpg`);
    } catch (e: any) {
        return c.json({ error: 'File read error', message: e.message }, 500);
    }
});

// DELETE /api/images/:id - Delete Image
app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb(c);

    // 1. Get Image Metadata (Scoped)
    const image = await getScopedImage(c, id, user);
    if (!image) return c.json({ error: 'Image not found or unauthorized' }, 404);

    // 2. Delete from Storage
    try {
        const storage = getStorage(c);
        await storage.delete(c, `${image.id}.jpg`);
    } catch (e: any) {
        // Log skip if doesn't exist, but don't fail
    }

    // 3. Delete DB Record
    await db.delete(images).where(eq(images.id, id)).run();

    return c.json({ success: true });
});

export default app;
