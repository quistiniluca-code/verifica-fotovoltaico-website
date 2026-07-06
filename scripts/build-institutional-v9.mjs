import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, '..');
const publicDir = join(projectRoot, 'public');
const distDir = join(projectRoot, 'dist');

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) {
    if (source.includes(to)) return source;
    console.warn(`Build v9: marker skipped for ${label}`);
    return source;
  }
  return source.replace(from, to);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(publicDir, distDir, { recursive: true });

const appPath = join(distDir, 'assets', 'app.js');
let app = await readFile(appPath, 'utf8');

const v9ParserHook = `function extractBillData(text){
  const parsedByV9 = window.EconBillParserV9?.parse ? window.EconBillParserV9.parse(text) : null;
  if(parsedByV9?.isBill){
    const annualKwh = Number(parsedByV9.annualKwh?.value || 0);
    const annualSpend = Number(parsedByV9.annualSpend?.value || 0);
    const periodKwh = Number(parsedByV9.periodKwh?.value || 0);
    const periodAmount = Number(parsedByV9.periodAmount?.value || 0);
    const pod = String(parsedByV9.pod?.value || '');
    const fullName = String(parsedByV9.fullName?.value || '');
    const fullAddress = String(parsedByV9.fullAddress?.value || '');
    const nameConfidence = Number(parsedByV9.fullName?.confidence || 0);
    const addressConfidence = Number(parsedByV9.fullAddress?.confidence || 0);
    return {
      kwh: annualKwh || periodKwh,
      kwhScope: annualKwh ? 'annuo' : (periodKwh ? 'periodo_fattura' : 'non_disponibile'),
      amount: periodAmount || annualSpend || 0,
      annualKwh,
      annualSpend,
      periodKwh,
      periodAmount,
      pod,
      text: parsedByV9.text || '',
      confidence: Math.min(100, Number(parsedByV9.annualKwh?.confidence || 0) + Number(parsedByV9.annualSpend?.confidence || 0) + Number(parsedByV9.pod?.confidence || 0)),
      billScore: Number(parsedByV9.billSignal || 0),
      isBill: true,
      user: { fullName, fullAddress, nameConfidence, addressConfidence, city: '', cityConfidence: 0 },
      source: parsedByV9.source || 'local_parser_v9'
    };
  }`;
app = replaceOnce(app, 'function extractBillData(text){', v9ParserHook, 'structured bill parser hook');

const oldAutofill = `  if(data.user.fullName && data.user.nameConfidence >= 90 && !els.iname.value.trim()){
    els.iname.value = data.user.fullName;
    filled.push('nome e cognome');
  }`;
const newAutofill = `  if(data.user.fullName && data.user.nameConfidence >= 85 && !els.iname.value.trim()){
    els.iname.value = data.user.fullName;
    filled.push('nome e cognome');
  }
  if(data.user.fullAddress && data.user.addressConfidence >= 90 && !els.iaddress.value.trim()){
    els.iaddress.value = data.user.fullAddress;
    filled.push('indirizzo completo');
  }`;
app = replaceOnce(app, oldAutofill, newAutofill, 'bill autofill');

const oldResolve = `function resolveReportInputs(data){
  const declared = manualEnergyData();
  const explicitAnnual = data && !data.fallback && data.kwhScope === 'annuo' && data.kwh >= 300;
  const annualKwh = explicitAnnual
    ? Math.round(data.kwh)
    : (declared.annualKwh || annualizeKwh(Number(data?.kwh || 0), data));
  const annualSpend = declared.annualSpend
    || (annualKwh ? Math.max(annualKwh * 0.34, Number(data?.amount || 0) * 6) : Math.max(0, Number(data?.amount || 0)));
  const monthlySpend = annualSpend ? Math.max(1, Math.round(annualSpend / 12)) : 0;
  return {
    annualKwh,
    annualSpend,
    monthlySpend,
    hasEnergyBasis: annualKwh >= 300 && annualSpend >= 50,
    energySource: explicitAnnual
      ? 'consumo annuo letto in bolletta + spesa annua dichiarata'
      : (declared.valid ? 'consumo e spesa annui dichiarati' : (annualKwh ? 'consumo del periodo letto in bolletta' : 'dati annuali da completare'))
  };
}`;
const newResolve = `function resolveReportInputs(data){
  const declared = manualEnergyData();
  const parsedAnnualKwh = Number(data?.annualKwh || 0);
  const parsedAnnualSpend = Number(data?.annualSpend || 0);
  const explicitAnnual = data && !data.fallback && (parsedAnnualKwh >= 300 || (data.kwhScope === 'annuo' && data.kwh >= 300));
  const annualKwh = explicitAnnual
    ? Math.round(parsedAnnualKwh || data.kwh)
    : (declared.annualKwh || annualizeKwh(Number(data?.kwh || 0), data));
  const annualSpend = declared.annualSpend || parsedAnnualSpend;
  const monthlySpend = annualSpend ? Math.max(1, Math.round(annualSpend / 12)) : 0;
  const spendSource = declared.annualSpend
    ? 'spesa annua dichiarata'
    : (parsedAnnualSpend ? 'spesa annua letta in bolletta' : 'spesa annua da completare');
  return {
    annualKwh,
    annualSpend,
    monthlySpend,
    hasEnergyBasis: annualKwh >= 300 && annualSpend >= 50,
    hasAnnualKwh: annualKwh >= 300,
    hasTrustedAnnualSpend: annualSpend >= 50,
    spendSource,
    energySource: explicitAnnual
      ? (parsedAnnualSpend ? 'consumo e spesa annui letti in bolletta' : 'consumo annuo letto in bolletta; spesa da completare')
      : (declared.valid ? 'consumo e spesa annui dichiarati' : (annualKwh ? 'consumo del periodo letto in bolletta' : 'dati annuali da completare'))
  };
}`;
app = replaceOnce(app, oldResolve, newResolve, 'annual report inputs');

