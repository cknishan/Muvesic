import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Discover nested modules automatically so new feature folders cannot bypass checks.
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await checkDirectory(file);
    else if (/\.m?js$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const folder of ['dist', 'scripts', 'tests']) {
  await checkDirectory(new URL('../' + folder + '/', import.meta.url));
}
console.log('All application, script and test modules passed syntax checks.');
