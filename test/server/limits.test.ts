import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import { userRoutes } from '../../server/src/routes/layouts.js';
import { userUploadRoutes } from '../../server/src/routes/layouts_images.js';
import * as dbModule from '../../server/src/db/index.js';
import { MAX_LAYOUTS, MAX_IMAGES } from '../../shared/config.js';

describe('Resource Limits', () => {
    let app: Hono<any>;
    let mockDb: any;

    beforeEach(() => {
        app = new Hono();
        
        // Mock user context
        app.use('*', async (c: Context, next: Next) => {
            c.set('user', { id: 'test-user', email: 'test@example.com', roles: ['user'] });
            await next();
        });

        app.route('/layouts', userRoutes);
        app.route('/uploads', userUploadRoutes);

        // Mock DB
        mockDb = {
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            get: vi.fn(),
            insert: vi.fn().mockReturnThis(),
            values: vi.fn().mockReturnThis(),
            run: vi.fn(),
            all: vi.fn()
        };

        vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb);
    });

    describe('Layout Limits', () => {
        it('should allow creating a layout when under the limit', async () => {
            // Mock count to return 0
            mockDb.all.mockResolvedValueOnce([{ count: 0 }]);
            // Mock successful insertion
            mockDb.get.mockResolvedValueOnce({ id: 'new-layout' });

            const res = await app.request('/layouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Test Layout', scale: 'HO' })
            });

            expect(res.status).toBe(201);
        });

        it('should deny creating a layout when at the limit', async () => {
            // Mock count to return MAX_LAYOUTS
            mockDb.all.mockResolvedValueOnce([{ count: MAX_LAYOUTS }]);

            const res = await app.request('/layouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Test Layout', scale: 'HO' })
            });

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error).toBe('Layout limit reached');
        });
    });

    describe('Image Limits', () => {
        it('should allow uploading an image when under the limit', async () => {
            // 1. Mock verify ownership (layout lookup)
            mockDb.get.mockResolvedValueOnce({ id: 'layout-1', userId: 'test-user' });
            // 2. Mock image count lookup
            mockDb.all.mockResolvedValueOnce([{ count: 0 }]);
            
            const formData = new FormData();
            formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

            const res = await app.request('/uploads/layout-1/images', {
                method: 'POST',
                body: formData
            });

            expect(res.status).toBe(201);
        });

        it('should deny uploading an image when at the limit', async () => {
            // 1. Mock verify ownership
            mockDb.get.mockResolvedValueOnce({ id: 'layout-1', userId: 'test-user' });
            // 2. Mock image count lookup = MAX_IMAGES
            mockDb.all.mockResolvedValueOnce([{ count: MAX_IMAGES }]);

            const formData = new FormData();
            formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

            const res = await app.request('/uploads/layout-1/images', {
                method: 'POST',
                body: formData
            });

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error).toBe('Image limit reached');
        });
    });
});
