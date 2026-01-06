import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
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
const serverRoot = new URL('../../', import.meta.url).pathname;
const STORAGE_DIR = process.env.STORAGE_DIR || join(serverRoot, 'data/images');

// Helper to resolve User UUID from Email
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
    console.log(`[Backend] Created new user reference for ${email} -> ${newId}`);
    return newId;
}

// Schema for Creating/Updating Layouts
const layoutSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scale: z.enum(['N', 'HO', 'Z', 'O', 'G']).default('N'), // Extend as needed
});

// GET /api/layouts - List All User Layouts
app.get('/', async (c) => {
  const user = c.var.user;
  const db = getDb();

  // Admin sees all, User sees own
  let query = db
    .select()
    .from(layouts)
    .orderBy(desc(layouts.updatedAt));

  if (user.role !== 'admin') {
    const userId = await ensureUserId(user.email);
    query = query.where(eq(layouts.userId, userId)) as any;
  }
  
  const results = await query.all();
  return c.json({ layouts: results });
});

// POST /api/layouts - Create New
app.post('/', zValidator('json', layoutSchema), async (c) => {
  const user = c.var.user;
  const body = c.req.valid('json');
  const db = getDb();
  
  const userId = await ensureUserId(user.email);
  const newId = randomUUID();
  
  const newLayout = {
      id: newId,
      userId: userId, 
      name: body.name,
      description: body.description,
      scale: body.scale,
      createdAt: new Date(),
      updatedAt: new Date()
  };

  await db.insert(layouts).values(newLayout as any); 
  
  return c.json({ layout: newLayout }, 201);
});

// GET /api/layouts/:id - Get Single
app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();
    
    // 1. Get Layout
    const layout = await db.select().from(layouts).where(eq(layouts.id, id)).get();
    if (!layout) return c.json({ error: 'Not found' }, 404);

    // 2. Verify Ownership
    if (user.role !== 'admin') {
        const userId = await ensureUserId(user.email);
        if (layout.userId !== userId) {
             return c.json({ error: 'Unauthorized' }, 403);
        }
    }
    
    // 3. Get Images
    const layoutImages = await db.select().from(images).where(eq(images.layoutId, id)).all();
    
    return c.json({ layout: { ...layout, images: layoutImages } });
});

// Schema for Partial Updates
// Schema for Partial Updates
const patchLayoutSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    scale: z.enum(['N', 'HO', 'Z', 'O', 'G']).optional(),
    p1x: z.number().optional(),
    p1y: z.number().optional(),
    p2x: z.number().optional(),
    p2y: z.number().optional(),
    referenceDistanceMm: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
});

// PATCH /api/layouts/:id - Update
app.patch('/:id', zValidator('json', patchLayoutSchema), async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const body = c.req.valid('json');
    const db = getDb();

    // 1. Verify Existence & Ownership
    const layout = await db.select().from(layouts).where(eq(layouts.id, id)).get();
    if (!layout) return c.json({ error: 'Not found' }, 404);
    
    if (user.role !== 'admin') {
        const userId = await ensureUserId(user.email);
        if (layout.userId !== userId) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    }

    // 2. Perform Update
    const updateData = {
        ...body,
        updatedAt: new Date(),
    };

    const updated = await db.update(layouts)
        .set(updateData)
        .where(eq(layouts.id, id))
        .returning()
        .get();

    return c.json({ layout: updated });
});

// DELETE /api/layouts/:id - Delete Layout and its images
app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();

    // 1. Verify Existence & Ownership
    const layout = await db.select().from(layouts).where(eq(layouts.id, id)).get();
    if (!layout) return c.json({ error: 'Not found' }, 404);
    
    if (user.role !== 'admin') {
        const userId = await ensureUserId(user.email);
        if (layout.userId !== userId) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    }

    // 2. Find and Delete Images from FS
    const layoutImages = await db.select().from(images).where(eq(images.layoutId, id)).all();
    for (const image of layoutImages) {
        // Filename on disk uses image.id + .jpg
        const storageKey = `${image.id}.jpg`; 
        const filePath = join(STORAGE_DIR, storageKey);
        try {
            await unlink(filePath);
        } catch (e) {
            console.error(`[Backend] Failed to delete file ${filePath}:`, e);
        }
    }

    // 3. Delete DB Records
    await db.delete(images).where(eq(images.layoutId, id)).run();
    await db.delete(layouts).where(eq(layouts.id, id)).run();

    return c.json({ success: true });
});

export default app;
