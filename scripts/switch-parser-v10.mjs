import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const indexPath = join(root, '..', 'dist', 'index.html');
let html = await readFile(indexPath, 'utf8');
const oldTag = '<script defer src="assets/bill-parser-v9.js"></script>';
const newTag = '<script defer src="assets/bill-parser-v10.js"></script>';
if (!html.includes(oldTag)) throw new Error('Parser switch: v9 parser script marker not found.');
html = html.replace(oldTag, newTag);
await writeFile(indexPath, html);
console.log('ECON parser v10 enabled in build output.');
