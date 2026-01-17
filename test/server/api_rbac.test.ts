import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { rules } from '../../server/src/middleware/rules.js';
import { rbacMiddleware } from '../../server/src/middleware/rbac.js';

describe('RBAC Middleware', () => {
    let app: Hono<any>;

    beforeEach(() => {
        app = new Hono().basePath('/api');
        
        // Mock user context setter
        app.use('*', async (c, next) => {
            // Tests can set headers to simulate roles if we had logic to extract them here,
            // but for unit testing the middleware, we often inject the user directly into context
            // OR we rely on the specific test case setup.
            // Here, we'll let the test helper set the context variable directly if possible?
            // Actually, Hono middleware flow is easiest tested by just making requests 
            // and letting a mock auth middleware run before RBAC.
            await next();
        });

        // Mock Auth Middleware (sets user based on header)
        app.use('*', async (c, next) => {
            const roleHeader = c.req.header('x-role');
            if (roleHeader) {
                const roles = roleHeader.split(',');
                c.set('user', { id: 'test', email: 'test@example.com', roles });
            }
            await next();
        });

        app.use('*', rbacMiddleware);

        // Define routes matching the rules.ts
        // Public
        app.get('/health', (c) => c.text('ok'));
        app.get('/debug', (c) => c.text('ok'));
        
        // Users
        app.get('/users/me', (c) => c.text('ok'));
        app.patch('/users/me', (c) => c.text('ok'));
        
        // User Layouts
        app.get('/user/layouts', (c) => c.text('ok'));
        app.post('/user/layouts', (c) => c.text('ok'));
        app.get('/user/layouts/:id', (c) => c.text('ok'));
        app.patch('/user/layouts/:id', (c) => c.text('ok'));
        app.delete('/user/layouts/:id', (c) => c.text('ok'));
        
        // User Images
        app.post('/user/layouts/:id/images', (c) => c.text('ok'));
        app.get('/images/:id', (c) => c.text('ok'));
        app.patch('/images/:id', (c) => c.text('ok'));
        app.delete('/images/:id', (c) => c.text('ok'));

        // Admin
        app.get('/users', (c) => c.text('ok'));
        app.patch('/users/:id', (c) => c.text('ok'));
        app.get('/layouts', (c) => c.text('ok'));
        app.get('/layouts/:id', (c) => c.text('ok'));
    });

    const request = async (path: string, method: string = 'GET', role?: string) => {
        const headers: Record<string, string> = {};
        if (role) headers['x-role'] = role;
        
        const res = await app.request(`http://localhost/api${path}`, {
            method,
            headers
        });
        return res;
    };

    it('should allow public access to /api/health', async () => {
        const res = await request('/health', 'GET');
        expect(res.status).toBe(200);
    });

    it('should allow public access to /api/debug', async () => {
        const res = await request('/debug', 'GET');
        expect(res.status).toBe(200);
    });

    it('should deny unauthenticated access to /api/users/me', async () => {
        const res = await request('/users/me', 'GET');
        expect(res.status).toBe(401); // Unauthorized (no user)
    });

    it('should allow user access to /api/users/me', async () => {
        const res = await request('/users/me', 'GET', 'user');
        expect(res.status).toBe(200);
    });

    it('should allow admin access to /api/users/me', async () => {
        const res = await request('/users/me', 'GET', 'admin');
        expect(res.status).toBe(200);
    });

    it('should deny user access to /api/users (admin only)', async () => {
        const res = await request('/users', 'GET', 'user');
        expect(res.status).toBe(403); // Forbidden
    });

    it('should allow admin access to /api/users', async () => {
        const res = await request('/users', 'GET', 'admin');
        expect(res.status).toBe(200);
    });

    it('should allow user access to /api/user/layouts', async () => {
        const res = await request('/user/layouts', 'GET', 'user');
        expect(res.status).toBe(200);
    });
    
    it('should allow user create layout', async () => {
        const res = await request('/user/layouts', 'POST', 'user');
        expect(res.status).toBe(200);
    });

    it('should allow user update layout image', async () => {
        const res = await request('/images/123', 'PATCH', 'user');
        expect(res.status).toBe(200);
    });

    it('should deny public access to unknown route (implicit)', async () => {
         // If we added a route not in rules, it should default to deny or throw?
         // Our middleware throws 403 if no rule found.
         app.get('/random', (c) => c.text('ok'));
         const res = await request('/random', 'GET');
         expect(res.status).toBe(403);
    });

    it('should handle complex patterns correctly', async () => {
        // Test sub-resource
        const res = await request('/user/layouts/123/images', 'POST', 'user');
        expect(res.status).toBe(200);
    });
});
