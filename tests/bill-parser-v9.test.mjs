import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/assets/bill-parser-v10.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { parse } = sandbox.window.EconBillParserV9;

const labelledAnnual = parse(`
FATTURA ENERGIA ELETTRICA
Intestatario: CLIENTE TEST
Indirizzo di fornitura: Via Esempio 8, 20100 Milano MI
POD IT001E12345678
Consumo totale fatturato del periodo: 123,45 kWh
Consumo annuo aggiornato al seguente periodo: dal 01.01.2025 al 31.12.2025 1.234,56 kWh
Totale spesa annua dal 01.01.2025 al 31.12.2025: 987,65 €
Totale da pagare 150,00 €
`);

assert.equal(labelledAnnual.isBill, true);
assert.equal(labelledAnnual.annualKwh.value, 1235);
assert.equal(labelledAnnual.annualSpend.value, 987.65);
assert.equal(labelledAnnual.periodKwh.value, 123);
assert.equal(labelledAnnual.periodAmount.value, 150);
assert.equal(labelledAnnual.pod.value, 'IT001E12345678');
assert.notEqual(labelledAnnual.annualSpend.value, labelledAnnual.periodAmount.value);

const flatPdfJs = parse('BOLLETTA LUCE I tuoi dati CLIENTE TEST Indirizzo di fornitura: Via Prova 9, 24000 Bergamo BG Consumo annuo 01/01/2025 - 31/12/2025 5.119,42 kWh Spesa annua sostenuta: 2.968,02 € CODICE POD IT001E87654321 TOTALE DA PAGARE 215,00 €');
assert.equal(flatPdfJs.annualKwh.value, 5119);
assert.equal(flatPdfJs.annualSpend.value, 2968.02);
assert.equal(flatPdfJs.periodAmount.value, 215);

const noAnnualSpend = parse('BOLLETTA LUCE Contratto intestato a: CLIENTE TEST Via Esempio 2 23800 Lecco LC Consumo totale fatturato del periodo 2566 kWh In un anno hai consumato 10.000 kWh POD IT001E11423744 Totale da pagare 595,49 €');
assert.equal(noAnnualSpend.annualKwh.value, 10000);
assert.equal(noAnnualSpend.annualSpend.value, 0);
assert.equal(noAnnualSpend.periodKwh.value, 2566);
assert.equal(noAnnualSpend.periodAmount.value, 595.49);

console.log('bill-parser-v10 regression tests passed');
