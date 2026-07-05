(() => {
  'use strict';

  const FILE_INPUT_ID = 'bill';
  const LEAD_ENDPOINT = '/.netlify/functions/lead-intake';
  const MAX_PDF_PAGES = 4;
  const state = { file: null, result: null, pending: Promise.resolve(null) };

  const byId = id => document.getElementById(id);
  const normalizeSpace = value => String(value || '').replace(/\s+/g, ' ').trim();

  function italianNumber(value) {
    let raw = String(value || '').replace(/\s+/g, '').replace(/€/g, '').trim();
    if (!raw) return 0;
    raw = raw.replace(/[^\d,.-]/g, '');
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');
    if (comma !== -1 && dot !== -1) {
      raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (comma !== -1) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (dot !== -1) {
      const tail = raw.slice(dot + 1);
      if (tail.length === 3) raw = raw.replace(/\./g, '');
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function titleCase(value) {
    return normalizeSpace(value).toLocaleLowerCase('it-IT')
      .replace(/\b([a-zà-ÿ])/g, letter => letter.toLocaleUpperCase('it-IT'));
  }

  function cleanName(value) {
    const candidate = normalizeSpace(value).replace(/\b(?:codice|indirizzo|pod|pdr|offerta|consumo|spesa|mercato|fornitura)\b.*$/i, '').trim();
    const words = candidate.split(' ').filter(Boolean);
    return words.length >= 2 && candidate.length <= 80 ? titleCase(candidate) : '';
  }

  function extractName(raw) {
    const patterns = [
      /(?:intestatario(?:\s+(?:contratto|fornitura))?|nominativo|cliente\s+finale|titolare)\s*[:\-]?\s*([^\n]{5,90})/i,
      /i\s+tuoi\s+dati\s*\n\s*([A-ZÀ-Ý][A-ZÀ-Ý'’\- ]{4,90})\s*\n\s*(?:indirizzo|codice)/i
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      const name = match ? cleanName(match[1]) : '';
      if (name) return name;
    }
    return '';
  }

  function extractAddress(flat) {
    const address = /((?:via|viale|piazza|corso|largo|vicolo|strada|località|loc\.)\s+[A-Za-zÀ-ÿ0-9'’.,\- ]{3,100}?\s+\b\d{5}\b\s+[A-Za-zÀ-ÿ'’\- ]{2,48}\s*(?:\([A-Za-z]{2}\)|[A-Za-z]{2}))/i;
    const labelled = /(?:indirizzo\s+(?:di\s+)?(?:fornitura|punto\s+di\s+fornitura|fatturazione)|indirizzo\s+fornitura)\s*[:\-]?\s*([\s\S]{0,220}?)(?=\b(?:codice\s+(?:fiscale|cliente|pod)|potenza|offerta|consumo\s+annuo|altre\s+informazioni)\b|$)/i.exec(flat);
    const labelledAddress = labelled && labelled[1] ? labelled[1].match(address) : null;
    const fallback = flat.match(address);
    return normalizeSpace((labelledAddress || fallback || [])[1] || '');
  }

  function extractAnnualKwh(flat) {
    const match = /(?:consumo\s+annuo(?:\s+aggiornato)?|consumo\s+annuale|consumi\s+annui)[\s\S]{0,180}?([0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{2,7})\s*kwh\b/i.exec(flat);
    return match ? Math.round(italianNumber(match[1])) : 0;
  }

  function extractAnnualSpend(flat) {
    const match = /(?:spesa\s+annua(?:le)?(?:\s+sostenuta)?|costo\s+annuo)[\s\S]{0,220}?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{2,8},[0-9]{2})\s*(?:€|eur)\b/i.exec(flat);
    return match ? italianNumber(match[1]) : 0;
  }

  function extractPod(flat) {
    const match = flat.match(/\bIT[0-9A-Z]{12,18}\b/i);
    return match ? match[0].toUpperCase() : '';
  }

  function parseBillText(raw) {
    const flat = normalizeSpace(raw);
    return {
      fullName: extractName(raw),
      fullAddress: extractAddress(flat),
      annualKwh: extractAnnualKwh(flat),
      annualSpend: extractAnnualSpend(flat),
      pod: extractPod(flat)
    };
  }

  async function waitForPdfJs() {
    const deadline = Date.now() + 5000;
    while (!window.pdfjsLib && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    return window.pdfjsLib || null;
  }

  async function readPdfText(file) {
    const pdfjs = await waitForPdfJs();
    if (!pdfjs) return '';
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    }
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    let pdf;
    try {
      pdf = await loadingTask.promise;
      let text = '';
      for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PDF_PAGES); pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      return text;
    } finally {
      if (pdf && typeof pdf.destroy === 'function') pdf.destroy();
      if (loadingTask && typeof loadingTask.destroy === 'function') loadingTask.destroy();
    }
  }

  function setIfEmpty(id, value) {
    const element = byId(id);
    if (!element || !value || String(element.value || '').trim()) return;
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function apply(result) {
    if (!result) return;
    setIfEmpty('iname', result.fullName);
    setIfEmpty('iaddress', result.fullAddress);
    setIfEmpty('iconsumptionvalue', result.annualKwh || '');
    setIfEmpty('iannualspend', result.annualSpend ? result.annualSpend.toFixed(2).replace('.', ',') : '');
  }

  async function enrich(file) {
    if (!file || !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return null;
    const text = await readPdfText(file);
    const result = parseBillText(text);
    state.file = file;
    state.result = result;
    apply(result);
    return result;
  }

  function selectedInitialFile() {
    const input = byId(FILE_INPUT_ID);
    return input && input.files ? input.files[0] || null : null;
  }

  function beginEnrichment(file) {
    state.pending = enrich(file).catch(() => null);
    return state.pending;
  }

  function enrichPayload(payload) {
    const result = state.result;
    if (!result || !payload || typeof payload !== 'object') return payload;
    const contact = payload.contact && typeof payload.contact === 'object' ? payload.contact : {};
    payload.contact = contact;
    contact.fullName = contact.fullName || result.fullName || '';
    contact.fullAddress = contact.fullAddress || result.fullAddress || '';
    contact.energy = contact.energy && typeof contact.energy === 'object' ? contact.energy : {};
    contact.energy.annualKwh = Number(contact.energy.annualKwh || 0) || result.annualKwh || 0;
    contact.energy.annualSpend = Number(contact.energy.annualSpend || 0) || result.annualSpend || 0;
    contact.document = contact.document && typeof contact.document === 'object' ? contact.document : {};
    contact.document.annualSpend = result.annualSpend || 0;
    contact.document.kwh = Number(contact.document.kwh || 0) || result.annualKwh || 0;
    contact.document.kwhScope = result.annualKwh ? 'annuo' : (contact.document.kwhScope || 'non_disponibile');
    contact.document.pod = contact.document.pod || result.pod || '';
    return payload;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isLeadIntake = /\/\.netlify\/functions\/lead-intake(?:$|[?#])/.test(url);
    if (!isLeadIntake || !init || typeof init.body !== 'string') return originalFetch(input, init);

    const file = selectedInitialFile();
    if (file && file !== state.file) beginEnrichment(file);
    await state.pending;

    try {
      const payload = enrichPayload(JSON.parse(init.body));
      return originalFetch(input, { ...init, body: JSON.stringify(payload) });
    } catch {
      return originalFetch(input, init);
    }
  };

  const input = byId(FILE_INPUT_ID);
  if (input) {
    input.addEventListener('change', () => {
      const file = selectedInitialFile();
      if (file) beginEnrichment(file);
    });
  }
})();
