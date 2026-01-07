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
    return newId;
}

// GET /api/users/me - Get Current User data
app.get('/me', async (c) => {
    const authUser = c.var.user;
    const db = getDb();
    
    let user = await db.select().from(users).where(eq(users.email, authUser.email)).get();
    
    if (!user) {
        const id = await ensureUserId(authUser.email);
        user = await db.select().from(users).where(eq(users.id, id)).get();
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

    const userId = await ensureUserId(authUser.email);

    const updated = await db.update(users)
        .set(body)
        .where(eq(users.id, userId))
        .returning()
        .get();

    return c.json({ user: updated });
});

export default app;
