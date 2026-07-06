(function(){
'use strict';

/*
  v41 – Stabilised ECON lead flow.
  Objectives:
  - capture the lean lead immediately on CTA click;
  - keep the page responsive when OCR is unavailable or a file is problematic;
  - avoid duplicate post-report uploads and false "document received" confirmations;
  - use declared consumption as the report baseline unless OCR finds an explicit annual value;
  - never send the full OCR text as a hidden Netlify field.
*/

const CONFIG = Object.freeze({
  WA_NUMBER: '393783091137',
  MIN_PROCESS_MS: 7000,
  LEAD_ENDPOINT: '/.netlify/functions/lead-intake',
  EVENT_ENDPOINT: '/.netlify/functions/lead-event',
  DOCUMENT_ENDPOINT: '/.netlify/functions/document-upload',
  MAX_FILE_BYTES: Math.round(7 * 1024 * 1024),
  MAX_OCR_DIMENSION: 1800,
  LIBRARY_WAIT_MS: 4500,
  INITIAL_POST_TIMEOUT_MS: 8500,
  DETAIL_POST_TIMEOUT_MS: 14000,
  OCR_TIMEOUT_MS: 18000,
  POST_RETRIES: 1,
  PRIVACY_NOTICE_VERSION: 'econ-privacy-2026-07-04',
  FORM_VERSION: 'econ-report-v47-commercial-opportunity-scenario'
});

const $ = id => document.getElementById(id);
const els = {
  bill:$('bill'), billFirst:$('billFirst'), uploadBox:$('uploadBox'), fileState:$('fileState'), removeDoc:$('removeDoc'),
  fileName:$('fileName'), fileMeta:$('fileMeta'), processing:$('processing'), procTitle:$('procTitle'),
  procBar:$('procBar'), procPercent:$('procPercent'), procMeta:$('procMeta'), proc1:$('proc1'), proc2:$('proc2'), proc3:$('proc3'),
  report:$('report'), title:$('title'), copy:$('copy'), badge:$('badge'), readOut:$('readOut'),
  potential:$('potential'), potentialCopy:$('potentialCopy'), bar:$('bar'), autoOut:$('autoOut'),
  autoCopy:$('autoCopy'), saveOut:$('saveOut'), saveCopy:$('saveCopy'), supplyOut:$('supplyOut'),
  supplyCopy:$('supplyCopy'), desireTitle:$('desireTitle'), desireCopy:$('desireCopy'),
  hText:$('hText'), hKwh:$('hKwh'), hAmount:$('hAmount'), hAnnualSpend:$('hAnnualSpend'), hPod:$('hPod'), hKwp:$('hKwp'),
  hStorage:$('hStorage'), hOptimization:$('hOptimization'), hAutoUser:$('hAutoUser'), hRating:$('hRating'),
  hPhase:$('hPhase'), hFallback:$('hFallback'), hLeadTime:$('hLeadTime'), hLeadId:$('hLeadId'),
  iname:$('iname'), iphone:$('iphone'), iemail:$('iemail'), iaddress:$('iaddress'), iconsumptionvalue:$('iconsumptionvalue'), iannualspend:$('iannualspend'),
  privacy:$('privacy'), submitBtn:$('submitBtn'), helpText:$('helpText'),
  leadForm:$('leadForm'), contactBlock:$('contactBlock'), contactSep:$('contactSep'),
  successState:$('successState'), waLink:$('waLink'),
  successDeliveryCopy:$('successDeliveryCopy'), reportDeliveryNote:$('reportDeliveryNote'),
  precisionUploadWrap:$('precisionUploadWrap'), precisionUpload:$('precisionUpload'), precisionBill:$('precisionBill'),
  precisionFileState:$('precisionFileState'), precisionFileName:$('precisionFileName'), precisionFileCopy:$('precisionFileCopy'),
  manualRoute:$('manualRoute'), viewReportBtn:$('viewReportBtn'),
  successEyebrow:$('successEyebrow'), retryUploadBtn:$('retryUploadBtn'),
  stickyCta:$('stickyCta'), stickySubmitBtn:$('stickySubmitBtn')
};

const state = {
  selectedFile: null,
  submitted: false,
  isGenerating: false,
  reportGenerated: false,
  lastReport: null,
  leadId: '',
  immediateLeadStatus: null,
  fullReportStatus: null,
  postReportUploadInFlight: false,
  deliveredFileSignature: '',
  pendingFileSignature: '',
  activeOcrWorker: null,
  activePdfLoadingTask: null,
  activePdfDocument: null,
  ocrAbortRequested: false,
  documentAssessments: new Map(),
  primaryDocumentAssessment: null,
  primaryDocumentReadInFlight: false,
  billOnlyMode: false,
  postReportFile: null,
  postReportAssessment: null,
  deliveredFileSignatures: new Set(),
  retryUploadRequired: false,
  leadReadyPromise: null,
  initialLeadRequestId: '',
  eventIds: new Map(),
  clientSessionId: ''
};

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
const num = value => new Intl.NumberFormat('it-IT', {maximumFractionDigits:0}).format(Number(value) || 0);
const eur = value => new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(Number(value) || 0);
const power = value => new Intl.NumberFormat('it-IT', {maximumFractionDigits:1}).format(Number(value) || 0);
const motion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function safeScroll(element, block){
  if(!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({behavior: motion(), block: block || 'center'});
}

function createLeadId(){
  const random = (window.crypto && window.crypto.getRandomValues)
    ? Array.from(window.crypto.getRandomValues(new Uint32Array(1))).map(n => n.toString(36)).join('')
    : Math.random().toString(36).slice(2);
  return 'econ-' + Date.now().toString(36) + '-' + random.slice(0, 8);
}

function fileSignature(file){
  return file ? [file.name, file.size, file.lastModified, file.type].join('|') : '';
}

function cleanNumber(value){
  let raw = String(value || '').trim().replace(/\s+/g, '').replace(/[€]/g, '');
  if(!raw) return 0;
  raw = raw.replace(/[^\d,.\-]/g, '');
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');

  if(comma !== -1 && dot !== -1){
    const decimalSeparator = comma > dot ? ',' : '.';
    raw = decimalSeparator === ','
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if(comma !== -1 || dot !== -1){
    const separator = comma !== -1 ? ',' : '.';
    const parts = raw.split(separator);
    const decimal = parts.pop() || '';
    const integer = parts.join('');
    // In Italian bill data, a three-digit final group is overwhelmingly a thousands separator.
    raw = decimal.length === 3 ? integer + decimal : integer + '.' + decimal;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizePhone(value){
  return String(value || '').replace(/[\s().-]/g, '').replace(/^00/, '+');
}

function isValidPhone(value){
  return /^\+?[0-9]{8,15}$/.test(normalizePhone(value));
}

function setHelp(message, ok){
  if(!els.helpText) return;
  els.helpText.textContent = message;
  els.helpText.className = ok ? 'help ok' : 'help';
}

function setFileControlsLocked(locked){
  if(els.bill) els.bill.disabled = !!locked;
  if(els.manualRoute) els.manualRoute.disabled = !!locked;
  if(els.removeDoc) els.removeDoc.disabled = !!locked;
  if(els.uploadBox){
    els.uploadBox.classList.toggle('is-disabled', !!locked);
    els.uploadBox.setAttribute('aria-disabled', String(!!locked));
  }
}

function setPrecisionControlsLocked(locked){
  if(els.precisionBill) els.precisionBill.disabled = !!locked;
  if(els.precisionUpload){
    els.precisionUpload.classList.toggle('is-disabled', !!locked);
    els.precisionUpload.setAttribute('aria-disabled', String(!!locked));
  }
}

function setRetryUploadVisible(visible){
  state.retryUploadRequired = !!visible;
  if(els.retryUploadBtn){
    els.retryUploadBtn.classList.toggle('show', !!visible);
    els.retryUploadBtn.disabled = state.postReportUploadInFlight;
  }
}

function currentDocumentFile(){
  return state.postReportFile || state.selectedFile || null;
}

function isDocumentDelivered(file){
  return !!file && state.deliveredFileSignatures.has(fileSignature(file));
}

function markDocumentDelivered(file){
  if(file) state.deliveredFileSignatures.add(fileSignature(file));
}

function clearPrecisionInput(){
  if(els.precisionBill) els.precisionBill.value = '';
}

function cancelOcrResources(){
  state.ocrAbortRequested = true;
  const worker = state.activeOcrWorker;
  const loadingTask = state.activePdfLoadingTask;
  const pdf = state.activePdfDocument;
  state.activeOcrWorker = null;
  state.activePdfLoadingTask = null;
  state.activePdfDocument = null;
  if(worker && typeof worker.terminate === 'function') Promise.resolve(worker.terminate()).catch(() => {});
  if(pdf && typeof pdf.destroy === 'function') Promise.resolve(pdf.destroy()).catch(() => {});
  if(loadingTask && typeof loadingTask.destroy === 'function') Promise.resolve(loadingTask.destroy()).catch(() => {});
}

function timeoutError(code, message){
  const error = new Error(message);
  error.code = code;
  return error;
}

function withTimeout(promise, timeoutMs, onTimeout){
  let timer;
  return new Promise((resolve, reject) => {
    timer = window.setTimeout(() => {
      try { onTimeout && onTimeout(); } catch(error) { /* cancellation is best-effort */ }
      reject(timeoutError('OCR_TIMEOUT', 'Lettura automatica oltre il tempo disponibile'));
    }, timeoutMs);
    Promise.resolve(promise).then(
      value => { window.clearTimeout(timer); resolve(value); },
      error => { window.clearTimeout(timer); reject(error); }
    );
  });
}

function beginOcrProgress(){
  let progress = 42;
  let ticks = 0;
  const timer = window.setInterval(() => {
    ticks += 1;
    progress = Math.min(69, progress + (ticks < 4 ? 4 : 2));
    setStep('Lettura bolletta e dati energetici', progress);
    if(els.procMeta){
      els.procMeta.textContent = progress < 60
        ? 'Stiamo leggendo consumi, importi e POD dal documento.'
        : 'Quasi pronto: completiamo la verifica dei dati energetici.';
    }
  }, 850);
  return () => window.clearInterval(timer);
}

function billRouteStatus(){
  return state.primaryDocumentAssessment?.status || 'none';
}

function hasBillRoute(){
  const status = billRouteStatus();
  return !!state.selectedFile && !state.primaryDocumentReadInFlight && ['usable', 'timeout', 'error'].includes(status);
}

function hasRecognisedBill(){
  return hasBillRoute() && billRouteStatus() === 'usable';
}

function reportActionLabel(){
  if(state.submitted) return 'Report in elaborazione';
  if(state.primaryDocumentReadInFlight) return 'Stiamo leggendo la bolletta';
  if(hasRecognisedBill()) return 'Genera il report dalla bolletta';
  if(hasBillRoute()) return 'Invia la bolletta per la verifica ECON';
  return 'Genera il mio report preliminare';
}

function updateStickyCta(valid){
  if(!els.stickySubmitBtn || !els.stickyCta) return;
  const shouldShow = !state.reportGenerated;
  els.stickyCta.hidden = !shouldShow;
  els.stickySubmitBtn.disabled = !valid || state.submitted;
  els.stickySubmitBtn.textContent = valid && !state.submitted
    ? reportActionLabel()
    : (state.primaryDocumentReadInFlight ? 'Stiamo leggendo la bolletta' : 'Carica la bolletta o completa i dati');
}

function isValidEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || '').trim());
}

function isCompleteAddress(value){
  const address = String(value || '').replace(/\s+/g, ' ').trim();
  return address.length >= 12 && /[A-Za-zÀ-ÿ]/.test(address) && /\d/.test(address);
}

function manualEnergyData(){
  const annualKwh = cleanNumber(els.iconsumptionvalue?.value);
  const annualSpend = cleanNumber(els.iannualspend?.value);
  return {
    annualKwh,
    annualSpend,
    valid: annualKwh >= 300 && annualSpend >= 50
  };
}

function setManualFieldsRequired(required){
  [els.iname, els.iphone, els.iaddress, els.iconsumptionvalue, els.iannualspend, els.iemail, els.privacy]
    .filter(Boolean)
    .forEach(element => {
      element.required = !!required;
      element.setAttribute('aria-required', String(!!required));
    });
}

function setBillOnlyUi(active){
  state.billOnlyMode = !!active;
  setManualFieldsRequired(!active);
  if(els.contactBlock) els.contactBlock.classList.toggle('bill-first-ready', !!active);
}

function validate(){
  const billRoute = hasBillRoute();
  const name = els.iname.value.trim();
  const address = els.iaddress.value.trim();
  const email = els.iemail.value.trim();
  const energy = manualEnergyData();
  const manualOk = name.length >= 5
    && isValidPhone(els.iphone.value)
    && isCompleteAddress(address)
    && energy.annualKwh >= 300
    && energy.annualSpend >= 50
    && isValidEmail(email)
    && els.privacy.checked;
  const ok = (billRoute || manualOk) && !state.submitted;

  els.submitBtn.disabled = !ok;
  els.submitBtn.textContent = reportActionLabel();
  updateStickyCta(ok);
  if(state.submitted) return ok;

  if(state.primaryDocumentReadInFlight){
    setHelp('Stiamo leggendo consumi, importi e POD dalla bolletta. Attendi qualche secondo.', true);
  } else if(billRoute){
    if(hasRecognisedBill()) setHelp('Bolletta riconosciuta. Puoi generare il report senza compilare il form manuale.', true);
    else setHelp('Documento acquisito. Puoi inviarlo a ECON senza compilare il form manuale.', true);
  } else if(name.length < 5) setHelp('Carica la bolletta oppure inserisci nome e cognome per il percorso manuale.', false);
  else if(!isValidPhone(els.iphone.value)) setHelp('Inserisci un numero di telefono valido.', false);
  else if(!isCompleteAddress(address)) setHelp('Inserisci l’indirizzo completo: via, civico, CAP e Comune.', false);
  else if(energy.annualKwh < 300) setHelp('Inserisci un consumo annuale valido in kWh.', false);
  else if(energy.annualSpend < 50) setHelp('Inserisci una spesa annuale valida in euro.', false);
  else if(!isValidEmail(email)) setHelp('Inserisci un indirizzo email valido.', false);
  else if(!els.privacy.checked) setHelp('Conferma di aver letto l’Informativa Privacy per procedere.', false);
  else setHelp('Dati completi. Possiamo generare lo scenario preliminare e verificare il tetto.', true);

  return ok;
}

function startProcessing(){
  els.processing.classList.remove('done');
  els.processing.classList.add('show');
  els.processing.setAttribute('aria-busy', 'true');
  els.report.classList.remove('show');
  els.report.classList.add('loading');
  els.procTitle.textContent = 'Impostiamo la tua analisi';
  els.procBar.style.width = '8%';
  els.procPercent.textContent = '8%';
  els.procMeta.textContent = 'Stiamo ordinando indirizzo, copertura e dati energetici disponibili.';
  [els.proc1, els.proc2, els.proc3].forEach(el => el.classList.remove('done-step'));
  window.requestAnimationFrame(() => safeScroll(els.processing, 'center'));
}

function setStep(label, percentage){
  const pct = Math.max(0, Math.min(100, Number(percentage) || 0));
  els.procTitle.textContent = label;
  els.procBar.style.width = pct + '%';
  els.procPercent.textContent = Math.round(pct) + '%';
  if(pct < 34) els.procMeta.textContent = 'Dati acquisiti: costruiamo una base attendibile per il report.';
  else if(pct < 66) els.procMeta.textContent = 'Valutiamo potenza, accumulo e autonomia potenziale.';
  else if(pct < 92) els.procMeta.textContent = 'Confrontiamo scenario energetico e risparmio stimato.';
  else els.procMeta.textContent = 'Completiamo il report preliminare personalizzato.';
  if(pct >= 34) els.proc1.classList.add('done-step');
  if(pct >= 66) els.proc2.classList.add('done-step');
  if(pct >= 92) els.proc3.classList.add('done-step');
}

function stopProcessing(){
  els.processing.classList.remove('show');
  els.processing.classList.add('done');
  els.processing.setAttribute('aria-busy', 'false');
  els.report.classList.remove('loading');
}

function titleCase(value){
  return String(value || '').toLocaleLowerCase('it-IT')
    .replace(/\b([a-zà-ÿ])/g, letter => letter.toLocaleUpperCase('it-IT'))
    .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?)\b/gi, value => value.toUpperCase());
}

function safeName(value){
  let clean = String(value || '').replace(/\s+/g, ' ').replace(/[;|]+/g, ' ').trim();
  clean = clean.replace(/\b(?:codice|cliente|fornitura|indirizzo|pod|pdr|contratto|mercato|totale|bolletta|fattura|energia|elettrica|residente|telefono|email)\b.*$/i, '').trim();
  clean = clean.replace(/^[\-:\s]+|[\-:\s]+$/g, '');
  const bad = /bolletta|fattura|energia|elettrica|totale|pagare|fornitura|indirizzo|pod|contratto|mercato|servizio|spesa|iva|canone|contatore/i;
  const company = /\b(s\.?r\.?l\.?|s\.?p\.?a\.?|srls|snc|sas|societa|azienda)\b/i.test(clean);
  const words = clean.split(' ').filter(Boolean);
  return !bad.test(clean) && (words.length >= 2 || company) && clean.length >= 5 && clean.length <= 70 ? titleCase(clean) : '';
}

function extractUserData(raw, flat){
  const source = String(raw || '');
  const inline = String(flat || '');
  let fullName = '', city = '', nameConfidence = 0, cityConfidence = 0;

  const namePatterns = [
    /(?:intestatario|nominativo|cliente|denominazione|ragione\s*sociale|titolare)\s*[:\-]?\s*([^\n]{5,80})/i,
    /(?:dati\s+cliente|cliente\s+finale)\s*[:\-]?\s*([^\n]{5,80})/i
  ];
  for(const pattern of namePatterns){
    const match = source.match(pattern) || inline.match(pattern);
    const candidate = match ? safeName(match[1]) : '';
    if(candidate){
      fullName = candidate;
      nameConfidence = 90;
      break;
    }
  }

  const cityPatterns = [
    /(?:indirizzo\s+(?:di\s+)?fornitura|luogo\s+fornitura|fornitura\s+in|comune)\s*[:\-]?[^\n]{0,120}?\b(\d{5})\s+([A-ZÀ-Ý][A-ZÀ-Ý'’\- ]{2,38})\s*(?:\(([A-Z]{2})\)|\b([A-Z]{2})\b)/i,
    /\b(\d{5})\s+([A-ZÀ-Ý][A-ZÀ-Ý'’\- ]{2,38})\s*(?:\(([A-Z]{2})\)|\b([A-Z]{2})\b)/i
  ];
  for(const pattern of cityPatterns){
    const match = source.match(pattern) || inline.match(pattern);
    const candidate = match ? String(match[2] || '').replace(/\s+/g, ' ').trim() : '';
    if(candidate && !/energia|elettrica|bolletta|fattura|totale|pod|fornitura/i.test(candidate)){
      city = titleCase(candidate);
      cityConfidence = pattern === cityPatterns[0] ? 95 : 82;
      break;
    }
  }
  return {fullName, city, nameConfidence, cityConfidence};
}

function applySafeAutofill(data){
  const filled = [];
  if(!data || !data.isBill || !data.user) return filled;

  if(data.user.fullName && data.user.nameConfidence >= 90 && !els.iname.value.trim()){
    els.iname.value = data.user.fullName;
    filled.push('nome e cognome');
  }
  els.hAutoUser.value = filled.length
    ? 'Autocompilato con alta affidabilità: ' + filled.join(', ')
    : 'Nessun dato utente autocompilato';
  validate();
  return filled;
}

function collectKwhCandidates(flat){
  const candidates = [];
  const regex = /([0-9]{1,3}(?:[.\s,][0-9]{3})+|[0-9]{2,7}(?:[.,][0-9]+)?)\s*kwh\b/gi;
  let match;
  while((match = regex.exec(flat))){
    const value = cleanNumber(match[1]);
    if(value < 40 || value > 500000) continue;
    const context = flat.slice(Math.max(0, match.index - 90), Math.min(flat.length, regex.lastIndex + 70)).toLowerCase();
    const annual = /\b(?:annuo|annuali|12\s*mesi|ultimi\s*12\s*mesi|anno\s+di\s+fornitura)\b/.test(context);
    let score = 0;
    if(annual) score += 80;
    if(/\b(?:consumo|consumi|prelievi|energia\s+prelevata|energia\s+attiva)\b/.test(context)) score += 25;
    if(/\b(?:fatturati|periodo|mese|bimestre)\b/.test(context)) score += 10;
    if(/\b(?:quota|prezzo|corrispettivo|fascia|f1|f2|f3)\b/.test(context)) score -= 15;
    candidates.push({value, annual, score, context});
  }
  return candidates.sort((a, b) => b.score - a.score || b.value - a.value);
}

function collectAmountCandidates(flat){
  const candidates = [];
  const totalRegex = /(?:totale\s*(?:da\s*pagare|bolletta|fattura|documento)?|importo\s*(?:totale)?|da\s*pagare)[^0-9€]{0,60}(?:€|eur)?\s*([0-9]{1,4}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{1,6},[0-9]{2})/gi;
  let match;
  while((match = totalRegex.exec(flat))){
    const value = cleanNumber(match[1]);
    if(value > 10 && value < 100000) candidates.push({value, score:100});
  }
  const euroRegex = /€\s*([0-9]{1,4}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{1,6},[0-9]{2})/g;
  while((match = euroRegex.exec(flat))){
    const value = cleanNumber(match[1]);
    if(value <= 10 || value >= 100000) continue;
    const context = flat.slice(Math.max(0, match.index - 70), Math.min(flat.length, euroRegex.lastIndex + 45)).toLowerCase();
    let score = 0;
    if(/\b(?:totale|pagare|importo)\b/.test(context)) score += 35;
    if(/\b(?:quota|prezzo|corrispettivo|iva|canone)\b/.test(context)) score -= 10;
    candidates.push({value, score});
  }
  return candidates.sort((a, b) => b.score - a.score || b.value - a.value);
}

function extractBillData(text){
  const raw = String(text || '').replace(/\r/g, '\n');
  const flat = raw.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const kwhCandidates = collectKwhCandidates(flat);
  const amountCandidates = collectAmountCandidates(flat);
  const kwhCandidate = kwhCandidates[0] || null;
  const amountCandidate = amountCandidates[0] || null;
  const pod = (flat.match(/\bIT[0-9A-Z]{12,18}\b/i) || [''])[0];
  const keywords = ['bolletta','fattura','energia elettrica','fornitura','pod','kwh','contatore','mercato libero','servizio elettrico','spesa energia','totale da pagare','cliente','materia energia','oneri di sistema'];
  const billScore = keywords.reduce((score, word) => score + (lower.includes(word) ? 1 : 0), 0);
  const kwh = kwhCandidate ? kwhCandidate.value : 0;
  const amount = amountCandidate ? amountCandidate.value : 0;
  const isBill = billScore >= 2 && (!!kwh || !!amount || !!pod);

  return {
    kwh,
    kwhScope: kwhCandidate ? (kwhCandidate.annual ? 'annuo' : 'periodo_fattura') : 'non_disponibile',
    amount,
    pod,
    // Never keep/sync the full OCR text in a hidden Netlify field. The original bill file remains the only source document.
    text: isBill ? 'OCR locale eseguito: valori tecnici estratti senza archiviare il testo completo della bolletta.' : '',
    confidence: (kwh ? 42 : 0) + (amount ? 35 : 0) + (pod ? 22 : 0) + Math.min(24, billScore * 4),
    billScore,
    isBill,
    user: extractUserData(raw, flat),
    source: 'ocr_locale'
  };
}

async function waitForGlobal(name, timeoutMs){
  const deadline = Date.now() + timeoutMs;
  while(Date.now() < deadline){
    if(window[name]) return window[name];
    await wait(75);
  }
  return window[name] || null;
}

async function getPdfJs(){
  const pdfjs = await waitForGlobal('pdfjsLib', CONFIG.LIBRARY_WAIT_MS);
  if(!pdfjs) throw new Error('pdfjs non disponibile');
  if(pdfjs.GlobalWorkerOptions){
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }
  return pdfjs;
}

async function recognizeText(source){
  const Tesseract = await waitForGlobal('Tesseract', CONFIG.LIBRARY_WAIT_MS);
  if(!Tesseract) throw new Error('OCR non disponibile');
  if(state.ocrAbortRequested) throw timeoutError('OCR_CANCELLED', 'Lettura automatica interrotta');

  if(typeof Tesseract.createWorker !== 'function'){
    const result = await Tesseract.recognize(source, 'ita+eng');
    if(state.ocrAbortRequested) throw timeoutError('OCR_CANCELLED', 'Lettura automatica interrotta');
    return result?.data?.text || '';
  }

  const worker = await Tesseract.createWorker('ita+eng');
  if(state.ocrAbortRequested){
    if(worker && typeof worker.terminate === 'function') await worker.terminate().catch(() => {});
    throw timeoutError('OCR_CANCELLED', 'Lettura automatica interrotta');
  }
  state.activeOcrWorker = worker;
  try {
    const result = await worker.recognize(source);
    if(state.ocrAbortRequested) throw timeoutError('OCR_CANCELLED', 'Lettura automatica interrotta');
    return result?.data?.text || '';
  } finally {
    if(state.activeOcrWorker === worker) state.activeOcrWorker = null;
    if(worker && typeof worker.terminate === 'function') await worker.terminate().catch(() => {});
  }
}

function clampViewport(page, maxDimension){
  const base = page.getViewport({scale:1});
  const scale = Math.max(0.8, Math.min(2, maxDimension / Math.max(base.width, base.height)));
  return page.getViewport({scale});
}

async function readPdf(file){
  const pdfjs = await getPdfJs();
  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({data});
  state.activePdfLoadingTask = loadingTask;
  let pdf;
  try {
    pdf = await loadingTask.promise;
    state.activePdfDocument = pdf;
    if(state.ocrAbortRequested) throw timeoutError('OCR_CANCELLED', 'Lettura automatica interrotta');
    let text = '';
    for(let pageNo = 1; pageNo <= Math.min(pdf.numPages, 4); pageNo++){
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
      if(state.ocrAbortRequested) throw timeoutError('OCR_CANCELLED', 'Lettura automatica interrotta');
    }
    if(text.trim().length > 80) return text;

    const page = await pdf.getPage(1);
    const viewport = clampViewport(page, CONFIG.MAX_OCR_DIMENSION);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', {alpha:false});
    if(!context) throw new Error('Canvas non disponibile');
    await page.render({canvasContext: context, viewport}).promise;
    if(state.ocrAbortRequested) throw timeoutError('OCR_CANCELLED', 'Lettura automatica interrotta');
    return recognizeText(canvas.toDataURL('image/jpeg', 0.9));
  } finally {
    if(state.activePdfDocument === pdf) state.activePdfDocument = null;
    if(state.activePdfLoadingTask === loadingTask) state.activePdfLoadingTask = null;
    if(pdf && typeof pdf.destroy === 'function') pdf.destroy();
    if(loadingTask && typeof loadingTask.destroy === 'function') loadingTask.destroy();
  }
}

async function imageToOcrSource(file){
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Formato immagine non leggibile'));
      img.src = url;
    });
    const ratio = Math.min(1, CONFIG.MAX_OCR_DIMENSION / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {alpha:false});
    if(!context) throw new Error('Canvas non disponibile');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readImage(file){
  return recognizeText(await imageToOcrSource(file));
}

async function parseFile(file){
  if(!file) return null;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const text = isPdf ? await readPdf(file) : await readImage(file);
  return extractBillData(text);
}

async function assessDocument(file, showProgress){
  if(!file) return {status:'none', parsed:null};
  const signature = fileSignature(file);
  const cached = state.documentAssessments.get(signature);
  if(cached && cached.status !== 'timeout' && cached.status !== 'error') return cached;

  state.ocrAbortRequested = false;
  const stopProgress = showProgress ? beginOcrProgress() : null;
  try {
    const parsed = await withTimeout(parseFile(file), CONFIG.OCR_TIMEOUT_MS, cancelOcrResources);
    const assessment = parsed?.isBill
      ? {status:'usable', parsed}
      : {status:'unreadable', parsed};
    state.documentAssessments.set(signature, assessment);
    return assessment;
  } catch(error) {
    if(error?.code === 'OCR_TIMEOUT') return {status:'timeout', parsed:null, error};
    if(error?.code === 'OCR_CANCELLED') return {status:'timeout', parsed:null, error};
    return {status:'error', parsed:null, error};
  } finally {
    if(stopProgress) stopProgress();
    state.ocrAbortRequested = false;
  }
}

function makeFallback(reason, partial){
  const partialKwh = partial && partial.kwh ? Number(partial.kwh) : 0;
  const partialAmount = partial && partial.amount ? Number(partial.amount) : 0;
  return {
    kwh: partialKwh,
    kwhScope: partial?.kwhScope || 'non_disponibile',
    amount: partialAmount,
    pod: partial?.pod || '',
    text: 'Scenario preliminare basato su indirizzo, consumo annuale e spesa annuale dichiarati.',
    isBill: false,
    fallback: true,
    fallbackReason: reason,
    source: 'dati_annuali_e_indirizzo',
    fullAddress: els.iaddress.value.trim()
  };
}

function annualizeKwh(kwh, data){
  if(!kwh) return 0;
  if(data?.kwhScope === 'annuo') return Math.round(kwh);
  // Prudenziale: la bolletta può riportare un singolo periodo di fatturazione.
  if(kwh < 1200) return Math.round(kwh * 6);
  if(kwh < 3000) return Math.round(kwh * 3);
  return Math.round(kwh * 1.5);
}

function resolveReportInputs(data){
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
}

/*
  Scenario opportunità ECON
  Il report preliminare privilegia il massimo sfruttamento ragionevole del tetto e
  dell'accumulo, non il mero pareggio matematico sui consumi. È una stima di
  potenziale commerciale, dichiarata come tale e sempre soggetta a verifica di
  copertura, ombreggiamenti, profilo orario e vincoli di connessione.
*/
const OPPORTUNITY_SCENARIO = Object.freeze({
  yieldKwhPerKwp: 1050,
  plantCoverageMultiplier: 1.18,
  batteryKwhPerKwp: 1.85,
  autonomyBase: 56,
  autonomyPerKwp: 2.1,
  autonomyCeiling: 79,
  selfConsumptionBase: 56,
  selfConsumptionPerKwp: 1.45,
  selfConsumptionCeiling: 82,
  pvValueShare: 0.60,
  supplyOptimizationShare: 0.075,
  supplyOptimizationCap: 650,
  totalValueCeiling: 0.76
});

function estimateSystem(annualKwh){
  const rawPlant = Math.max(0, annualKwh / OPPORTUNITY_SCENARIO.yieldKwhPerKwp * OPPORTUNITY_SCENARIO.plantCoverageMultiplier);
  const plantSteps = [3,4.5,6,9,12,15,19.8,24,30,50,75,100,150,200];
  const plant = plantSteps.find(step => step >= rawPlant) || plantSteps[plantSteps.length - 1];
  const rawBattery = plant * OPPORTUNITY_SCENARIO.batteryKwhPerKwp;
  const batterySteps = [5,10,15,20,30,45,60,80,100,150,200,300];
  const battery = batterySteps.find(step => step >= rawBattery) || batterySteps[batterySteps.length - 1];
  return {plant, battery};
}

function autonomy(plant){
  return Math.round(Math.min(
    OPPORTUNITY_SCENARIO.autonomyBase + Math.min(plant * OPPORTUNITY_SCENARIO.autonomyPerKwp, 23),
    OPPORTUNITY_SCENARIO.autonomyCeiling
  ));
}

function selfConsumptionPotential(plant, battery){
  return Math.round(Math.min(
    OPPORTUNITY_SCENARIO.selfConsumptionBase + Math.min(plant * OPPORTUNITY_SCENARIO.selfConsumptionPerKwp + battery * 0.12, 26),
    OPPORTUNITY_SCENARIO.selfConsumptionCeiling
  ));
}

function estimateAnnualValue(annualSpend){
  const supplyOptimization = Math.min(
    annualSpend * OPPORTUNITY_SCENARIO.supplyOptimizationShare,
    OPPORTUNITY_SCENARIO.supplyOptimizationCap
  );
  return Math.round(Math.min(
    annualSpend * OPPORTUNITY_SCENARIO.totalValueCeiling,
    annualSpend * OPPORTUNITY_SCENARIO.pvValueShare + supplyOptimization
  ));
}

function updateHiddenFields(data, scenario, combined, annualKwh, annualSpend, source){
  const hasEnergyBasis = annualKwh >= 300;
  const hasTrustedSpend = annualSpend >= 50;
  els.hText.value = data?.isBill
    ? 'OCR locale completato: nessun testo integrale della bolletta archiviato nel form.'
    : 'Scenario preliminare basato su indirizzo, consumo annuale e spesa annuale dichiarati.';
  els.hKwh.value = hasEnergyBasis ? String(annualKwh) : '';
  els.hAmount.value = hasTrustedSpend ? String(Math.round(annualSpend / 12)) : '';
  if(els.hAnnualSpend) els.hAnnualSpend.value = hasTrustedSpend ? String(Math.round(annualSpend)) : '';
  els.hPod.value = data?.pod || '';
  els.hKwp.value = hasEnergyBasis
    ? 'fino a ' + power(scenario.plant) + ' kWp + accumulo fino a ' + power(scenario.battery) + ' kWh'
    : 'Verifica tetto e consumi da completare';
  els.hStorage.value = hasEnergyBasis ? power(scenario.battery) + ' kWh' : 'Da definire';
  els.hOptimization.value = hasEnergyBasis
    ? (hasTrustedSpend
      ? 'Scenario opportunità annuo FV + accumulo + ottimizzazione fornitura: fino a ' + eur(combined)
      : 'Stima economica da completare dopo acquisizione di una spesa annua affidabile.')
    : 'Stima economica da completare dopo verifica bolletta o consumi.';
  els.hRating.value = hasEnergyBasis
    ? (data?.fallback ? 'Scenario opportunità preliminare' : 'Bolletta letta — scenario opportunità') + ' — base: ' + source + ' — ' + num(annualKwh) + ' kWh/anno' + (hasTrustedSpend ? ' · ' + eur(annualSpend) + '/anno' : ' · spesa annua da completare') + ' — scenario ' + els.hKwp.value
    : 'Indirizzo completo acquisito — verifica prioritaria di tetto, esposizione, ombreggiamenti e superficie.';
  els.hFallback.value = data?.fallback ? (data.fallbackReason || 'verifica indirizzo attiva') : 'no';
  els.hPhase.value = 'report_generato';
}

function setRoofVerificationReport(data){
  const scenario = {plant: 0, battery: 0};
  updateHiddenFields(data, scenario, 0, 0, 0, 'indirizzo completo');
  els.title.textContent = 'Verifica preliminare del tetto';
  els.badge.textContent = 'Indirizzo acquisito';
  els.badge.className = 'badge mid';
  els.copy.textContent = 'Abbiamo acquisito l’indirizzo dell’immobile: il primo passo è verificare copertura, esposizione, ombreggiamenti e superficie disponibile.';
  els.readOut.textContent = 'Indirizzo completo acquisito · verifica della copertura da completare.';
  els.potential.textContent = 'Verifica tetto';
  els.potentialCopy.textContent = 'Analizziamo idoneità, esposizione e superficie prima di stimare l’impianto.';
  els.bar.style.width = '58%';
  els.autoOut.textContent = 'Da stimare';
  els.autoCopy.textContent = 'L’autonomia viene calcolata dopo lettura bolletta o consumi reali.';
  els.saveOut.textContent = 'Da stimare';
  els.saveCopy.textContent = 'Risparmio e dimensionamento richiedono i dati energetici dell’immobile.';
  els.supplyOut.textContent = 'Verifica completa ECON';
  els.supplyCopy.textContent = 'Tetto, consumi, accumulo e fornitura in un’unica analisi.';
  els.desireTitle.textContent = 'Il tuo indirizzo rende possibile una verifica concreta.';
  els.desireCopy.textContent = 'Aggiungi la bolletta quando disponibile per completare consumi, dimensionamento e valore economico.';
}

function setReport(data){
  state.lastReport = data;
  const metrics = resolveReportInputs(data);
  if(!metrics.hasEnergyBasis){
    setRoofVerificationReport(data);
    els.report.classList.add('show');
    safeScroll(els.report, 'start');
    return;
  }

  const annualKwh = metrics.annualKwh;
  const monthlySpend = metrics.monthlySpend;
  const annualSpend = metrics.annualSpend || 0;
  const scenario = estimateSystem(annualKwh);
  const auto = autonomy(scenario.plant);
  const selfConsumption = selfConsumptionPotential(scenario.plant, scenario.battery);
  const combined = metrics.hasTrustedAnnualSpend ? estimateAnnualValue(annualSpend) : 0;
  const high = annualKwh >= 4200 || monthlySpend >= 125;
  const mid = annualKwh >= 2200 || monthlySpend >= 70;

  updateHiddenFields(data, scenario, combined, annualKwh, annualSpend, metrics.energySource);
  const reason = String(data?.fallbackReason || '');
  const unreadableDocument = /documento non idoneo/i.test(reason);
  const ocrTimedOut = /18 secondi|non completata/i.test(reason);
  els.title.textContent = high ? 'Scenario FV ad alto potenziale' : (mid ? 'Scenario FV con potenziale elevato' : 'Potenziale da valorizzare');
  els.badge.textContent = unreadableDocument ? 'Documento da riprovare' : (high ? 'Priorità alta' : (mid ? 'Da approfondire' : 'Segnale utile'));
  els.badge.className = unreadableDocument ? 'badge mid' : (high ? 'badge high' : (mid ? 'badge mid' : 'badge'));
  els.copy.textContent = data?.fallback
    ? (state.selectedFile
      ? 'La lettura automatica non è stata completata: ECON ha ricevuto la bolletta e valida lo scenario nel report tecnico.'
      : 'Il report usa consumo e spesa annuali dichiarati, da validare con ECON.')
    : 'La bolletta è stata letta: lo scenario integra consumi, importi e dati tecnici da validare sul tetto.';
  const scope = data.kwhScope === 'annuo' ? 'consumo annuo letto' : (data.kwh ? 'consumo del periodo letto' : 'dati annuali dichiarati');
  els.readOut.textContent = scope + ': ' + num(annualKwh) + ' kWh/anno · ' + metrics.spendSource + (metrics.hasTrustedAnnualSpend ? ': ' + eur(annualSpend) + '/anno' : '') + (data.pod ? ' · POD rilevato' : '');
  els.desireTitle.textContent = unreadableDocument ? 'Riprova con una bolletta leggibile per affinare il report.' : (high ? 'Questo profilo può valorizzare davvero il tetto disponibile.' : 'Qui c’è margine per aumentare autonomia e autoconsumo.');
  els.desireCopy.textContent = unreadableDocument
    ? 'Il file selezionato non sembra una bolletta elettrica leggibile: carica il documento integrale, nitido e con consumi visibili.'
    : (ocrTimedOut ? 'La lettura automatica non si è conclusa in tempo: ECON completerà la verifica del documento.' : 'Questo è uno scenario opportunità: ECON lo valida su tetto, profilo orario, accumulo e ottimizzazione della fornitura.');
  els.potential.textContent = 'Fino a ' + power(scenario.plant) + ' kWp + ' + power(scenario.battery) + ' kWh';
  els.potentialCopy.textContent = 'Scenario opportunità: più produzione e accumulo per valorizzare il tetto, da verificare tecnicamente.';
  els.bar.style.width = high ? '94%' : (mid ? '76%' : '60%');
  els.autoOut.textContent = auto + '%';
  els.autoCopy.textContent = 'Autoconsumo potenziale fino a ' + selfConsumption + '% con accumulo e profilo di utilizzo favorevole.';
  els.saveOut.textContent = metrics.hasTrustedAnnualSpend ? 'Fino a ' + eur(combined) : 'Da stimare';
  els.saveCopy.textContent = metrics.hasTrustedAnnualSpend
    ? 'Scenario opportunità FV + accumulo + fornitura: da validare su profilo orario e tetto.'
    : 'Serve una spesa annua affidabile per stimare un valore economico personalizzato.';
  els.supplyOut.textContent = 'Margine extra con fornitura energia';
  els.supplyCopy.textContent = 'Completa il progetto FV dopo la verifica tecnica.';
  els.report.classList.add('show');
  safeScroll(els.report, 'start');
}

function createClientId(prefix){
  const random = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
  return prefix + '-' + random;
}

function getSessionId(){
  if(state.clientSessionId) return state.clientSessionId;
  const key = 'econ-report:session-id';
  try {
    const saved = window.sessionStorage.getItem(key);
    if(saved){ state.clientSessionId = saved; return saved; }
    const created = createClientId('session');
    window.sessionStorage.setItem(key, created);
    state.clientSessionId = created;
    return created;
  } catch(error){
    state.clientSessionId = createClientId('session');
    return state.clientSessionId;
  }
}

function eventIdFor(key){
  if(state.eventIds.has(key)) return state.eventIds.get(key);
  const created = createClientId('evt');
  state.eventIds.set(key, created);
  return created;
}

function currentAttribution(){
  const url = new URL(window.location.href);
  const get = key => (url.searchParams.get(key) || '').slice(0, 240);
  return {
    utm_source: get('utm_source'),
    utm_medium: get('utm_medium'),
    utm_campaign: get('utm_campaign'),
    utm_content: get('utm_content'),
    utm_term: get('utm_term'),
    gclid: get('gclid'),
    fbclid: get('fbclid'),
    landing_path: url.pathname.slice(0, 300),
    referrer: String(document.referrer || '').slice(0, 1000),
    locale: navigator.language || 'it-IT'
  };
}

function currentContactPayload(){
  const assessment = state.primaryDocumentAssessment;
  const parsed = assessment?.parsed || {};
  const billOnly = hasBillRoute();
  const user = parsed.user || {};
  return {
    intakeMode: billOnly ? 'bill_only' : 'manual',
    fullName: (billOnly ? (user.fullName || els.iname.value.trim()) : els.iname.value.trim()),
    phone: els.iphone.value.trim(),
    email: els.iemail.value.trim(),
    fullAddress: (billOnly ? (user.fullAddress || els.iaddress.value.trim()) : els.iaddress.value.trim()),
    energy: {
      annualKwh: billOnly ? (Number(parsed.annualKwh || (parsed.kwhScope === 'annuo' ? parsed.kwh : 0)) || manualEnergyData().annualKwh) : manualEnergyData().annualKwh,
      annualSpend: billOnly ? (Number(parsed.annualSpend || 0) || manualEnergyData().annualSpend) : manualEnergyData().annualSpend
    },
    document: {
      fileSelected: !!state.selectedFile,
      status: billRouteStatus(),
      kwh: Number(parsed.kwh || 0),
      kwhScope: parsed.kwhScope || 'non_disponibile',
      amount: Number(parsed.amount || 0),
      annualKwh: Number(parsed.annualKwh || (parsed.kwhScope === 'annuo' ? parsed.kwh : 0)),
      annualSpend: Number(parsed.annualSpend || 0),
      periodKwh: Number(parsed.periodKwh || (parsed.kwhScope === 'periodo_fattura' ? parsed.kwh : 0)),
      periodAmount: Number(parsed.periodAmount || 0),
      pod: parsed.pod || '',
      confidence: Number(parsed.confidence || 0),
      extractedName: user.fullName || '',
      extractedCity: user.city || '',
      fullAddress: user.fullAddress || ''
    },
    privacyNoticeVersion: CONFIG.PRIVACY_NOTICE_VERSION,
    privacyAccepted: billOnly ? true : els.privacy.checked,
    privacyCapture: billOnly ? 'upload_notice' : 'manual_checkbox',
    attribution: currentAttribution(),
    formVersion: CONFIG.FORM_VERSION,
    clientSessionId: getSessionId()
  };
}

function reportSnapshot(){
  const assessment = state.primaryDocumentAssessment;
  return {
    calculationVersion: CONFIG.FORM_VERSION,
    source: state.selectedFile ? (hasBillRoute() ? 'bolletta' : 'documento+indirizzo') : 'dati_manualI',
    contact: {
      addressProvided: !!els.iaddress.value.trim(),
      emailProvided: !!els.iemail.value.trim(),
      billOnly: hasBillRoute()
    },
    report: {
      annualKwh: Number(els.hKwh.value || 0),
      monthlySpend: Number(els.hAmount.value || 0),
      annualSpend: Number(els.hAnnualSpend?.value || 0),
      declaredAnnualKwh: manualEnergyData().annualKwh,
      declaredAnnualSpend: manualEnergyData().annualSpend,
      pod: els.hPod.value || '',
      scenario: els.hKwp.value || '',
      storage: els.hStorage.value || '',
      annualValue: els.hOptimization.value || '',
      rating: els.hRating.value || '',
      fallback: els.hFallback.value || 'no'
    },
    documentAssessment: compactAssessment(assessment)
  };
}

function compactAssessment(assessment){
  const parsed = assessment?.parsed || null;
  return {
    status: assessment?.status || 'none',
    kwh: Number(parsed?.kwh || 0),
    kwhScope: parsed?.kwhScope || 'non_disponibile',
    amount: Number(parsed?.amount || 0),
    annualKwh: Number(parsed?.annualKwh || (parsed?.kwhScope === 'annuo' ? parsed?.kwh : 0)),
    annualSpend: Number(parsed?.annualSpend || 0),
    periodKwh: Number(parsed?.periodKwh || (parsed?.kwhScope === 'periodo_fattura' ? parsed?.kwh : 0)),
    periodAmount: Number(parsed?.periodAmount || 0),
    pod: parsed?.pod || '',
    confidence: Number(parsed?.confidence || 0),
    isBill: !!parsed?.isBill
  };
}

function sameOriginHeaders(){
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  };
}

async function requestJson(url, payload, timeoutMs){
  if(navigator.onLine === false) throw new Error('offline');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
      credentials: 'same-origin',
      keepalive: true
    });
    const body = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(body.message || ('Richiesta non riuscita (' + response.status + ')'));
    return body;
  } finally {
    if(timer) window.clearTimeout(timer);
  }
}

