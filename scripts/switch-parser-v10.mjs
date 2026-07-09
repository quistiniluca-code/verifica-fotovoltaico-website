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
await import('./add-report-ready-cta.mjs');

html = await readFile(indexPath, 'utf8');
const ctaStyle = '<link rel="stylesheet" href="assets/report-ready.css">';
if (!html.includes(ctaStyle)) html = html.replace('</head>', `${ctaStyle}\n</head>`);

const firstManualCta = 'Non hai la bolletta? <strong>Continua con i dati manuali</strong><span aria-hidden="true">↓</span>';
const clearerManualCta = 'Non hai la bolletta? <strong>Inserisci i dati annuali</strong><span aria-hidden="true">↓</span>';
if (html.includes(firstManualCta)) html = html.replace(firstManualCta, clearerManualCta);

html = html.replace(
  '<h3>Non hai la bolletta? Inserisci i dati manuali</h3>',
  '<h3>Dati annuali dell’immobile</h3>'
);
html = html.replace(
  '<h3>Inserisci i dati manuali</h3>',
  '<h3>Dati annuali dell’immobile</h3>'
);

await writeFile(indexPath, html);
console.log('ECON parser v10, report CTA and simplified manual route enabled in build output.');
