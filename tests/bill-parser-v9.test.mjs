import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/assets/bill-parser-v9.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { parse } = sandbox.window.EconBillParserV9;

const octopusLike = `
BOLLETTA ENERGIA ELETTRICA
Intestatario fornitura: MARIO ROSSI
Indirizzo di fornitura: Via Esempio 14, 20100 Milano MI
POD IT001E16093073
Consumo annuo aggiornato 5.444 kWh
Spesa annua sostenuta € 1.639,21
Quota per consumi 569 kWh
Importo 112,42 €
Totale da pagare € 126,70
`;

const grittiLike = `
FATTURA ENERGIA ELETTRICA
I tuoi dati
ANNA BIANCHI
Indirizzo di fornitura: Via Test 6, 21056 Induno Olona VA
POD IT001E24256310
Consumi annui: 692 kWh
Spesa annua sostenuta: 375,86 €
Totale da pagare 50,00 €
`;

const periodOnly = `
BOLLETTA ENERGIA
POD IT001E12345678
Consumo del periodo 450 kWh
Totale da pagare € 112,55
`;

for (const fixture of [octopusLike, grittiLike]) {
  const parsed = parse(fixture);
  assert.equal(parsed.isBill, true);
  assert.ok(parsed.annualKwh.value > 0);
  assert.ok(parsed.annualSpend.value > 0);
  assert.ok(parsed.pod.value.startsWith('IT'));
  assert.ok(parsed.fullName.value.length > 4);
  assert.ok(parsed.fullAddress.value.length > 10);
}

const octopus = parse(octopusLike);
assert.equal(octopus.annualKwh.value, 5444);
assert.equal(octopus.annualSpend.value, 1639.21);
assert.equal(octopus.periodKwh.value, 0, 'unlabelled quota kWh must not become period consumption');
assert.equal(octopus.periodAmount.value, 126.7);
assert.equal(octopus.pod.value, 'IT001E16093073');
assert.equal(octopus.fullName.value, 'Mario Rossi');

const gritti = parse(grittiLike);
assert.equal(gritti.annualKwh.value, 692);
assert.equal(gritti.annualSpend.value, 375.86);
assert.equal(gritti.periodAmount.value, 50);
assert.equal(gritti.pod.value, 'IT001E24256310');
assert.equal(gritti.fullName.value, 'Anna Bianchi');

const period = parse(periodOnly);
assert.equal(period.annualKwh.value, 0, 'a period consumption must not be promoted to annual consumption');
assert.equal(period.annualSpend.value, 0, 'a period total must not be promoted to annual spend');
assert.equal(period.periodKwh.value, 450);
assert.equal(period.periodAmount.value, 112.55);

console.log('bill-parser-v9 tests passed');
