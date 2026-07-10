import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const indexPath = join(root, '..', 'dist', 'index.html');
let html = await readFile(indexPath, 'utf8');

const tag = '<script defer src="assets/analytics-minimal-v1.js"></script>';
if (!html.includes(tag)) {
  html = html.replace('</body>', `${tag}\n</body>`);
}

await writeFile(indexPath, html);
console.log('ECON minimal GA4 tracking enabled in build output.');
