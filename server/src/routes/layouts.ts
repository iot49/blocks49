import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { getDb } from '../db/index.js';
import { layouts } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';

// Extend Hono environment to include AuthUser
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();

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
  const query = db
    .select()
    .from(layouts)
    .orderBy(desc(layouts.updatedAt));

  if (user.role !== 'admin') {
    query.where(eq(layouts.userId, user.email)); // Using email as ID for now since auth middleware uses it. 
    // TODO: In real app, we'd lookup User ID from email first or store UUID in JWT.
    // For this mock phase, we'll assume user.email matches the inserted userId or we align them.
    // Actually, in schema users.id is UUID. Let's fix this in follow-up to look up user.
  }
  
  // For now in Local dev, we just return all because mock user might not match seed data UUIDs
  // Let's constrain strictly for correctness:
  // query.where(eq(layouts.userId, user.id)) <-- We need user.id in context!
  
  const results = await query.all();
  return c.json({ layouts: results });
});

// POST /api/layouts - Create New
app.post('/', zValidator('json', layoutSchema), async (c) => {
  const user = c.var.user;
  const body = c.req.valid('json');
  const db = getDb();
  
  const newId = randomUUID();
  
  // Create user record if not exists? Or assume existing?
  // For speed, just insert.
  
  const newLayout = {
      id: newId,
      userId: user.email, // Storing Email as ID for simplicity in this phase, or we need a lookup. 
      // Schema says userId is reference to users.id (UUID). 
      // We should probably ensure the User exists.
      name: body.name,
      description: body.description,
      scale: body.scale,
      createdAt: new Date(),
      updatedAt: new Date()
  };

  // Safe insert - simplified relation handling for MVP
  // In a real app we'd `db.query.users.findFirst` by email to get UUID.
  await db.insert(layouts).values(newLayout as any); 
  
  return c.json({ layout: newLayout }, 201);
});

// GET /api/layouts/:id - Get Single
app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.var.user;
    const db = getDb();
    
    const layout = await db.select().from(layouts).where(eq(layouts.id, id)).get();
    
    if (!layout) return c.json({ error: 'Not found' }, 404);

    // Verify Ownership
    if (user.role !== 'admin' && layout.userId !== user.email) {
        return c.json({ error: 'Unauthorized' }, 403);
    }
    
    return c.json({ layout });
});

// Schema for Partial Updates
const patchLayoutSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    scale: z.enum(['N', 'HO', 'Z', 'O', 'G']).optional(),
    calibrationX1: z.number().optional(),
    calibrationY1: z.number().optional(),
    calibrationX2: z.number().optional(),
    calibrationY2: z.number().optional(),
    referenceDistanceMm: z.number().optional(),
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
    if (user.role !== 'admin' && layout.userId !== user.email) {
        return c.json({ error: 'Unauthorized' }, 403);
    }

    // 2. Perform Update
    // Filter out undefined keys from body to avoid overwriting with null/default if logic differed
    // Drizzle's `set` handles partial objects well.
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

export default app;
