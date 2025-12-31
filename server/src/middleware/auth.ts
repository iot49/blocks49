import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

// Define the User identity interface available in Context
export interface AuthUser {
  email: string;
  role: 'admin' | 'user';
}

// Extend Hono Variable definitions
type Env = {
  Variables: {
    user: AuthUser;
  };
};

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const env = process.env.NODE_ENV || 'development';

  // 1. Local / Offline Mode
  // If explicitly in 'local' mode (Docker/Dev), bypass auth and act as Admin
  if (env === 'local' || env === 'test') {
    c.set('user', {
      email: 'admin@local',
      role: 'admin',
    });
    await next();
    return;
  }

  // 2. Production (Cloudflare Access)
  // Look for the specific header
  const jwt = c.req.header('CF-Access-Jwt-Assertion');
  
  if (!jwt) {
    // For now, if no header in non-local, return 401. 
    // In real deployment, Cloudflare Gateway intercepts this before we see it, 
    // but good to have a check.
    throw new HTTPException(401, { message: 'Unauthorized: Missing Auth Header' });
  }

  // TODO: Verify JWT signature using Cloudflare certs (jwks)
  // For this scaffold, we purely decode the email from the token or look for another header
  // Cloudflare also sends 'Cf-Access-Authenticated-User-Email' if configured.
  const email = c.req.header('cf-access-authenticated-user-email') || 'unknown@user';
  
  c.set('user', {
    email,
    role: 'user', // Default to user, real implementation might query DB for role
  });

  await next();
});
