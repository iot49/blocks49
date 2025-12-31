import { describe, it, expect } from 'vitest';
import app from '../src/app';

describe('Basic API', () => {
    
    it('GET /health returns ok', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ status: 'ok', env: 'test' });
    });

    it('GET /api/layouts returns authorized stub', async () => {
        const res = await app.request('/api/layouts');
        expect(res.status).toBe(200);
        const body = await res.json();
        
        // In 'test' env, middleware should inject admin@local
        expect(body).toHaveProperty('message', 'Hello admin@local');
        expect(body).toHaveProperty('role', 'admin');
        expect(Array.isArray((body as any).layouts)).toBe(true);
    });
});