app = replaceOnce(app, '    fullAddress: els.iaddress.value.trim(),', "    fullAddress: (billOnly ? (user.fullAddress || els.iaddress.value.trim()) : els.iaddress.value.trim()),", 'bill address payload');
app = replaceOnce(app, "    energy: { annualKwh: manualEnergyData().annualKwh, annualSpend: manualEnergyData().annualSpend },", `    energy: {
      annualKwh: billOnly ? (Number(parsed.annualKwh || (parsed.kwhScope === 'annuo' ? parsed.kwh : 0)) || manualEnergyData().annualKwh) : manualEnergyData().annualKwh,
      annualSpend: billOnly ? (Number(parsed.annualSpend || 0) || manualEnergyData().annualSpend) : manualEnergyData().annualSpend
    },`, 'annual energy payload');
app = replaceOnce(app, "      amount: Number(parsed.amount || 0),\n      pod: parsed.pod || '',", `      amount: Number(parsed.amount || 0),
      annualKwh: Number(parsed.annualKwh || (parsed.kwhScope === 'annuo' ? parsed.kwh : 0)),
      annualSpend: Number(parsed.annualSpend || 0),
      periodKwh: Number(parsed.periodKwh || (parsed.kwhScope === 'periodo_fattura' ? parsed.kwh : 0)),
      periodAmount: Number(parsed.periodAmount || 0),
      pod: parsed.pod || '',`, 'structured document payload');
app = replaceOnce(app, "      extractedCity: user.city || ''", "      extractedCity: user.city || '',\n      fullAddress: user.fullAddress || ''", 'bill address payload metadata');

app = replaceOnce(app, "    amount: Number(parsed?.amount || 0),\n    pod: parsed?.pod || '',", `    amount: Number(parsed?.amount || 0),
    annualKwh: Number(parsed?.annualKwh || (parsed?.kwhScope === 'annuo' ? parsed?.kwh : 0)),
    annualSpend: Number(parsed?.annualSpend || 0),
    periodKwh: Number(parsed?.periodKwh || (parsed?.kwhScope === 'periodo_fattura' ? parsed?.kwh : 0)),
    periodAmount: Number(parsed?.periodAmount || 0),
    pod: parsed?.pod || '',`, 'structured document assessment');

app = replaceOnce(app, "  const address = els.iaddress.value.trim() || parsed.user?.city || '--';", "  const address = els.iaddress.value.trim() || parsed.user?.fullAddress || parsed.user?.city || '--';", 'whatsapp full address');
app = replaceOnce(app, "  setHelp('Richiesta acquisita. Stiamo elaborando il report preliminare.', true);", "  setHelp('Stiamo preparando l’analisi e confermando l’invio della richiesta.', true);", 'delivery confirmation wording');

