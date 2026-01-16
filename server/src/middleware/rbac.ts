import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AuthUser } from './auth.js';

interface RbacRule {
    method: string;
    pattern: string;
    role: string;
}

let rules: RbacRule[] = [];

/**
 * EXPLANATION:
 * This middleware matches the current request against rules defined in `auth.csv`.
 * It is the ONLY place where route-pattern matching occurs to determine required roles.
 * Ownership enforcement is NOT handled here; it is delegated to the database query logic
 * in the route handlers themselves (Scoped Queries).
 */

function loadRules() {
    const csvPath = join(process.cwd(), '../auth.csv');
    if (!existsSync(csvPath)) {
        console.warn(`[RBAC] auth.csv not found at ${csvPath}. Defaulting to deny-all.`);
        return;
    }

    const content = readFileSync(csvPath, 'utf8');
    rules = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
            const [method, pattern, role] = line.split(',').map(s => s.trim().toLowerCase());
            return { method, pattern, role };
        });
    console.log(`[RBAC] Loaded ${rules.length} rules from auth.csv`);
}

function patternToRegex(pattern: string): RegExp {
    // 1. Escape all regex special characters EXCEPT *
    // . + ? ^ $ { } ( ) | [ ] \ 
    let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    
    // 2. Convert glob stars to regex
    // We use temporary markers to avoid double-replacement (order matters: check ** first)
    regexStr = regexStr.replace(/\*\*/g, '___DSTAR___');
    regexStr = regexStr.replace(/\*/g, '[^/]+');
    regexStr = regexStr.replace(/___DSTAR___/g, '.*');
    
    return new RegExp(`^${regexStr}$`);
}

export const rbacMiddleware = createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
    if (rules.length === 0) loadRules();

    const path = c.req.path.toLowerCase();
    const method = c.req.method.toLowerCase();
    const user = c.get('user');
    const userRoles = user?.roles || ['public'];

    // Find the first matching rule from auth.csv
    const rule = rules.find(r => {
        const isMethodMatch = r.method === 'all' || r.method === method;
        const normalizedPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
        const normalizedPattern = r.pattern.endsWith('/') && r.pattern.length > 1 ? r.pattern.slice(0, -1) : r.pattern;
        return isMethodMatch && patternToRegex(normalizedPattern).test(normalizedPath);
    });

    if (!rule) {
        console.warn(`[RBAC] No rule found for ${method} ${path}. User roles: ${userRoles.join(',')}. Denying.`);
        throw new HTTPException(403, { message: 'Forbidden: No access rule defined' });
    }

    const requiredRole = rule.role;
    console.log(`[RBAC] ${method} ${path} matched rule ${rule.pattern} (Required: ${requiredRole})`);

    // 1. Public Access
    if (requiredRole === 'public') {
        await next();
        return;
    }

    // No user identified for protected route
    if (!user) {
        throw new HTTPException(401, { message: 'Unauthorized: User identity required' });
    }

    // 2. Role Check
    // Admin bypasses all checks. Others must have the exact role.
    if (!userRoles.includes(requiredRole) && !userRoles.includes('admin')) {
        throw new HTTPException(403, { message: `Forbidden: Role ${requiredRole} required` });
    }

    await next();
});
