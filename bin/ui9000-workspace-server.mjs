#!/usr/bin/env node
/**
 * Launches the compiled server. The published package does not run tsx.
 *
 * `@fusedashlabs/widgets/catalog` is the engine catalog (npm dist). npx
 * installs it. A local checkout needs `yarn build` in ui9000-widgets first.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function resolveWidgetsCatalog() {
  try {
    return fileURLToPath(import.meta.resolve('@fusedashlabs/widgets/catalog'));
  } catch {
    const sibling = fileURLToPath(
      new URL('../vendor/ui9000-widgets/dist/catalog/index.js', import.meta.url),
    );
    return existsSync(sibling) ? sibling : undefined;
  }
}

if (!resolveWidgetsCatalog()) {
  process.stderr.write(
    'ui9000-workspace-server needs @fusedashlabs/widgets with a built catalog.\n' +
      'npx installs it automatically. From this repo run: yarn build\n',
  );
  process.exit(1);
}

const entry = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
if (!existsSync(entry)) {
  process.stderr.write('ui9000-workspace-server is not built. Run: yarn build\n');
  process.exit(1);
}

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
