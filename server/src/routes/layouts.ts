import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { join } from 'path';

import { getDb } from '../db/index.js';
import { layouts, images, users } from '../db/schema.js';
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

// Schema for Creating/Updating Layouts
const layoutSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  classifier: z.string().optional().nullable(),
  mqttBroker: z.string().optional().nullable(),
  mqttTopic: z.string().optional().nullable(),
  scale: z.enum(['G', 'O', 'S', 'HO', 'T', 'N', 'Z']).default('HO'),
});

// --- ADMIN ROUTES ---
// Mounted at /api/layouts
export const adminRoutes = new Hono<Env>();

adminRoutes.get('/', async (c) => {
  const db = getDb();
  const results = await db.select().from(layouts).orderBy(desc(layouts.updatedAt)).all();
  return c.json({ layouts: results });
});

adminRoutes.get('/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb();
    const layout = await db.select().from(layouts).where(eq(layouts.id, id)).get();
    if (!layout) return c.json({ error: 'Not found' }, 404);
    const layoutImages = await db.select().from(images).where(eq(images.layoutId, id)).all();
    return c.json({ layout: { ...layout, images: layoutImages } });
});

// --- USER ROUTES (Scoped) ---
// Mounted at /api/user/layouts
export const userRoutes = new Hono<Env>();

userRoutes.get('/', async (c) => {
  const user = c.var.user;
  const db = getDb();
  const results = await db.select()
    .from(layouts)
    .where(eq(layouts.userId, user.id))
    .orderBy(desc(layouts.updatedAt))
    .all();
  return c.json({ layouts: results });
});

userRoutes.post('/', zValidator('json', layoutSchema), async (c) => {
  const user = c.var.user;
  const body = c.req.valid('json');
  const db = getDb();
  
  const newId = randomUUID();
  const newLayout = {
      id: newId,
      userId: user.id, 
      name: body.name,
      description: body.description,
      scale: body.scale,
      createdAt: new Date(),
      updatedAt: new Date()
  };
  await db.insert(layouts).values(newLayout as any); 
  return c.json({ layout: newLayout }, 201);
});

userRoutes.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();
    
    // Scoped Query
    const layout = await db.select().from(layouts)
        .where(and(eq(layouts.id, id), eq(layouts.userId, user.id)))
        .get();
    if (!layout) return c.json({ error: 'Not found' }, 404);

    const layoutImages = await db.select().from(images).where(eq(images.layoutId, id)).all();
    return c.json({ layout: { ...layout, images: layoutImages } });
});

// Schema for Partial Updates
const patchLayoutSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    classifier: z.string().optional().nullable(),
    mqttBroker: z.string().optional().nullable(),
    mqttTopic: z.string().optional().nullable(),
    scale: z.enum(['G', 'O', 'S', 'HO', 'T', 'N', 'Z']).optional(),
    p1x: z.number().optional().nullable(),
    p1y: z.number().optional().nullable(),
    p2x: z.number().optional().nullable(),
    p2y: z.number().optional().nullable(),
    referenceDistanceMm: z.number().optional().nullable(),
});

userRoutes.patch('/:id', zValidator('json', patchLayoutSchema), async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const body = c.req.valid('json');
    const db = getDb();

    // Verify Scoped Existence
    const layout = await db.select().from(layouts)
        .where(and(eq(layouts.id, id), eq(layouts.userId, user.id)))
        .get();
    if (!layout) return c.json({ error: 'Not found' }, 404);

    const updateData = { ...body, updatedAt: new Date() };
    const updated = await db.update(layouts)
        .set(updateData)
        .where(eq(layouts.id, id))
        .returning()
        .get();

    return c.json({ layout: updated });
});

userRoutes.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();

    // Verify Scoped Existence
    const layout = await db.select().from(layouts)
        .where(and(eq(layouts.id, id), eq(layouts.userId, user.id)))
        .get();
    if (!layout) return c.json({ error: 'Not found' }, 404);

    const layoutImages = await db.select().from(images).where(eq(images.layoutId, id)).all();
    for (const image of layoutImages) {
        const filePath = join(STORAGE_DIR, `${image.id}.jpg`);
        try { await unlink(filePath); } catch (e) {}
    }

    await db.delete(images).where(eq(images.layoutId, id)).run();
    await db.delete(layouts).where(eq(layouts.id, id)).run();

    return c.json({ success: true });
});

export default app;
