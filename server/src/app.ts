import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authMiddleware, type AuthUser } from './middleware/auth.js';
import { rbacMiddleware } from './middleware/rbac.js';
import { adminRoutes as adminLayoutRoutes, userRoutes as userLayoutRoutes } from './routes/layouts.js';
import layoutImageRoutes from './routes/layouts_images.js';
import imageRoutes from './routes/images.js';
import userRoutes from './routes/users.js';
import { HTTPException } from 'hono/http-exception';

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

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

app.get('/api/debug', (c) => {
  const headers: Record<string, string> = {};
  for (const [key, value] of c.req.raw.headers.entries()) {
      headers[key] = value;
  }
  return c.json({ headers });
});

// Serve public static assets
import { getStorage } from './services/storage.js';

app.get('/public/*', async (c) => {
    const path = c.req.path.replace(/^\/public\//, '');
    console.log(`[Storage] Fetching asset: ${path}`);
    const storage = getStorage(c);
    const res = await storage.get(c, path);
    
    // Add caching headers for assets
    res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res;
});

// Protect API routes only
app.use('/api/*', authMiddleware);
app.use('/api/*', rbacMiddleware);

// Mount sub-apps
app.route('/api/layouts', adminLayoutRoutes); 
app.route('/api/user/layouts', userLayoutRoutes); 
app.route('/api/user/layouts', layoutImageRoutes); 
app.route('/api/images', imageRoutes); 
app.route('/api/users', userRoutes); 

// Serve static assets from Cloudflare Pages as fallback
app.get('*', async (c) => {
    // Check if we are in Cloudflare env with ASSETS fetcher
    if ((c.env as any).ASSETS) {
        return await (c.env as any).ASSETS.fetch(c.req.raw);
    }
    return c.notFound();
});

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