async function requestJsonWithRetry(url, payload, timeoutMs, retries){
  let error;
  for(let attempt = 0; attempt <= retries; attempt++){
    try {
      return await requestJson(url, payload, timeoutMs);
    } catch(caught){
      error = caught;
      if(attempt < retries) await wait(700 * (attempt + 1));
    }
  }
  throw error || new Error('Invio non riuscito');
}

async function requestDocument(formData, timeoutMs){
  if(navigator.onLine === false) throw new Error('offline');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(CONFIG.DOCUMENT_ENDPOINT, {
      method: 'POST',
      body: formData,
      signal: controller ? controller.signal : undefined,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const body = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(body.message || ('Caricamento non riuscito (' + response.status + ')'));
    return body;
  } finally {
    if(timer) window.clearTimeout(timer);
  }
}

async function requestDocumentWithRetry(factory, timeoutMs, retries){
  let error;
  for(let attempt = 0; attempt <= retries; attempt++){
    try {
      return await requestDocument(factory(), timeoutMs);
    } catch(caught){
      error = caught;
      if(attempt < retries) await wait(850 * (attempt + 1));
    }
  }
  throw error || new Error('Caricamento non riuscito');
}

function beginLeadCapture(){
  if(state.leadReadyPromise) return state.leadReadyPromise;
  state.initialLeadRequestId = state.initialLeadRequestId || eventIdFor('lead-intake');
  const payload = {
    requestId: state.initialLeadRequestId,
    eventType: 'lead_requested',
    botField: document.querySelector('[name="bot-field"]')?.value || '',
    contact: currentContactPayload()
  };
  state.leadReadyPromise = requestJsonWithRetry(
    CONFIG.LEAD_ENDPOINT,
    payload,
    CONFIG.INITIAL_POST_TIMEOUT_MS,
    CONFIG.POST_RETRIES
  ).then(result => {
    state.leadId = result.leadId;
    els.hLeadId.value = result.leadId;
    state.immediateLeadStatus = true;
    refreshDeliveryUi();
    return result.leadId;
  }).catch(error => {
    state.immediateLeadStatus = false;
    refreshDeliveryUi();
    throw error;
  });
  return state.leadReadyPromise;
}

async function trackLeadEvent(eventType, payload, key){
  const leadId = await beginLeadCapture();
  const requestId = eventIdFor(key || eventType);
  return requestJsonWithRetry(CONFIG.EVENT_ENDPOINT, {
    requestId,
    leadId,
    eventType,
    payload: payload || {},
    clientSessionId: getSessionId()
  }, CONFIG.INITIAL_POST_TIMEOUT_MS, CONFIG.POST_RETRIES);
}

function makeDocumentFormData(file, assessment, source, eventKey){
  const fd = new FormData();
  fd.set('lead_id', state.leadId || '');
  fd.set('request_id', eventIdFor(eventKey));
  fd.set('source', source);
  fd.set('assessment', JSON.stringify(compactAssessment(assessment)));
  fd.set('document', file, file.name);
  return fd;
}

async function uploadDocument(file, assessment, source, eventKey){
  await beginLeadCapture();
  if(!state.leadId) throw new Error('Lead non disponibile');
  return requestDocumentWithRetry(
    () => makeDocumentFormData(file, assessment, source, eventKey),
    CONFIG.DETAIL_POST_TIMEOUT_MS,
    CONFIG.POST_RETRIES
  );
}

function whatsappUrl(){
  const reportLine = state.lastReport ? els.hRating.value : 'Report preliminare richiesto';
  const parsed = state.primaryDocumentAssessment?.parsed || {};
  const annualKwh = Number(els.hKwh.value || manualEnergyData().annualKwh || 0);
  const annualSpend = Number(els.hAnnualSpend?.value || manualEnergyData().annualSpend || 0);
  const address = els.iaddress.value.trim() || parsed.user?.fullAddress || parsed.user?.city || '--';
  const message = [
    'Buongiorno ECON,',
    'ho richiesto il report preliminare dalla landing.',
    '',
    'Dati progetto:',
    '- Indirizzo da verificare: ' + address,
    '- Consumo annuo: ' + (annualKwh ? num(annualKwh) + ' kWh' : '--'),
    '- Spesa annua: ' + (annualSpend ? eur(annualSpend) : '--'),
    '- POD rilevato: ' + (parsed.pod || '--'),
    '- Priorità: verifica tetto, esposizione, ombreggiamenti e superficie disponibile.',
    '',
    'Report:',
    '- ' + reportLine,
    '- ' + (els.hOptimization.value || 'In attesa di verifica tecnica'),
    '',
    state.selectedFile ? 'Ho caricato la bolletta nella landing.' : 'Non ho ancora caricato la bolletta: desidero aggiungerla per affinare il report tecnico.'
  ].join('\n');
  return 'https://wa.me/' + CONFIG.WA_NUMBER + '?text=' + encodeURIComponent(message);
}

function setPrecisionUploadReceipt(message, ok){
  if(!els.precisionFileState) return;
  els.precisionFileState.classList.add('show');
  els.precisionFileState.classList.toggle('is-error', !ok);
  if(els.precisionFileName) els.precisionFileName.textContent = (state.postReportFile || state.selectedFile)?.name || 'Documento ricevuto';
  if(els.precisionFileCopy) els.precisionFileCopy.textContent = message;
  els.precisionFileState.style.borderColor = ok ? 'rgba(141,198,63,.66)' : 'rgba(178,68,45,.52)';
}

function refreshDeliveryUi(){
  const primaryFile = state.selectedFile;
  const postFile = state.postReportFile;
  const activeFile = currentDocumentFile();
  const leadConfirmed = state.immediateLeadStatus === true;
  const deliveryFailed = state.immediateLeadStatus === false && state.fullReportStatus === false;
  const primaryDocumentDelivered = isDocumentDelivered(primaryFile);
  const postDocumentDelivered = isDocumentDelivered(postFile);
  const documentDelivered = primaryDocumentDelivered || postDocumentDelivered;
  const unreadablePrimary = state.primaryDocumentAssessment?.status === 'unreadable';

  if(els.waLink) els.waLink.href = whatsappUrl();
  if(els.reportDeliveryNote) els.reportDeliveryNote.style.display = leadConfirmed ? 'flex' : 'none';
  if(els.successState) els.successState.classList.toggle('delivery-unconfirmed', deliveryFailed);
  if(els.successEyebrow){
    els.successEyebrow.textContent = deliveryFailed
      ? 'Invio non confermato'
      : (leadConfirmed ? 'Richiesta presa in carico' : 'Stiamo confermando l’invio');
  }

  if(els.successDeliveryCopy){
    if(deliveryFailed){
      els.successDeliveryCopy.textContent = 'Il report preliminare è pronto, ma non siamo riusciti a confermare l’invio dei dati. Scrivici su WhatsApp: riceveremo subito il riepilogo del tuo scenario.';
    } else if(leadConfirmed && documentDelivered){
      els.successDeliveryCopy.textContent = 'Abbiamo preso in carico la tua richiesta e acquisito anche la bolletta. Riceverai un report tecnico più dettagliato, con priorità di intervento, dimensionamento e prossimi passi.';
    } else if(leadConfirmed && unreadablePrimary){
      els.successDeliveryCopy.textContent = 'Abbiamo preso in carico la richiesta. Il primo file non appare come una bolletta elettrica leggibile: carica qui una bolletta completa per affinare la verifica tecnica.';
    } else if(leadConfirmed && activeFile && !documentDelivered){
      els.successDeliveryCopy.textContent = 'Abbiamo preso in carico la tua richiesta. Stiamo confermando il documento: puoi riprovare il caricamento o continuare su WhatsApp.';
    } else if(leadConfirmed){
      els.successDeliveryCopy.textContent = 'Abbiamo preso in carico la tua richiesta. Riceverai un report tecnico più dettagliato, con priorità di intervento, dimensionamento e prossimi passi.';
    } else {
      els.successDeliveryCopy.textContent = 'Il tuo report preliminare è pronto. Stiamo confermando in sicurezza l’acquisizione della richiesta.';
    }
  }

  if(els.successState) els.successState.classList.toggle('has-document', documentDelivered);
  if(els.precisionUploadWrap){
    const primaryDocumentPending = !!primaryFile && state.fullReportStatus === null && !unreadablePrimary;
    const shouldShowUpgrade = !documentDelivered && !primaryDocumentPending && (state.reportGenerated || deliveryFailed || unreadablePrimary || state.retryUploadRequired);
    els.precisionUploadWrap.classList.toggle('show', shouldShowUpgrade);
  }

  if(documentDelivered){
    setRetryUploadVisible(false);
    setPrecisionUploadReceipt('Bolletta ricevuta e collegata alla preparazione del report tecnico dettagliato.', true);
  } else if(unreadablePrimary){
    setRetryUploadVisible(true);
    setPrecisionUploadReceipt('Il file non sembra una bolletta elettrica leggibile. Riprova con il documento integrale, nitido e con consumi visibili.', false);
  } else if(state.retryUploadRequired && activeFile){
    setPrecisionUploadReceipt('Invio non confermato. Riprova il caricamento della bolletta oppure inviala su WhatsApp.', false);
  }
}

function showSuccess(){
  if(els.stickyCta) els.stickyCta.hidden = true;
  if(els.contactBlock) els.contactBlock.style.display = 'none';
  if(els.contactSep) els.contactSep.style.display = 'none';
  if(els.billFirst) els.billFirst.classList.add('post-report-hidden');
  if(els.removeDoc) els.removeDoc.classList.add('post-report-hidden');
  if(els.successState){
    els.successState.classList.add('show');
    window.setTimeout(() => {
      safeScroll(els.successState, 'start');
      try { els.successState.focus({preventScroll:true}); } catch(error) { /* focus is a progressive enhancement */ }
    }, 100);
  }
  refreshDeliveryUi();
}

function markReportViewedWithoutBill(){
  if(els.precisionUploadWrap) els.precisionUploadWrap.classList.add('viewed-without-document');
  if(els.viewReportBtn){
    els.viewReportBtn.textContent = 'Report preliminare visualizzato';
    els.viewReportBtn.disabled = true;
  }
  trackLeadEvent('report_viewed_without_bill', { report: reportSnapshot() }, 'report-viewed-without-document')
    .catch(() => {});
  safeScroll(els.report, 'start');
}

async function submitPostReportBill(file){
  if(!file || !state.reportGenerated) return;
  const signature = fileSignature(file);
  if(state.postReportUploadInFlight || isDocumentDelivered(file)) return;

  state.postReportUploadInFlight = true;
  state.pendingFileSignature = signature;
  state.postReportFile = file;
  state.postReportAssessment = null;
  setRetryUploadVisible(false);
  setPrecisionControlsLocked(true);
  if(els.precisionUpload) els.precisionUpload.classList.add('ready');
  setPrecisionUploadReceipt('Verifichiamo che il documento sia una bolletta elettrica leggibile.', true);

  try {
    const assessment = await assessDocument(file, false);
    state.postReportAssessment = assessment;

    if(assessment.status === 'unreadable'){
      clearPrecisionInput();
      setRetryUploadVisible(true);
      setPrecisionUploadReceipt('Non riusciamo a leggere una bolletta elettrica in questo file. Riprova con la bolletta completa, nitida e con consumi visibili.', false);
      return;
    }
    if(assessment.status === 'error'){
      clearPrecisionInput();
      setRetryUploadVisible(true);
      setPrecisionUploadReceipt('Non riusciamo a leggere il documento. Riprova con una bolletta in PDF o foto nitida; in alternativa inviala su WhatsApp.', false);
      return;
    }

    const isTimedOut = assessment.status === 'timeout';
    setPrecisionUploadReceipt(
      isTimedOut
        ? 'Lettura automatica non completata in tempo: colleghiamo comunque il file alla verifica tecnica ECON.'
        : 'Bolletta riconosciuta. La stiamo collegando al report tecnico dettagliato.',
      true
    );
    await uploadDocument(file, assessment, 'post_report_upload', 'document-post-report-' + signature);
    markDocumentDelivered(file);
    state.fullReportStatus = true;
    setRetryUploadVisible(false);
    setPrecisionUploadReceipt(
      isTimedOut
        ? 'Documento ricevuto per la verifica tecnica. ECON completerà la lettura analitica nel report dettagliato.'
        : 'Bolletta ricevuta. La integriamo nella preparazione del report tecnico dettagliato.',
      true
    );
  } catch(error) {
    clearPrecisionInput();
    setRetryUploadVisible(true);
    setPrecisionUploadReceipt('Non abbiamo potuto confermare l’invio del documento. Riprova il caricamento oppure invialo su WhatsApp.', false);
  } finally {
    state.postReportUploadInFlight = false;
    state.pendingFileSignature = '';
    setPrecisionControlsLocked(false);
    refreshDeliveryUi();
  }
}

async function generateReportWithMinimumTime(fileSnapshot){
  const startedAt = Date.now();
  startProcessing();
  setStep('Acquisizione contatto', 18);
  await wait(850);

  setStep(fileSnapshot ? 'Lettura bolletta e dati energetici' : 'Analisi dell’indirizzo e della copertura', 42);
  let data;
  state.primaryDocumentAssessment = null;

  if(fileSnapshot){
    const assessment = await assessDocument(fileSnapshot, true);
    state.primaryDocumentAssessment = assessment;
    if(assessment.status === 'usable'){
      data = assessment.parsed;
      applySafeAutofill(data);
    } else if(assessment.status === 'unreadable'){
      data = makeFallback('Documento non idoneo: carica una bolletta elettrica completa e leggibile per analizzare i consumi.', null);
    } else if(assessment.status === 'timeout'){
      data = makeFallback('Lettura automatica non completata entro 18 secondi: report generato dalla verifica dell’indirizzo. Il file resta allegato per la verifica tecnica.', null);
    } else {
      data = makeFallback('Lettura bolletta non disponibile: avviamo comunque la verifica dell’indirizzo. Riprova con un PDF o una foto nitida della bolletta.', null);
    }
  } else {
    data = makeFallback('Nessuna bolletta caricata', null);
  }

  setStep('Dimensionamento preliminare FV + accumulo', 72);
  if(els.procMeta) els.procMeta.textContent = 'Costruiamo la verifica preliminare del tetto e lo scenario energetico dai dati disponibili.';
  await wait(850);
  setStep('Scenario energetico e report', 94);

  const remaining = CONFIG.MIN_PROCESS_MS - (Date.now() - startedAt);
  if(remaining > 0) await wait(remaining);

  setStep('Report preliminare pronto', 100);
  setReport(data);
  await wait(250);
  stopProcessing();
  return data;
}

function isSupportedFile(file){
  if(!file) return false;
  const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  const allowedExtension = /\.(pdf|jpe?g|png|webp)$/i.test(file.name || '');
  return allowedMime.has(String(file.type || '').toLowerCase()) || allowedExtension;
}

function clearNativeFileInputs(){
  if(els.bill) els.bill.value = '';
  if(els.precisionBill) els.precisionBill.value = '';
}

function resetDocument(){
  if(state.isGenerating){
    setHelp('La lettura è già in corso: attendi la generazione del report.', false);
    return;
  }
  cancelOcrResources();
  state.selectedFile = null;
  state.primaryDocumentAssessment = null;
  state.primaryDocumentReadInFlight = false;
  setBillOnlyUi(false);
  clearNativeFileInputs();
  els.uploadBox.classList.remove('ready');
  els.fileState.classList.remove('show');
  els.removeDoc.classList.remove('show');
  els.fileName.textContent = 'File caricato';
  els.fileMeta.textContent = 'Pronto per la lettura';
  if(els.precisionFileState) els.precisionFileState.classList.remove('show', 'is-error');
  setHelp('Bolletta rimossa. Puoi continuare con i dati manuali.', true);
  validate();
}

function describePrimaryAssessment(assessment){
  const parsed = assessment?.parsed || {};
  if(assessment?.status === 'usable'){
    const details = [];
    if(parsed.kwh) details.push(num(parsed.kwh) + (parsed.kwhScope === 'annuo' ? ' kWh/anno' : ' kWh rilevati'));
    if(parsed.amount) details.push(eur(parsed.amount) + ' rilevati');
    if(parsed.pod) details.push('POD rilevato');
    return 'Bolletta riconosciuta' + (details.length ? ' · ' + details.join(' · ') : '');
  }
  if(assessment?.status === 'timeout') return 'Lettura automatica non completata · puoi comunque inviare la bolletta a ECON senza compilare il form';
  if(assessment?.status === 'error') return 'Documento acquisito · ECON completerà la lettura tecnica senza richiedere il form manuale';
  return 'Il file non sembra una bolletta elettrica leggibile: prova un documento completo, nitido e con consumi visibili';
}

async function inspectPrimaryBill(file){
  const signature = fileSignature(file);
  state.primaryDocumentReadInFlight = true;
  state.primaryDocumentAssessment = null;
  setBillOnlyUi(false);
  els.fileMeta.textContent = 'Lettura automatica in corso: estraiamo consumi, importi e POD.';
  setHelp('Stiamo leggendo la bolletta. Non è necessario compilare il form manuale.', true);
  validate();

  const assessment = await assessDocument(file, false);
  if(!state.selectedFile || fileSignature(state.selectedFile) !== signature) return;

  state.primaryDocumentAssessment = assessment;
  state.primaryDocumentReadInFlight = false;
  const billRoute = ['usable', 'timeout', 'error'].includes(assessment.status);
  setBillOnlyUi(billRoute);

  if(assessment.status === 'usable'){
    applySafeAutofill(assessment.parsed);
    els.fileMeta.textContent = describePrimaryAssessment(assessment) + ' · report attivabile senza form.';
  } else if(billRoute){
    els.fileMeta.textContent = describePrimaryAssessment(assessment);
  } else {
    els.fileMeta.textContent = describePrimaryAssessment(assessment);
  }
  validate();
}

function handleFile(file){
  if(!file) return false;

  if(!isSupportedFile(file)){
    if(state.reportGenerated){
      clearPrecisionInput();
      setRetryUploadVisible(true);
      setPrecisionUploadReceipt('Formato non supportato. Carica una bolletta in PDF, JPG, PNG o WEBP.', false);
    } else setHelp('Formato non supportato. Usa PDF, JPG, PNG o WEBP.', false);
    return false;
  }
  if(file.size <= 0 || file.size > CONFIG.MAX_FILE_BYTES){
    const message = file.size <= 0
      ? 'Il documento risulta vuoto. Scegli un altro file.'
      : 'File troppo pesante. Carica PDF o foto sotto 7 MB.';
    if(state.reportGenerated){
      clearPrecisionInput();
      setRetryUploadVisible(true);
      setPrecisionUploadReceipt(message, false);
    } else setHelp(message, false);
    return false;
  }

  if(state.reportGenerated){
    state.postReportFile = file;
    if(els.precisionUploadWrap) els.precisionUploadWrap.classList.add('show');
    submitPostReportBill(file);
    return true;
  }

  cancelOcrResources();
  state.selectedFile = file;
  state.primaryDocumentAssessment = null;
  state.primaryDocumentReadInFlight = false;
  setBillOnlyUi(false);
  els.uploadBox.classList.add('ready');
  els.fileState.classList.add('show');
  els.removeDoc.classList.add('show');
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB · avvio lettura automatica';
  void inspectPrimaryBill(file);
  return true;
}

function updatePrimaryDocumentDelivery(file, status){
  if(status === true && file && state.primaryDocumentAssessment?.status !== 'unreadable'){
    markDocumentDelivered(file);
  }
  refreshDeliveryUi();
}

function attachFileDropZone(element, onFile){
  if(!element) return;
  ['dragenter', 'dragover'].forEach(type => {
    element.addEventListener(type, event => {
      event.preventDefault();
      event.stopPropagation();
      element.classList.add('ready');
    });
  });
  element.addEventListener('dragleave', () => {
    if(!state.selectedFile) element.classList.remove('ready');
  });
  element.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if(file) onFile(file);
  });
}

