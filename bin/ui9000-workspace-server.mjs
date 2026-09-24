#!/usr/bin/env node
/**
 * Same path as `yarn workspace @fusedashlabs/ui9000-workspace start`: `tsx src/bin.ts`.
 *
 * `@fusedashlabs/widgets/catalog` is the engine catalog (npm dist). Vite's
 * `import.meta.glob` is not available under tsx, so an unbuilt widgets
 * checkout cannot start. npx resolves the published widgets package.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function resolveWidgetsCatalog() {
  try {
    return fileURLToPath(import.meta.resolve('@fusedashlabs/widgets/catalog'));
  } catch {
    const sibling = join(
      fileURLToPath(new URL('../vendor/ui9000-widgets/dist/catalog/index.js', import.meta.url)),
    );
    return existsSync(sibling) ? sibling : undefined;
  }
}

if (!resolveWidgetsCatalog()) {
  process.stderr.write(
    'ui9000-workspace-server needs @fusedashlabs/widgets with a built catalog.\n' +
      'npx installs it automatically. From this monorepo run: yarn build\n',
  );
  process.exit(1);
}

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
