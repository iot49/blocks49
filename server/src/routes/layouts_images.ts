import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { images, layouts, users } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';

// Extend Hono environment
type Env = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<Env>();

// Local Storage Path (Docker Volume)
const projectRoot = new URL('../../../', import.meta.url).pathname;
const STORAGE_DIR = process.env.STORAGE_DIR || join(projectRoot, 'local/server/data/images');

// Helper: Ensure storage dir exists
async function ensureDir() {
    await mkdir(STORAGE_DIR, { recursive: true });
}

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

// POST /api/layouts/:layoutId/images
app.post('/:layoutId/images', async (c) => {
    const layoutId = c.req.param('layoutId');
    const user = c.var.user;
    const db = getDb();
    
    // 1. Verify Layout Ownership
    const layout = await db.select().from(layouts).where(eq(layouts.id, layoutId)).get();
    if (!layout) return c.json({ error: 'Layout not found' }, 404);
    
    if (user.role !== 'admin') {
        const userId = await ensureUserId(user.email);
        if (layout.userId !== userId) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    }

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
            console.log(`[Backend] Parsed markers for layout ${layoutId}:`, JSON.stringify(markersJson));
        } catch (e) {
            console.warn("[Backend] Failed to parse markers during upload", e);
        }
    }

    // 3. Save File Locally (Forcing .jpg as requested)
    await ensureDir();
    const imageId = randomUUID();
    const filename = `${imageId}.jpg`;
    const filePath = join(STORAGE_DIR, filename); // Flat structure for simple FS
    
    const buffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // 4. Save DB Record (Removing filename field)
    const newImage = {
        id: imageId,
        layoutId: layout.id,
        markers: markersJson,
        createdAt: new Date()
    };
    console.log(`[Backend] Saving image ${imageId} to DB with markers.`);
    await db.insert(images).values(newImage);

    return c.json({ image: newImage }, 201);
});

// GET /api/images/:id
// Note: This route is technically /api/layouts by mount point, but we want /api/images
// Let's implement /api/images as a separate router or handle here. 
// For clean structure, we'll expose a separate router for global /api/images access.
// BUT for this Phase, let's keep it simple. I'll create a dedicated images.ts route file.

export default app;
