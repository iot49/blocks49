import esbuild from 'esbuild';
import path from 'path';
import { mkdirSync } from 'fs';

const distDir = path.join(process.cwd(), 'dist');
mkdirSync(distDir, { recursive: true });

await esbuild.build({
  entryPoints: ['src/worker.ts'],
  bundle: true,
  outfile: 'dist/_worker.js',
  platform: 'browser',
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
});
console.log('Build complete: dist/_worker.js');