app = replaceOnce(app, "  const annualSpend = Math.max(metrics.annualSpend || 0, monthlySpend * 12, annualKwh * 0.34);", "  const annualSpend = Math.max(metrics.annualSpend || 0, monthlySpend * 12);", 'avoid automatic report spend inflation');
app = replaceOnce(app, "  els.title.textContent = high ? 'Scenario FV ad alto potenziale' : (mid ? 'Scenario FV con potenziale elevato' : 'Potenziale da valorizzare');", "  els.title.textContent = 'Scenario preliminare da verificare';", 'institutional report title');
app = replaceOnce(app, "  els.badge.textContent = unreadableDocument ? 'Documento da riprovare' : (high ? 'Priorità alta' : (mid ? 'Da approfondire' : 'Segnale utile'));", "  els.badge.textContent = unreadableDocument ? 'Documento da riprovare' : (high ? 'Verifica prioritaria' : (mid ? 'Da approfondire' : 'Analisi preliminare'));", 'institutional report badge');
app = replaceOnce(app, "  els.readOut.textContent = scope + ': ' + num(annualKwh) + ' kWh/anno · spesa dichiarata: ' + eur(annualSpend) + '/anno' + (data.pod ? ' · POD rilevato' : '');", "  els.readOut.textContent = scope + ': ' + num(annualKwh) + ' kWh/anno · ' + metrics.spendSource + ': ' + eur(annualSpend) + '/anno' + (data.pod ? ' · POD rilevato' : '');", 'report data transparency');
app = replaceOnce(app, "  els.desireTitle.textContent = unreadableDocument ? 'Riprova con una bolletta leggibile per affinare il report.' : (high ? 'Questo profilo può valorizzare davvero il tetto disponibile.' : 'Qui c’è margine per aumentare autonomia e autoconsumo.');", "  els.desireTitle.textContent = unreadableDocument ? 'Riprova con una bolletta leggibile per affinare l’analisi.' : 'Il prossimo passaggio è verificare il tetto.';", 'next step title');
app = replaceOnce(app, "  els.desireCopy.textContent = unreadableDocument\n    ? 'Il file selezionato non sembra una bolletta elettrica leggibile: carica il documento integrale, nitido e con consumi visibili.'\n    : (ocrTimedOut ? 'La lettura automatica non si è conclusa in tempo: ECON completerà la verifica del documento.' : 'Questo è uno scenario opportunità: ECON lo valida su tetto, profilo orario, accumulo e ottimizzazione della fornitura.');", "  els.desireCopy.textContent = unreadableDocument\n    ? 'Il file selezionato non sembra una bolletta elettrica leggibile: carica il documento integrale, nitido e con consumi visibili.'\n    : (ocrTimedOut ? 'La lettura automatica non si è conclusa in tempo: ECON completerà la verifica del documento.' : 'Esposizione, ombreggiamenti, superficie utile, connessione e profilo di consumo rendono lo scenario realmente decidibile.');", 'report method copy');
app = replaceOnce(app, "  els.potential.textContent = 'Fino a ' + power(scenario.plant) + ' kWp + ' + power(scenario.battery) + ' kWh';", "  els.potential.textContent = 'Fino a ' + power(scenario.plant) + ' kWp + ' + power(scenario.battery) + ' kWh';", 'keep system sizing');
app = replaceOnce(app, "  els.potentialCopy.textContent = 'Scenario opportunità: più produzione e accumulo per valorizzare il tetto, da verificare tecnicamente.';", "  els.potentialCopy.textContent = 'Configurazione preliminare da verificare su superficie utile, esposizione, ombreggiamenti e connessione.';", 'report system caveat');
app = replaceOnce(app, "  els.autoCopy.textContent = 'Autoconsumo potenziale fino a ' + selfConsumption + '% con accumulo e profilo di utilizzo favorevole.';", "  els.autoCopy.textContent = 'Autonomia potenziale: dipende da produzione, accumulo e profilo di utilizzo; richiede validazione oraria.';", 'report autonomy caveat');
app = replaceOnce(app, "  els.saveOut.textContent = 'Fino a ' + eur(combined);", "  els.saveOut.textContent = 'Indicativo: ' + eur(combined);", 'report value label');
app = replaceOnce(app, "  els.saveCopy.textContent = 'Scenario opportunità FV + accumulo + fornitura: da validare su profilo orario e tetto.';", "  els.saveCopy.textContent = 'Valore energetico indicativo: non è un risparmio garantito né una proposta definitiva.';", 'report value caveat');
app = replaceOnce(app, "  els.supplyOut.textContent = 'Margine extra con fornitura energia';", "  els.supplyOut.textContent = 'Fornitura e configurazione';", 'report supply label');
app = replaceOnce(app, "  els.supplyCopy.textContent = 'Completa il progetto FV dopo la verifica tecnica.';", "  els.supplyCopy.textContent = 'ECON verifica anche l’eventuale ottimizzazione della fornitura nel sistema energia complessivo.';", 'report supply copy');
app = replaceOnce(app, "    ? 'Scenario opportunità annuo FV + accumulo + ottimizzazione fornitura: fino a ' + eur(combined)", "    ? 'Scenario preliminare annuo FV + accumulo + configurazione fornitura: valore indicativo fino a ' + eur(combined)", 'hidden report wording');
app = replaceOnce(app, "    ? (data?.fallback ? 'Scenario opportunità preliminare' : 'Bolletta letta — scenario opportunità') + ' — base: ' + source + ' — ' + num(annualKwh) + ' kWh/anno · ' + eur(annualSpend) + '/anno — scenario ' + els.hKwp.value", "    ? (data?.fallback ? 'Scenario preliminare' : 'Bolletta letta — scenario preliminare') + ' — base: ' + source + ' — ' + num(annualKwh) + ' kWh/anno · ' + eur(annualSpend) + '/anno — configurazione ' + els.hKwp.value", 'hidden report tone');

