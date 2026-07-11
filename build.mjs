import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  external: ['onnxruntime-web', 'node:child_process', 'node:os', 'node:path', 'node:fs/promises', 'node:crypto'],
  target: 'es2020',
  platform: 'neutral',
  sourcemap: true,
};

await Promise.all([
  // ESM
  build({
    ...shared,
    outfile: 'dist/index.mjs',
    format: 'esm',
  }),
  // CJS
  build({
    ...shared,
    outfile: 'dist/index.cjs',
    format: 'cjs',
  }),
  // Worker ESM
  build({
    ...shared,
    entryPoints: ['src/worker.js'],
    outfile: 'dist/worker.mjs',
    format: 'esm',
  }),
  // Worker CJS
  build({
    ...shared,
    entryPoints: ['src/worker.js'],
    outfile: 'dist/worker.cjs',
    format: 'cjs',
  }),
]);

// Copy type declarations
copyFileSync('src/index.d.ts', 'dist/index.d.ts');

console.log('✓ Built dist/index.mjs, dist/index.cjs, dist/worker.mjs, dist/worker.cjs');
