import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { getStorage } from '../services/storage.js';
import { images, layouts } from '../db/schema.js';
import type { AuthUser } from '../middleware/auth.js';
import { eq, and, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { MAX_IMAGES } from '../../../shared/config.js';

type Env = {
  Variables: {
    user: AuthUser;
  };
};

// Common upload logic
async function performUpload(c: any, layoutId: string, useForTraining: boolean = false) {
    const db = getDb(c);
    const body = await c.req.parseBody();
    const file = body['file'];
    const markersRaw = body['markers'] || body['labels'];

    if (!file) {
        console.error(`[Backend] Upload failed: No file found in request body for layout ${layoutId}`);
        throw new Error('No file uploaded');
    }
    
    if (!(file instanceof Blob) && typeof (file as any).arrayBuffer !== 'function') {
        console.error(`[Backend] Upload failed: Invalid file object type: ${typeof file} for layout ${layoutId}`);
        throw new Error(`Invalid file upload object: ${typeof file}`);
    }

    let markersJson = null;
    if (markersRaw && typeof markersRaw === 'string') {
        try {
            markersJson = JSON.parse(markersRaw);
        } catch (e) {
            console.warn("[Backend] Failed to parse markers during upload", e);
        }
    }

    const imageId = randomUUID();
    const filename = `${imageId}.jpg`;
    const buffer = await file.arrayBuffer();
    const storage = getStorage(c);
    await storage.put(c, filename, buffer, 'image/jpeg');

    const newImage = {
        id: imageId,
        layoutId: layoutId,
        markers: markersJson,
        useForTraining: useForTraining,
        createdAt: new Date()
    };
    await db.insert(images).values(newImage);
    return newImage;
}

// --- USER UPLOAD ROUTES (Scoped) ---
export const userUploadRoutes = new Hono<Env>();

userUploadRoutes.post('/:layoutId/images', async (c) => {
    const layoutId = c.req.param('layoutId');
    const user = c.var.user;
    const db = getDb(c);

    // Verify Ownership
    const layout = await db.select().from(layouts)
        .where(and(eq(layouts.id, layoutId), eq(layouts.userId, user.id)))
        .get();
        
    if (!layout) return c.json({ error: 'Layout not found or unauthorized' }, 404);
    
    try {
        // Enforce Limit
        const [{ count: currentCount }] = await db.select({ count: count() })
            .from(images)
            .where(eq(images.layoutId, layoutId))
            .all();

        if (currentCount >= MAX_IMAGES) {
            return c.json({ 
                error: 'Image limit reached', 
                message: `This layout has reached the maximum of ${MAX_IMAGES} images. Please delete an existing image to upload a new one.` 
            }, 403);
        }

        const newImage = await performUpload(c, layoutId, false); // Users cannot set training flag
        return c.json({ image: newImage }, 201);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

// --- ADMIN UPLOAD ROUTES (Direct) ---
export const adminUploadRoutes = new Hono<Env>();

adminUploadRoutes.post('/:layoutId/images', async (c) => {
    const layoutId = c.req.param('layoutId');
    const db = getDb(c);

    // Direct check (no userId filter)
    const layout = await db.select().from(layouts).where(eq(layouts.id, layoutId)).get();
    if (!layout) return c.json({ error: 'Layout not found' }, 404);

    const body = await c.req.parseBody();
    const useForTraining = body['useForTraining'] === 'true' || body['use_for_training'] === 'true';

    try {
        const newImage = await performUpload(c, layoutId, useForTraining);
        return c.json({ image: newImage }, 201);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});