els.leadForm.addEventListener('submit', async event => {
  event.preventDefault();
  if(!validate() || state.submitted) return;

  state.submitted = true;
  state.isGenerating = true;
  els.hLeadTime.value = new Date().toISOString();
  els.hPhase.value = 'lead_requested';
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = 'Genero il report';
  updateStickyCta(false);
  setFileControlsLocked(true);
  setHelp('Stiamo preparando l’analisi e confermando l’invio della richiesta.', true);

  const fileSnapshot = state.selectedFile;
  const leadPromise = beginLeadCapture();

  try {
    await generateReportWithMinimumTime(fileSnapshot);
  } catch(error) {
    const safeFallback = makeFallback('Errore tecnico di elaborazione: scenario prudenziale generato', null);
    setReport(safeFallback);
    stopProcessing();
  } finally {
    state.isGenerating = false;
    setFileControlsLocked(false);
  }

  state.reportGenerated = true;
  showSuccess();

  trackLeadEvent('report_generated', { report: reportSnapshot() }, 'report-generated')
    .then(() => {
      state.fullReportStatus = true;
      refreshDeliveryUi();
    })
    .catch(() => {
      state.fullReportStatus = false;
      refreshDeliveryUi();
    });

  if(fileSnapshot && state.primaryDocumentAssessment?.status !== 'unreadable'){
    uploadDocument(
      fileSnapshot,
      state.primaryDocumentAssessment,
      'initial_report_upload',
      'document-initial-' + fileSignature(fileSnapshot)
    ).then(() => {
      updatePrimaryDocumentDelivery(fileSnapshot, true);
    }).catch(() => {
      updatePrimaryDocumentDelivery(fileSnapshot, false);
    });
  }

  void leadPromise;
});

