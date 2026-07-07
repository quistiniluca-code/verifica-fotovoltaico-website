import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, '..', 'dist');
const indexPath = join(dist, 'index.html');
const appPath = join(dist, 'assets', 'app.js');

function requireMarker(source, marker, label) {
  if (!source.includes(marker)) throw new Error(`Contact capture: marker not found for ${label}`);
  return source;
}

function stripRequired(html, id) {
  const pattern = new RegExp(`(<input id="${id}"[^>]*?) required aria-required="true"([^>]*>)`);
  return html.replace(pattern, '$1$2');
}

let html = await readFile(indexPath, 'utf8');
const app = await readFile(appPath, 'utf8');

const contactCard = `
          <section class="contact-capture" aria-label="Contatti per ricevere il report">
            <div class="contact-capture-head"><span class="contact-capture-kicker">I tuoi contatti</span><small>Per inviarti il report e ricontattarti.</small></div>
            <div class="contact-capture-grid">
              <div class="field"><label for="iphone">Cellulare</label><input id="iphone" name="telefono" autocomplete="tel" inputmode="tel" required aria-required="true" placeholder=" "></div>
              <div class="field"><label for="iemail">Email</label><input id="iemail" name="email" type="email" autocomplete="email" inputmode="email" required aria-required="true" placeholder=" "></div>
            </div>
            <label class="privacy"><input type="checkbox" id="privacy" name="privacy_presa_visione" value="presa_visione" required aria-required="true"> Ho preso visione dell’<a href="https://www.econ-apex.com/privacy" target="_blank" rel="noopener">Informativa Privacy</a>.</label>
          </section>`;

requireMarker(html, '<div class="bill-first" id="billFirst">', 'bill-first section');
if (!html.includes('class="contact-capture"')) {
  html = html.replace('<div class="bill-first" id="billFirst">', `<div class="bill-first" id="billFirst">${contactCard}`);
}

html = html.replace(/\s*<div class="field"><label for="iphone">Telefono<\/label><input id="iphone"[^>]*><\/div>/, '');
html = html.replace(/\s*<div class="single-field-row">\s*<div class="field field--full"><label for="iemail">Email<\/label><input id="iemail"[^>]*><\/div>\s*<\/div>/, '');
html = html.replace(/\s*<label class="privacy"><input type="checkbox" id="privacy"[^>]*> Ho preso visione dell’<a href="https:\/\/www\.econ-apex\.com\/privacy" target="_blank" rel="noopener">Informativa Privacy<\/a>\.<\/label>/, '');

['iname', 'iaddress', 'iconsumptionvalue', 'iannualspend'].forEach(id => { html = stripRequired(html, id); });
html = html.replace('<div class="required-grid">', '<div class="single-field-row manual-name-row">');

const cssLink = '<link rel="stylesheet" href="assets/contact-capture-first.css">';
if (!html.includes(cssLink)) html = html.replace('</head>', `${cssLink}\n</head>`);
await writeFile(indexPath, html);

const validatePattern = /function validate\(\)\{[\s\S]*?\n\}\n\nfunction startProcessing\(\)/;
if (!validatePattern.test(app)) throw new Error('Contact capture: validate function marker not found');
const replacement = `function validate(){
  const billRoute = hasBillRoute();
  const name = els.iname.value.trim();
  const address = els.iaddress.value.trim();
  const emailOk = isValidEmail(els.iemail.value.trim());
  const phoneOk = isValidPhone(els.iphone.value);
  const privacyOk = !!els.privacy.checked;
  const energy = manualEnergyData();
  const contactOk = phoneOk && emailOk && privacyOk;
  const manualOk = contactOk
    && name.length >= 5
    && isCompleteAddress(address)
    && energy.annualKwh >= 300
    && energy.annualSpend >= 50;
  const billOk = billRoute && contactOk;
  const ok = (billOk || manualOk) && !state.submitted;

  els.submitBtn.disabled = !ok;
  els.submitBtn.textContent = reportActionLabel();
  updateStickyCta(ok);
  if(state.submitted) return ok;

  if(state.primaryDocumentReadInFlight){
    setHelp('Stiamo leggendo consumi, importi e POD dalla bolletta. Attendi qualche secondo.', true);
  } else if(!phoneOk) setHelp('Inserisci un numero di cellulare valido per ricevere il report.', false);
  else if(!emailOk) setHelp('Inserisci un indirizzo email valido per ricevere il report.', false);
  else if(!privacyOk) setHelp('Conferma di aver letto l’Informativa Privacy per procedere.', false);
  else if(billRoute){
    if(hasRecognisedBill()) setHelp('Contatti acquisiti e bolletta riconosciuta. Puoi generare il report.', true);
    else setHelp('Contatti acquisiti. Puoi inviare la bolletta a ECON e generare il report.', true);
  } else if(name.length < 5) setHelp('Carica la bolletta oppure apri il percorso manuale e inserisci nome e cognome.', false);
  else if(!isCompleteAddress(address)) setHelp('Completa provincia, comune, via e civico per verificare correttamente il tetto.', false);
  else if(energy.annualKwh < 300) setHelp('Inserisci un consumo annuale valido in kWh.', false);
  else if(energy.annualSpend < 50) setHelp('Inserisci una spesa annuale valida in euro.', false);
  else setHelp('Dati completi. Possiamo generare lo scenario preliminare e verificare il tetto.', true);

  return ok;
}

function startProcessing()`;
await writeFile(appPath, app.replace(validatePattern, replacement));
console.log('ECON contact capture moved to the first upload step.');
