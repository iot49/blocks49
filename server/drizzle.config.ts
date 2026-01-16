import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_URL || './../local/server/data.db', // Use data.db in root of local/server dir by default
  },
} satisfies Config;
