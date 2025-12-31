import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { images, layouts } from '../db/schema.js';
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
const STORAGE_DIR = process.env.STORAGE_DIR || './data/images';

// Helper: Ensure storage dir exists
async function ensureDir() {
    await mkdir(STORAGE_DIR, { recursive: true });
}

// POST /api/layouts/:layoutId/images
app.post('/:layoutId/images', async (c) => {
    const layoutId = c.req.param('layoutId');
    const user = c.var.user;
    const db = getDb();
    
    // 1. Verify Layout Ownership
    const layout = await db.select().from(layouts).where(eq(layouts.id, layoutId)).get();
    if (!layout) return c.json({ error: 'Layout not found' }, 404);
    if (user.role !== 'admin' && layout.userId !== user.email) {
        return c.json({ error: 'Unauthorized' }, 403);
    }

    // 2. Parse Body (Multipart)
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
        return c.json({ error: 'No file uploaded' }, 400);
    }

    // 3. Save File Locally
    await ensureDir();
    const imageId = randomUUID();
    const extension = file.name.split('.').pop() || 'jpg';
    const filename = `${imageId}.${extension}`;
    const filePath = join(STORAGE_DIR, filename); // Flat structure for simple FS
    
    const buffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // 4. Save DB Record
    const newImage = {
        id: imageId,
        layoutId: layout.id,
        filename: file.name,
        width: 0, // Placeholder, real app would read metadata
        height: 0,
        createdAt: new Date()
    };
    await db.insert(images).values(newImage);

    return c.json({ image: newImage }, 201);
});

// GET /api/images/:id
// Note: This route is technically /api/layouts by mount point, but we want /api/images
// Let's implement /api/images as a separate router or handle here. 
// For clean structure, we'll expose a separate router for global /api/images access.
// BUT for this Phase, let's keep it simple. I'll create a dedicated images.ts route file.

export default app;
