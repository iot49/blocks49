import { serve } from '@hono/node-server';
import app from './app.js';
import * as dotenv from 'dotenv';

dotenv.config();

const port = Number(process.env.PORT) || 3000;

console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});
