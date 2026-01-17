import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authMiddleware, type AuthUser } from './middleware/auth.js';
import { rbacMiddleware } from './middleware/rbac.js';
import { adminRoutes as adminLayoutRoutes, userRoutes as userLayoutRoutes } from './routes/layouts.js';
import layoutImageRoutes from './routes/layouts_images.js';
import imageRoutes from './routes/images.js';
import userRoutes from './routes/users.js';
import { HTTPException } from 'hono/http-exception';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'path';

// Define the environment for Hono to include our user variable
type Bindings = {
    DB: D1Database;
    IMAGES: R2Bucket;
    ADMIN_EMAIL?: string;
}

type Variables = {
    user: AuthUser
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>();

app.use('*', logger());

app.get('/health', (c) => {
  return c.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

// Serve public static assets
// In production (Cloudflare), these might be served by Pages directly,
// but we need them here for local dev and consistency.
app.use('/public/models/*', serveStatic({ 
    root: './',
    rewriteRequestPath: (p) => p.replace(/^\/public/, '') 
}));
app.use('/public/favicon.ico', serveStatic({ path: './ui/public/favicon.ico' }));

// Protect API routes
app.use('*', authMiddleware);
app.use('*', rbacMiddleware);

// Mount sub-apps
app.route('/api/layouts', adminLayoutRoutes); 
app.route('/api/user/layouts', userLayoutRoutes); 
app.route('/api/user/layouts', layoutImageRoutes); 
app.route('/api/images', imageRoutes); 
app.route('/api/users', userRoutes); 

// Global Error Handler
app.onError((err, c) => {
  console.error(`[App Error] ${err.message}`);
  // Respect HTTPException status
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err.stack);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;
