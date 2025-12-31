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

// Protect API routes
app.use('/api/*', authMiddleware);

// Stub for layouts with user info
app.get('/api/layouts', (c) => {
  const user = c.var.user;
  return c.json({ 
      message: `Hello ${user.email}`,
      role: user.role,
      layouts: [] 
  });
});

export default app;
