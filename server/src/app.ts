import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authMiddleware, type AuthUser } from './middleware/auth.js';

// Define the environment for Hono to include our user variable
type Bindings = {
    // Add KV or D1 bindings here if needed
}

type Variables = {
    user: AuthUser
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>();

app.use('*', logger());

app.get('/health', (c) => {
  return c.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

import layoutRoutes from './routes/layouts.js';

// Protect API routes
app.use('/api/*', authMiddleware);

// Mount sub-apps
app.route('/api/layouts', layoutRoutes);


export default app;