if(els.manualRoute){
  els.manualRoute.addEventListener('click', () => {
    if(state.isGenerating || state.reportGenerated) return;
    safeScroll(els.contactBlock, 'start');
    window.setTimeout(() => {
      try { els.iaddress.focus({preventScroll:true}); } catch(error) { els.iaddress.focus(); }
    }, motion() === 'smooth' ? 420 : 0);
  });
}

if(els.viewReportBtn) els.viewReportBtn.addEventListener('click', markReportViewedWithoutBill);
if(els.waLink) els.waLink.addEventListener('click', () => {
  trackLeadEvent('whatsapp_opened', { report: reportSnapshot() }, 'whatsapp-opened').catch(() => {});
});
if(els.retryUploadBtn) els.retryUploadBtn.addEventListener('click', () => {
  if(state.postReportUploadInFlight) return;
  clearPrecisionInput();
  setPrecisionUploadReceipt('Scegli di nuovo una bolletta elettrica completa e leggibile.', false);
  try { els.precisionBill?.click(); } catch(error) { /* browser may block only if not user initiated */ }
});
if(els.stickySubmitBtn) els.stickySubmitBtn.addEventListener('click', () => {
  if(state.submitted) return;
  if(state.primaryDocumentReadInFlight){
    setHelp('Stiamo completando la lettura della bolletta: attendi qualche secondo.', true);
    safeScroll(els.fileState || els.billFirst, 'center');
    return;
  }
  if(validate()){
    if(typeof els.leadForm.requestSubmit === 'function') els.leadForm.requestSubmit(els.submitBtn);
    else els.submitBtn.click();
    return;
  }
  const firstInvalid = [els.iname, els.iphone, els.iaddress, els.iconsumptionvalue, els.iannualspend, els.iemail, els.privacy]
    .find(element => element && ((element.type === 'checkbox' && !element.checked) || (element.type !== 'checkbox' && !String(element.value || '').trim())));
  safeScroll(firstInvalid || els.contactBlock, 'center');
  window.setTimeout(() => {
    try { firstInvalid?.focus({preventScroll:true}); } catch(error) { firstInvalid?.focus(); }
  }, motion() === 'smooth' ? 350 : 0);
});
if(els.removeDoc) els.removeDoc.addEventListener('click', resetDocument);
if(els.bill) els.bill.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if(file) handleFile(file);
});
if(els.precisionBill) els.precisionBill.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if(file) handleFile(file);
});

attachFileDropZone(els.uploadBox, handleFile);
attachFileDropZone(els.precisionUpload, handleFile);

['iname', 'iphone', 'iaddress', 'iconsumptionvalue', 'iannualspend', 'iemail'].forEach(id => {
  const element = $(id);
  if(element) element.addEventListener('input', validate);
});
if(els.privacy) els.privacy.addEventListener('change', validate);
validate();

window.addEventListener('beforeunload', cancelOcrResources);
})();
