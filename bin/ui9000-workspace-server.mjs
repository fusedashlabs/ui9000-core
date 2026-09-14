#!/usr/bin/env node
/**
 * Same path as `yarn workspace @ui9000/core start`: `tsx src/bin.ts`.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const entry = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
const child = spawn(process.execPath, [tsx, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
