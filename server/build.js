import esbuild from 'esbuild';
import path from 'path';
import { mkdirSync } from 'fs';

const distDir = path.join(process.cwd(), 'dist');
mkdirSync(distDir, { recursive: true });

esbuild.build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: 'dist/_worker.js',
  platform: 'browser', // Cloudflare Workers are closer to browser than node
  format: 'esm',
  target: 'es2022',
  external: [
    'better-sqlite3',
    'fs',
    'path',
    'url',
    'crypto',
    'os',
    'stream',
    'events',
    'util'
  ],
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  minify: true,
  sourcemap: true,
}).catch(() => process.exit(1));
