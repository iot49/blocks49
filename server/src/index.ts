import { serve } from '@hono/node-server';
import app from './app.js';
import * as dotenv from 'dotenv';
import { setNodeDb } from './db/index.js';
import { getSqliteDb } from './db/sqlite.js';

dotenv.config();

// Initialize Local DB for Node.js
setNodeDb(getSqliteDb());

const port = Number(process.env.PORT) || 3000;

console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});
