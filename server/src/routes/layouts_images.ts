import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { images, layouts, users } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
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

// POST /api/user/layouts/:layoutId/images
// Ownership is enforced by Scoped Layout Lookup
app.post('/:layoutId/images', async (c) => {
    const layoutId = c.req.param('layoutId');
    const user = c.var.user;
    const db = getDb();
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

    // 3. Save File Locally
    await ensureDir();
    const imageId = randomUUID();
    const filename = `${imageId}.jpg`;
    const filePath = join(STORAGE_DIR, filename); 
    
    const buffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

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
