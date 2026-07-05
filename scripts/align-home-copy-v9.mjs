import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, '..');
const distDir = join(projectRoot, 'dist');

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Home alignment: marker not found for ${label}`);
  return source.replace(from, to);
}

function replaceSegment(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Home alignment: start marker not found for ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Home alignment: end marker not found for ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const htmlPath = join(distDir, 'index.html');
let html = await readFile(htmlPath, 'utf8');

html = replaceOnce(html,
  '<link rel="stylesheet" href="assets/styles.css">',
  '<link rel="stylesheet" href="assets/styles.css">\n<link rel="stylesheet" href="assets/institutional-v9.css">',
  'institutional stylesheet'
);
html = replaceOnce(html,
  '<div class="eyebrow"><span class="dot"></span> Analisi preliminare energetica</div>',
  '<div class="eyebrow"><span class="dot"></span> Analisi consumi e fornitura</div>',
  'hero eyebrow'
);
html = replaceOnce(html,
  '<h1><span class="titleDeep">Capire quanto può evolvere</span><br><span class="titleLime">il tuo sistema energia.</span></h1>',
  '<h1><span class="titleDeep">Fotovoltaico.</span><br><span class="titleLime">Più autonomia</span>, <span class="titleDeep">meno dipendenza.</span></h1>',
  'hero title'
);
html = replaceOnce(html,
  '<p class="lead">Carica la bolletta o inserisci i dati annuali: ECON prepara una prima lettura di consumi, tetto, fotovoltaico, accumulo e margine di autonomia.</p>',
  '<p class="lead">Carica la bolletta: ottieni una lettura chiara del tuo <span class="energyWord">Sistema Energia</span>, con focus su produzione, accumulo, fornitura energia e margine economico da verificare.</p>',
  'hero lead'
);
html = replaceOnce(html,
  '<div class="note"><b>Metodo ECON:</b> una valutazione preliminare, non un preventivo automatico. Prima si leggono dati e immobile; poi si verifica la fattibilità reale.</div>',
  '<div class="note"><b>Metodo ECON:</b> prima si valuta il potenziale energetico. Poi si ottimizza il resto, verificando copertura, consumi e fattibilità reale.</div>',
  'hero method'
);
html = replaceOnce(html,
  '<h2>Analisi preliminare</h2>',
  '<h2>Analisi del tuo impianto</h2>',
  'panel heading'
);
html = replaceOnce(html,
  '<p class="sub">Bolletta o dati annuali → scenario da verificare → prossimo passo coerente.</p>',
  '<p class="sub">Bolletta → potenziale energetico → valore da verificare.</p>',
  'panel subheading'
);
html = replaceOnce(html,
  '<strong>Analizza la mia bolletta</strong><em>PDF o foto — individuiamo consumo annuo, spesa annua, POD e punto di fornitura. Se il documento è leggibile, puoi proseguire senza compilare i dati manuali.</em>',
  '<strong>Carica la bolletta</strong><em>PDF o foto — leggiamo consumo annuo, spesa annua e POD. Se il documento è leggibile, l’analisi prosegue senza form manuale.</em>',
  'upload copy'
);
html = replaceOnce(html,
  '<button class="manual-route" id="manualRoute" type="button">Non hai la bolletta? <strong>Continua con i dati manuali</strong><span aria-hidden="true">↓</span></button>',
  '<button class="manual-route" id="manualRoute" type="button" aria-expanded="false">Non hai la bolletta? <strong>Inserisci i dati annuali</strong><span aria-hidden="true">↓</span><span class="manual-route-copy" id="manualRouteHint">Inserisci i dati solo se non hai la bolletta.</span></button>',
  'manual route'
);
html = replaceOnce(html,
  '<div class="contact-block" id="contactBlock">',
  '<div class="contact-block" id="contactBlock" hidden>',
  'collapsed manual block'
);
html = replaceOnce(html,
  '<div class="data-kicker">Alternativa senza bolletta</div>\n          <h3>Non hai la bolletta? Inserisci i dati manuali</h3>\n          <p>Questa sezione serve solo in alternativa all’upload: inserisci indirizzo, consumi annuali e spesa annua per creare una prima lettura tecnica del tetto.</p>',
  '<div class="data-kicker">Percorso alternativo</div>\n          <h3>Inserisci i dati annuali dell’immobile</h3>\n          <p>Usa questo percorso solo se non hai la bolletta. Ti chiediamo i dati essenziali per impostare una prima analisi di consumi, copertura e sistema energia.</p>',
  'manual heading'
);
html = replaceOnce(html,
  '<div class="roof-address-focus" id="roofAddressFocus">\n            <div class="roof-address-head"><span class="roof-address-kicker">Priorità: verifica tetto</span><span class="roof-address-badge">Indirizzo obbligatorio</span></div>\n            <div class="field field--full"><label for="iaddress">Indirizzo completo dell’immobile</label><input id="iaddress" name="indirizzo_completo" autocomplete="street-address" required aria-required="true" placeholder="Via, numero civico, CAP e Comune"></div>\n            <p class="roof-address-copy"><strong>L’indirizzo completo è essenziale:</strong> ci consente di verificare posizione, esposizione, ombreggiamenti e superficie disponibile, evitando una simulazione generica.</p>\n          </div>',
  '<div class="roof-address-focus" id="roofAddressFocus">\n            <div class="roof-address-head"><span class="roof-address-kicker">Priorità: verifica tetto</span><span class="roof-address-badge">Indirizzo obbligatorio</span></div>\n            <div class="address-grid">\n              <div class="field"><label for="iProvince">Provincia</label><input id="iProvince" name="provincia" autocomplete="address-level1" placeholder="es. Bergamo (BG)"></div>\n              <div class="field"><label for="iComune">Comune</label><input id="iComune" name="comune" autocomplete="address-level2" placeholder="es. Bergamo"></div>\n            </div>\n            <div class="address-grid address-grid--street">\n              <div class="field"><label for="iVia">Via / piazza</label><input id="iVia" name="via" autocomplete="street-address" placeholder="es. Via Roma"></div>\n              <div class="field"><label for="iCivico">Civico</label><input id="iCivico" name="civico" inputmode="text" autocomplete="address-line2" placeholder="es. 12"></div>\n            </div>\n            <input id="iaddress" name="indirizzo_completo" required aria-required="true" tabindex="-1" autocomplete="off">\n            <p class="address-helper"><strong>Perché li chiediamo separati:</strong> consentono una verifica più affidabile di posizione, esposizione, ombreggiamenti e superficie utile.</p>\n          </div>',
  'split address fields'
);
html = replaceOnce(html,
  '<script defer src="assets/bill-parser-v9.js"></script>\n<script defer src="assets/app.js"></script>',
  '<script defer src="assets/bill-parser-v9.js"></script>\n<script defer src="assets/app.js"></script>\n<script defer src="assets/address-components-v9.js"></script>',
  'address script'
);
await writeFile(htmlPath, html);

const appPath = join(distDir, 'assets', 'app.js');
let app = await readFile(appPath, 'utf8');
app = replaceOnce(app,
  "else if(!isCompleteAddress(address)) setHelp('Inserisci l’indirizzo completo: via, civico, CAP e Comune.', false);",
  "else if(!isCompleteAddress(address)) setHelp('Completa provincia, comune, via e civico per verificare correttamente il tetto.', false);",
  'structured address validation copy'
);
app = replaceOnce(app,
  "try { els.iaddress.focus({preventScroll:true}); } catch(error) { els.iaddress.focus(); }",
  "const addressFocus = document.getElementById('iProvince') || els.iaddress;\n      try { addressFocus.focus({preventScroll:true}); } catch(error) { addressFocus.focus(); }",
  'structured address focus'
);

const activeParserAdapter = `function extractBillData(text){
  const parser = window.EconBillParserV9;
  if(!parser || typeof parser.parse !== 'function'){
    return {kwh:0, kwhScope:'non_disponibile', amount:0, annualKwh:0, annualSpend:0, periodKwh:0, periodAmount:0, pod:'', confidence:0, billScore:0, isBill:false, user:{fullName:'', city:'', nameConfidence:0, cityConfidence:0}, fullAddress:'', source:'parser_non_disponibile', text:''};
  }
  const parsed = parser.parse(text);
  const annualKwh = Number(parsed?.annualKwh?.value || 0);
  const annualSpend = Number(parsed?.annualSpend?.value || 0);
  const periodKwh = Number(parsed?.periodKwh?.value || 0);
  const periodAmount = Number(parsed?.periodAmount?.value || 0);
  const fullAddress = String(parsed?.fullAddress?.value || '').trim();
  const cityMatch = fullAddress.match(/\\b\\d{5}\\b\\s+([^,(]+?)(?:\\s*\\([A-Z]{2}\\)|\\s+[A-Z]{2})$/i);
  const city = cityMatch ? titleCase(String(cityMatch[1] || '').trim()) : '';
  const confidence = Math.round((Number(parsed?.annualKwh?.confidence || 0) + Number(parsed?.annualSpend?.confidence || 0) + Number(parsed?.pod?.confidence || 0) + Number(parsed?.fullAddress?.confidence || 0)) / 4);
  return {
    kwh: annualKwh || periodKwh || 0,
    kwhScope: annualKwh ? 'annuo' : (periodKwh ? 'periodo_fattura' : 'non_disponibile'),
    amount: periodAmount || 0,
    annualKwh,
    annualSpend,
    periodKwh,
    periodAmount,
    pod: String(parsed?.pod?.value || ''),
    confidence,
    billScore: Number(parsed?.billSignal || 0),
    isBill: !!parsed?.isBill,
    user: {
      fullName: String(parsed?.fullName?.value || ''),
      city,
      nameConfidence: Number(parsed?.fullName?.confidence || 0),
      cityConfidence: fullAddress ? Number(parsed?.fullAddress?.confidence || 0) : 0
    },
    fullAddress,
    source: String(parsed?.source || 'local_parser_v10'),
    text: String(parsed?.text || '')
  };
}
`;
app = replaceSegment(app, 'function extractBillData(text){', '\nasync function waitForGlobal', activeParserAdapter, 'single active structured parser');

const reportInputResolver = `function resolveReportInputs(data){
  const declared = manualEnergyData();
  const parsedAnnualKwh = data && !data.fallback ? Number(data.annualKwh || 0) : 0;
  const parsedAnnualSpend = data && !data.fallback ? Number(data.annualSpend || 0) : 0;
  const annualKwh = declared.annualKwh || (parsedAnnualKwh >= 300 ? Math.round(parsedAnnualKwh) : 0);
  const annualSpend = declared.annualSpend || (parsedAnnualSpend >= 50 ? parsedAnnualSpend : 0);
  const monthlySpend = annualSpend ? Math.max(1, Math.round(annualSpend / 12)) : 0;
  return {
    annualKwh,
    annualSpend,
    monthlySpend,
    hasEnergyBasis: annualKwh >= 300,
    hasEconomicBasis: annualSpend >= 50,
    energySource: declared.valid
      ? 'consumo e spesa annui dichiarati'
      : (parsedAnnualKwh >= 300
        ? (parsedAnnualSpend >= 50 ? 'consumo e spesa annui letti in bolletta' : 'consumo annuo letto in bolletta; spesa annua da validare')
        : 'dati annuali da completare')
  };
}
`;
app = replaceSegment(app, 'function resolveReportInputs(data){', '\n/*\n  Scenario opportunità ECON', reportInputResolver, 'annual data resolver');

app = replaceOnce(app,
  "const annualSpend = Math.max(metrics.annualSpend || 0, monthlySpend * 12, annualKwh * 0.34);\n  const scenario = estimateSystem(annualKwh);\n  const auto = autonomy(scenario.plant);\n  const selfConsumption = selfConsumptionPotential(scenario.plant, scenario.battery);\n  const combined = estimateAnnualValue(annualSpend);\n  const high = annualKwh >= 4200 || monthlySpend >= 125;\n  const mid = annualKwh >= 2200 || monthlySpend >= 70;",
  "const hasEconomicBasis = metrics.hasEconomicBasis;\n  const annualSpend = hasEconomicBasis ? metrics.annualSpend : 0;\n  const scenario = estimateSystem(annualKwh);\n  const auto = autonomy(scenario.plant);\n  const selfConsumption = selfConsumptionPotential(scenario.plant, scenario.battery);\n  const combined = hasEconomicBasis ? estimateAnnualValue(annualSpend) : 0;\n  const high = annualKwh >= 4200 || (hasEconomicBasis && monthlySpend >= 125);\n  const mid = annualKwh >= 2200 || (hasEconomicBasis && monthlySpend >= 70);",
  'no annual spend fabrication'
);
app = replaceOnce(app,
  "els.readOut.textContent = scope + ': ' + num(annualKwh) + ' kWh/anno · spesa dichiarata: ' + eur(annualSpend) + '/anno' + (data.pod ? ' · POD rilevato' : '');",
  "els.readOut.textContent = scope + ': ' + num(annualKwh) + ' kWh/anno' + (hasEconomicBasis ? ' · spesa annua letta: ' + eur(annualSpend) : ' · spesa annua da validare') + (data.pod ? ' · POD rilevato' : '');",
  'transparent readout'
);
app = replaceOnce(app,
  "els.saveOut.textContent = 'Fino a ' + eur(combined);\n  els.saveCopy.textContent = 'Scenario opportunità FV + accumulo + fornitura: da validare su profilo orario e tetto.';",
  "els.saveOut.textContent = hasEconomicBasis ? 'Fino a ' + eur(combined) : 'Da validare';\n  els.saveCopy.textContent = hasEconomicBasis ? 'Scenario preliminare FV + accumulo + fornitura: da validare su profilo orario e tetto.' : 'La bolletta non espone una spesa annua affidabile: ECON la verifica prima di stimare un valore economico.';",
  'economic report gate'
);
app = replaceOnce(app,
  "els.hAmount.value = hasEnergyBasis ? String(Math.round(annualSpend / 12)) : '';\n  if(els.hAnnualSpend) els.hAnnualSpend.value = hasEnergyBasis ? String(Math.round(annualSpend)) : '';",
  "els.hAmount.value = hasEnergyBasis && annualSpend >= 50 ? String(Math.round(annualSpend / 12)) : '';\n  if(els.hAnnualSpend) els.hAnnualSpend.value = hasEnergyBasis && annualSpend >= 50 ? String(Math.round(annualSpend)) : '';",
  'hidden annual spend gate'
);
app = replaceOnce(app,
  "els.hOptimization.value = hasEnergyBasis\n    ? 'Scenario opportunità annuo FV + accumulo + ottimizzazione fornitura: fino a ' + eur(combined)\n    : 'Stima economica da completare dopo verifica bolletta o consumi.';",
  "els.hOptimization.value = hasEnergyBasis && annualSpend >= 50\n    ? 'Scenario preliminare annuo FV + accumulo + ottimizzazione fornitura: fino a ' + eur(combined)\n    : 'Stima economica da completare dopo verifica bolletta o consumi.';",
  'hidden economic gate'
);
app = replaceOnce(app,
  "fullAddress: els.iaddress.value.trim(),\n    energy: { annualKwh: manualEnergyData().annualKwh, annualSpend: manualEnergyData().annualSpend },",
  "fullAddress: (billOnly ? (parsed.fullAddress || els.iaddress.value.trim()) : els.iaddress.value.trim()),\n    energy: billOnly\n      ? { annualKwh: Number(parsed.annualKwh || 0), annualSpend: Number(parsed.annualSpend || 0) }\n      : { annualKwh: manualEnergyData().annualKwh, annualSpend: manualEnergyData().annualSpend },",
  'bill-only structured contact fields'
);
app = replaceOnce(app,
  "amount: Number(parsed.amount || 0),\n      pod: parsed.pod || '',\n      confidence: Number(parsed.confidence || 0),\n      extractedName: user.fullName || '',\n      extractedCity: user.city || ''",
  "amount: Number(parsed.amount || 0),\n      annualKwh: Number(parsed.annualKwh || 0),\n      annualSpend: Number(parsed.annualSpend || 0),\n      periodKwh: Number(parsed.periodKwh || 0),\n      periodAmount: Number(parsed.periodAmount || 0),\n      pod: parsed.pod || '',\n      confidence: Number(parsed.confidence || 0),\n      extractedName: user.fullName || '',\n      fullAddress: parsed.fullAddress || ''",
  'structured document payload'
);

await writeFile(appPath, app);
console.log('ECON v10 source-of-truth parser, annual-value guardrails and address flow completed.');
