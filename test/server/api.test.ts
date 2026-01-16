import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import app from '../../server/src/app.js';
import { getDb } from '../../server/src/db/index.js';
import { layouts, users } from '../../server/src/db/schema.js';

describe('Basic API', () => {
    beforeAll(async () => {
        // Migrations handled in app/db initialization
    });

    test('GET /health returns ok', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.status).toBe('ok');
    });

    test('provision user on first request and handle ?user=', async () => {
        // Standard user
        const res = await app.request('/api/users/me?user=test@user.com');
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.user.email).toBe('test@user.com');

        const db = getDb();
        const user = await db.select().from(users).where(eq(users.email, 'test@user.com')).get();
        expect(user).toBeDefined();
        expect(user?.email).toBe('test@user.com');
    });

    test('RBAC: user can only see their own layouts', async () => {
        // Create layouts for two different users
        await app.request('/api/user/layouts?user=userA@test.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'User A Layout' }),
        });

        await app.request('/api/user/layouts?user=userB@test.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'User B Layout' }),
        });

        // User A should only see 1 layout
        const listA = await app.request('/api/user/layouts?user=userA@test.com');
        const bodyA = await listA.json() as any;
        expect(bodyA.layouts.length).toBe(1);
        expect(bodyA.layouts[0].name).toBe('User A Layout');

        // Admin should see both in the admin view
        const listAdmin = await app.request('/api/layouts?user=admin@local');
        const bodyAdmin = await listAdmin.json() as any;
        expect(bodyAdmin.layouts.length).toBeGreaterThanOrEqual(2);
    });

    test('Admin can manage users', async () => {
        // 1. Admin gets current list
        const res = await app.request('/api/users?user=admin@local');
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const testUser = body.users.find((u: any) => u.email === 'test@user.com');
        expect(testUser).toBeDefined();

        // 2. Admin deactivates user
        const deactivateRes = await app.request(`/api/users/${testUser.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false }),
        }, { user: 'admin@local' } as any);
        expect(deactivateRes.status).toBe(200);

        // 3. Deactivated user should be rejected (403 from AuthMiddleware)
        const meRes = await app.request('/api/users/me?user=test@user.com');
        expect(meRes.status).toBe(403);
    });

    test('POST /api/user/layouts/:id/images uploads file, serves it, and deletes it', async () => {
        // 1. Create a layout as a user
        const createRes = await app.request('/api/user/layouts?user=uploader@test.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Upload Test' }),
        });
        const createBody = await createRes.json() as any;
        const layoutId = createBody.layout.id;

        // 2. Upload an image
        const formData = new FormData();
        const blob = new Blob(['fake image data'], { type: 'image/jpeg' });
        formData.append('file', blob, 'test.jpg');
        formData.append('markers', JSON.stringify({ 'marker-1': { x: 10, y: 20, type: 'train' } }));

        const uploadRes = await app.request(`/api/user/layouts/${layoutId}/images?user=uploader@test.com`, {
            method: 'POST',
            body: formData,
        });
        expect(uploadRes.status).toBe(201);
        const uploadBody = await uploadRes.json() as any;
        const imageId = uploadBody.image.id;

        // 3. Verify in layout details
        const detailsRes = await app.request(`/api/user/layouts/${layoutId}?user=uploader@test.com`);
        const detailsBody = await detailsRes.json() as any;
        expect(detailsBody.layout.images.length).toBe(1);
        expect(detailsBody.layout.images[0].id).toBe(imageId);

        // 4. Serve the image
        const serveRes = await app.request(`/api/images/${imageId}?user=uploader@test.com`);
        expect(serveRes.status).toBe(200);

        // 5. Delete the image
        const deleteRes = await app.request(`/api/images/${imageId}?user=uploader@test.com`, {
            method: 'DELETE'
        });
        expect(deleteRes.status).toBe(200);
    });

    test('Local Role Overrides: ?roles=admin grants admin access', async () => {
        // userA@test.com is a regular user (not admin) but we override locally
        const res = await app.request('/api/layouts?user=userA@test.com&roles=admin');
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.layouts).toBeDefined();
    });

    test('Lenient Auth: public route works without user', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
    });
});

afterAll(async () => {
    console.log('[Test Teardown] Cleaning up test artifacts...');
});