await writeFile(appPath, app);

const cssPath = join(distDir, 'assets', 'styles.css');
let css = await readFile(cssPath, 'utf8');
css = css.replace("--font:'Plus Jakarta Sans',system-ui,sans-serif", "--font:'Arimo',Arial,sans-serif");
css += `\n/* v9 institutional refinements */\n.contact-block.bill-first-ready{display:none}\n.report .card-label,.report .readline small{letter-spacing:.07em}\n@media (prefers-reduced-motion:reduce){.upload::before,.processing::before,.procBar span::after{animation:none!important}}\n`;
await writeFile(cssPath, css);

const htmlPath = join(distDir, 'index.html');
let html = await readFile(htmlPath, 'utf8');
html = replaceOnce(html, '<title>ECON | Report preliminare energetico istantaneo</title>', '<title>ECON | Analisi preliminare energetica</title>', 'page title');
html = replaceOnce(html, '<meta name="description" content="Carica la bolletta e ottieni un report preliminare ECON su fotovoltaico, accumulo e fornitura. In alternativa, inserisci i dati manuali.">', '<meta name="description" content="Carica la bolletta o inserisci i dati annuali: ECON prepara una prima analisi di consumi, tetto, fotovoltaico, accumulo e margine di autonomia.">', 'page description');
html = replaceOnce(html, 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap', 'https://fonts.googleapis.com/css2?family=Arimo:wght@400;500;600;700&display=swap', 'brand font');
html = replaceOnce(html, '<div class="eyebrow"><span class="dot"></span> Analisi bolletta gratuita</div>', '<div class="eyebrow"><span class="dot"></span> Analisi preliminare energetica</div>', 'hero eyebrow');
html = replaceOnce(html, '<h1><span class="titleDeep">Fotovoltaico.</span><br><span class="titleLime">Più autonomia</span>, <span class="titleDeep">meno dipendenza.</span></h1>', '<h1><span class="titleDeep">Capire quanto può evolvere</span><br><span class="titleLime">il tuo sistema energia.</span></h1>', 'hero title');
html = replaceOnce(html, '<p class="lead">Carica la bolletta: ECON legge i dati e genera un report di <span class="energyWord">INTELLIGENZA ENERGETICA<sup>™</sup></span> su produzione, accumulo, autoconsumo e valore economico potenziale.</p>', '<p class="lead">Carica la bolletta o inserisci i dati annuali: ECON prepara una prima lettura di consumi, tetto, fotovoltaico, accumulo e margine di autonomia.</p>', 'hero lead');
html = replaceOnce(html, '<div class="note"><b>Metodo ECON:</b> prima si valuta il potenziale energetico. Poi si ottimizza il resto.</div>', '<div class="note"><b>Metodo ECON:</b> una valutazione preliminare, non un preventivo automatico. Prima si leggono dati e immobile; poi si verifica la fattibilità reale.</div>', 'hero method');
html = replaceOnce(html, '<h2>Report preliminare</h2>', '<h2>Analisi preliminare</h2>', 'panel title');
html = replaceOnce(html, '<p class="sub">Dati essenziali → scenario di opportunità → valore energetico potenziale.</p>', '<p class="sub">Bolletta o dati annuali → scenario da verificare → prossimo passo coerente.</p>', 'panel subheading');
html = replaceOnce(html, '<strong>Carica la tua bolletta</strong><em>PDF o foto — leggiamo consumi, importi e POD. Se il documento è leggibile, puoi generare il report senza compilare i dati manuali.</em>', '<strong>Analizza la mia bolletta</strong><em>PDF o foto — individuiamo consumo annuo, spesa annua, POD e punto di fornitura. Se il documento è leggibile, puoi proseguire senza compilare i dati manuali.</em>', 'upload message');
html = replaceOnce(html, '<script defer src="assets/app.js"></script>', '<script defer src="assets/bill-parser-v9.js"></script>\n<script defer src="assets/app.js"></script>', 'parser script');
await writeFile(htmlPath, html);

console.log('ECON institutional v9 build completed.');
