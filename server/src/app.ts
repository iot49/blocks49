import { Hono } from 'hono';
import { logger } from 'hono/logger';

const app = new Hono();

app.use('*', logger());

app.get('/health', (c) => {
  return c.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

// Partial stub for layouts
app.get('/api/layouts', (c) => {
  return c.json({ layouts: [] });
});

export default app;
