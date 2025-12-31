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
});
