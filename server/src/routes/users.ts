import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';

// Extend Hono environment to include AuthUser
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();

// GET /api/users/me - Get Current User data
app.get('/me', async (c) => {
    const authUser = c.var.user;
    const db = getDb();
    
    const user = await db.select().from(users).where(eq(users.id, authUser.id)).get();
    
    if (!user) {
        return c.json({ error: 'User not found in DB' }, 404);
    }
    
    return c.json({ user });
});

const patchUserSchema = z.object({
    profile: z.string().optional().nullable(),
    mqttBroker: z.string().optional().nullable(),
});

// PATCH /api/users/me - Update profile/settings
app.patch('/me', zValidator('json', patchUserSchema), async (c) => {
    const authUser = c.var.user;
    const body = c.req.valid('json');
    const db = getDb();

    const updated = await db.update(users)
        .set(body)
        .where(eq(users.id, authUser.id))
        .returning()
        .get();

    return c.json({ user: updated });
});

// --- Admin Routes ---

// GET /api/users - List all users (admin only)
app.get('/', async (c) => {
    const db = getDb();
    const allUsers = await db.select().from(users).all();
    return c.json({ users: allUsers });
});

const adminPatchUserSchema = z.object({
    role: z.string().optional(),
    active: z.boolean().optional(),
});

// PATCH /api/users/:id - Update any user (admin only)
app.patch('/:id', zValidator('json', adminPatchUserSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = getDb();

    const updated = await db.update(users)
        .set(body)
        .where(eq(users.id, id))
        .returning()
        .get();

    if (!updated) return c.json({ error: 'User not found' }, 404);

    return c.json({ user: updated });
});

export default app;
