import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { getStorage } from '../services/storage.js';
import { layouts, images } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';

type Env = {
  Variables: {
    user: AuthUser;
  };
};

// --- USER ROUTES (Scoped by Ownership) ---
export const userImageRoutes = new Hono<Env>();

userImageRoutes.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb(c);

    const result = await db.select({ image: images })
        .from(images)
        .innerJoin(layouts, eq(images.layoutId, layouts.id))
        .where(and(eq(images.id, id), eq(layouts.userId, user.id)))
        .get() as { image: typeof images.$inferSelect } | undefined;

    if (!result) return c.json({ error: 'Image not found or unauthorized' }, 404);

    try {
        const storage = getStorage(c);
        return await storage.get(c, `${result.image.id}.jpg`);
    } catch (e: any) {
        return c.json({ error: 'File read error', message: e.message }, 500);
    }
});

userImageRoutes.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const body = await c.req.json();
    const db = getDb(c);

    const image = await db.select({ id: images.id })
        .from(images)
        .innerJoin(layouts, eq(images.layoutId, layouts.id))
        .where(and(eq(images.id, id), eq(layouts.userId, user.id)))
        .get();

    if (!image) return c.json({ error: 'Image not found or unauthorized' }, 404);

    const updateData: any = {};
    if (body.markers !== undefined) updateData.markers = body.markers;
    if (body.labels !== undefined) updateData.markers = body.labels;

    const updated = await db.update(images)
        .set(updateData)
        .where(eq(images.id, id))
        .returning()
        .get();

    return c.json({ image: updated });
});

userImageRoutes.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb(c);

    const image = await db.select({ id: images.id })
        .from(images)
        .innerJoin(layouts, eq(images.layoutId, layouts.id))
        .where(and(eq(images.id, id), eq(layouts.userId, user.id)))
        .get();

    if (!image) return c.json({ error: 'Image not found or unauthorized' }, 404);

    try {
        const storage = getStorage(c);
        await storage.delete(c, `${id}.jpg`);
    } catch (e) {}

    await db.delete(images).where(eq(images.id, id)).run();
    return c.json({ success: true });
});

// --- ADMIN ROUTES (Direct Access) ---
export const adminImageRoutes = new Hono<Env>();

adminImageRoutes.get('/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb(c);
    const image = await db.select().from(images).where(eq(images.id, id)).get();
    if (!image) return c.json({ error: 'Image not found' }, 404);

    const storage = getStorage(c);
    return await storage.get(c, `${image.id}.jpg`);
});

adminImageRoutes.patch('/:id/training', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDb(c);

    if (body.useForTraining === undefined) {
        return c.json({ error: 'useForTraining field required' }, 400);
    }

    const updated = await db.update(images)
        .set({ useForTraining: body.useForTraining })
        .where(eq(images.id, id))
        .returning()
        .get();

    if (!updated) return c.json({ error: 'Image not found' }, 404);
    return c.json({ image: updated });
});
