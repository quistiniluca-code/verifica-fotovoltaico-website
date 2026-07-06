import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const appPath = join(root, '..', 'dist', 'assets', 'app.js');

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Annual-value guard: marker not found for ${label}`);
  return source.replace(from, to);
}

let app = await readFile(appPath, 'utf8');

// Native PDFs are cheap to read as text. Six pages cover the supplied formats where
// annual spend is placed after the summary page (for example, on historical-data page 5).
app = replaceOnce(
  app,
  'for(let pageNo = 1; pageNo <= Math.min(pdf.numPages, 4); pageNo++){',
  'for(let pageNo = 1; pageNo <= Math.min(pdf.numPages, 6); pageNo++){',
  'native PDF page coverage'
);

// Never create a commercial value from a consumption coefficient when the bill does not state annual spend.
app = replaceOnce(
  app,
  '  const inferredAnnualSpend = annualKwh ? Math.round(annualKwh * 0.34 * 100) / 100 : 0;',
  '  const inferredAnnualSpend = 0;',
  'remove inferred annual spend'
);
app = replaceOnce(
  app,
  ": (parsedAnnualSpend ? 'spesa annua letta in bolletta' : 'spesa indicativa da validare');",
  ": (parsedAnnualSpend ? 'spesa annua letta in bolletta' : 'spesa annua non disponibile');",
  'spend source transparency'
);

await writeFile(appPath, app);
console.log('ECON annual-spend guard and native PDF coverage completed.');
