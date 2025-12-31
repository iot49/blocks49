import { describe, it, expect, beforeAll } from 'vitest';
import app from '../src/app';
import { getDb } from '../src/db/index';
import { users } from '../src/db/schema';

describe('Basic API', () => {

    beforeAll(async () => {
        // Seed the admin user used by the mocked auth middleware
        const db = getDb();
        await db.insert(users).values({
            id: 'admin@local', 
            email: 'admin@local',
            role: 'admin'
        }).onConflictDoNothing();
    });
    
    it('GET /health returns ok', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ status: 'ok', env: 'test' });
    });

    it('POST /api/layouts creates and GET retrieves', async () => {
        // 1. Create
        const createRes = await app.request('/api/layouts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'New Layout', scale: 'N' })
        });
        expect(createRes.status).toBe(201);
        const createBody = await createRes.json();
        expect(createBody).toHaveProperty('layout');
        const newId = (createBody as any).layout.id;

        // 2. List
        const listRes = await app.request('/api/layouts');
        const listBody = await listRes.json();
        expect((listBody as any).layouts.length).toBeGreaterThan(0);
        
        // 3. Get Single
        const getRes = await app.request(`/api/layouts/${newId}`);
        const getBody = await getRes.json();
        expect((getBody as any).layout.name).toBe('New Layout');
    });

    it('POST /api/layouts/:id/images uploads file with labels', async () => {
        // 1. Create Layout first
        const createRes = await app.request('/api/layouts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Layout for Images', scale: 'N' })
        });
        const layoutId = (await createRes.json() as any).layout.id;

        // 2. Upload Image with Labels
        const formData = new FormData();
        const fileContent = new Blob(['fake-image-content'], { type: 'text/plain' });
        const labels = { "marker-1": { x: 10, y: 20, type: "train" } };
        
        formData.append('file', fileContent, 'test.txt');
        formData.append('labels', JSON.stringify(labels));
        
        const req = new Request(`http://localhost/api/layouts/${layoutId}/images`, {
            method: 'POST',
            body: formData,
        });

        const uploadRes = await app.fetch(req); 
        expect(uploadRes.status).toBe(201);
        
        const uploadBody = await uploadRes.json();
        const imageId = (uploadBody as any).image.id;
        expect(imageId).toBeDefined();

        // 3. Retrieve Layout and Verify Labels
        const getLayoutRes = await app.request(`/api/layouts/${layoutId}`);
        const getLayoutBody = await getLayoutRes.json();
        const apiImage = (getLayoutBody as any).layout.images.find((img: any) => img.id === imageId);
        expect(apiImage).toBeDefined();
        expect(apiImage.labels).toEqual(labels);

        // 4. Retrieve Raw Image Content
        const getRes = await app.request(`/api/images/${imageId}`);
        expect(getRes.status).toBe(200);
        const text = await getRes.text();
        expect(text).toBe('fake-image-content');
    });
});
