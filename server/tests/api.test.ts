import { describe, it, expect } from 'vitest';
import app from '../src/app';

describe('Basic API', () => {
    
    it('GET /health returns ok', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ status: 'ok', env: 'test' });
    });

    it('GET /api/layouts returns empty list', async () => {
        const res = await app.request('/api/layouts');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('layouts');
        expect(Array.isArray((body as any).layouts)).toBe(true);
    });
});
