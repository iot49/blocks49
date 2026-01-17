import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { getStorage } from '../services/storage.js';
import { images, layouts, users } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// Extend Hono environment
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();

// POST /api/user/layouts/:layoutId/images
// Ownership is enforced by Scoped Layout Lookup
app.post('/:layoutId/images', async (c) => {
    const layoutId = c.req.param('layoutId');
    const user = c.var.user;
    const db = getDb(c);
    const isAdmin = user.roles.includes('admin');
    
    // 1. Verify Layout Scoped Existence
    const filters = [eq(layouts.id, layoutId)];
    
    // Scoping for non-admins
    if (!isAdmin) {
        filters.push(eq(layouts.userId, user.id));
    }

    const layout = await db.select().from(layouts).where(and(...filters)).get();
    if (!layout) return c.json({ error: 'Layout not found or unauthorized' }, 404);

    // 2. Parse Body (Multipart)
    const body = await c.req.parseBody();
    const file = body['file'];
    const markersRaw = body['markers'] || body['labels'];

    if (!file || !(file instanceof File)) {
        return c.json({ error: 'No file uploaded' }, 400);
    }

    let markersJson = null;
    if (markersRaw && typeof markersRaw === 'string') {
        try {
            markersJson = JSON.parse(markersRaw);
        } catch (e) {
            console.warn("[Backend] Failed to parse markers during upload", e);
        }
    }

    // 3. Save File
    const imageId = randomUUID();
    const filename = `${imageId}.jpg`;
    
    const buffer = await file.arrayBuffer();
    const storage = getStorage(c);
    await storage.put(c, filename, buffer, 'image/jpeg');

    // 4. Save DB Record
    const newImage = {
        id: imageId,
        layoutId: layout.id,
        markers: markersJson,
        createdAt: new Date()
    };
    await db.insert(images).values(newImage);

    return c.json({ image: newImage }, 201);
});

export default app;
