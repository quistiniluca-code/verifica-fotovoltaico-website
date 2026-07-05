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
await writeFile(appPath, app);

console.log('ECON home-aligned copy and split-address flow completed.');
