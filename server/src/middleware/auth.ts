import { createMiddleware } from 'hono/factory';
import { env } from 'hono/adapter';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';

// Define the User identity interface available in Context
export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
}

// Extend Hono Variable definitions
type Env = {
  Bindings: {
    DB: any;
    ASSETS: any;
    ADMIN_EMAIL?: string;
  };
  Variables: {
    user: AuthUser;
  };
};

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const host = c.req.header('host') || '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0') || nodeEnv === 'test' || nodeEnv === 'development';
  
  // 1. Identity Extraction
  let email: string | undefined;
  let rolesOverride: string[] | undefined;

  // Cloudflare Access Header (Primary Production Signal)
  const cfEmail = c.req.header('cf-access-authenticated-user-email');

  if (cfEmail) {
    // Cloudflare Mode: Trust only the header. Ignore all params.
    email = cfEmail;
  } else if (isLocal) {
    // Local Mode: Allow developer overrides
    email = c.req.query('user') || 'admin@local';
    const rolesParam = c.req.query('roles');
    if (rolesParam) {
      rolesOverride = rolesParam.split(',').map(r => r.trim());
    }
  }

  // 2. Database Sync / Fetch
  if (email) {
    const db = getDb(c);
    let userRecord = await db.select().from(users).where(eq(users.email, email)).get();

    if (!userRecord) {
      // Auto-provision user on first visit
      const { ADMIN_EMAIL } = env(c);
      const newId = randomUUID();
      const adminEmail = ADMIN_EMAIL || process.env.ADMIN_EMAIL;
      const isAdmin = (adminEmail && email === adminEmail) || email === 'admin@local';
      
      userRecord = await db.insert(users).values({
        id: newId,
        email: email,
        role: isAdmin ? 'admin,user' : 'user',
        active: true,
      }).returning().get();
      console.log(`[Auth] Created new user: ${email} (${userRecord.id}) [Role: ${userRecord.role}]`);
    }

    // Status Check
    if (!userRecord.active) {
      throw new HTTPException(403, { message: 'Account deactivated' });
    }

    // Update last login
    await db.update(users).set({ loginAt: new Date() }).where(eq(users.id, userRecord.id));

    // 3. Set Context
    // Priority: Query param (Local only) > Database
    const finalRoles = rolesOverride || (userRecord.role || 'user').split(',').map((r: string) => r.trim());

    c.set('user', {
      id: userRecord.id,
      email: userRecord.email,
      roles: finalRoles,
    });
  }

  // Lenient Auth: We proceed even if no user found. 
  // RBAC middleware will decide if the route is public or blocked.
  await next();
});
