import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dbModule from '../../server/src/db/index.js';

describe('Server Smoke Test', () => {
    let app: any;

    beforeEach(async () => {
        // Mock DB before importing app to avoid initialization errors
        const mockDb = {
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            get: vi.fn(),
            all: vi.fn(),
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            returning: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            values: vi.fn().mockReturnThis(),
            run: vi.fn()
        };
        vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb);

        // Dynamic import to test boot-time logic
        const appModule = await import('../../server/src/app.js');
        app = appModule.default;
    });

    it('should boot and respond to health check', async () => {
        const res = await app.request('http://localhost/health');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
    });

    it('should have all routes correctly initialized', async () => {
        // This test ensures that the route imports (which caused the SyntaxError)
        // are actually executed and resolved.
        expect(app).toBeDefined();
        expect(app.routes).toBeDefined();
        
        // Check for presence of some key routes
        const paths = app.routes.map((r: any) => r.path);
        expect(paths).toContain('/api/user/layouts');
        expect(paths).toContain('/api/images/:id');
    });

    it('should boot successfully using tsx', async () => {
        // This confirms that the server can boot in a real tsx environment
        // catch ESM resolution issues that Vitest might bypass.
        const { execSync } = await import('child_process');
        try {
            const output = execSync('npx tsx src/boot-check.ts', { 
                cwd: '.', 
                encoding: 'utf8'
            });
            expect(output).toContain('Server boot check PASSED');
        } catch (e: any) {
            console.error('TSX Boot check failed:', e.stdout || e.message);
            throw e;
        }
    });
});
