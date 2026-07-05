/*
 * ECON bill parser v9
 * Local-only extraction from user-selected bills. It returns structured, minimal data;
 * it does not keep or transmit the full document text.
 */
(function attachEconBillParser(global) {
  'use strict';

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function italianNumber(value) {
    let raw = String(value || '').replace(/\s+/g, '').replace(/€/g, '').replace(/eur/ig, '').trim();
    if (!raw) return 0;
    raw = raw.replace(/[^\d,.-]/g, '');
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');
    if (comma !== -1 && dot !== -1) {
      raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (comma !== -1) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (dot !== -1 && raw.slice(dot + 1).length === 3) {
      raw = raw.replace(/\./g, '');
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  }

  function titleCase(value) {
    return compact(value).toLocaleLowerCase('it-IT')
      .replace(/\b([a-zà-ÿ])/g, character => character.toLocaleUpperCase('it-IT'))
      .replace(/\b(s\.r\.l\.?|s\.p\.a\.?|s\.a\.s\.?|s\.n\.c\.?)\b/gi, match => match.toUpperCase());
  }

  function result(value, confidence, source) {
    return { value, confidence, source };
  }

  function empty(source) {
    return result('', 0, source || 'not_found');
  }

  function firstMatch(text, patterns, normalizer, confidence, source) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      const value = normalizer(match[1] || '');
      if (value) return result(value, confidence, source);
    }
    return empty(source);
  }

  function extractAnnualKwh(text) {
    const patterns = [
      /(?:consumo|consumi)\s+annuo(?:\s+aggiornato)?\s*[:\-]?\s*([0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{2,7})\s*kwh\b/i,
      /(?:consumo|consumi)\s+annuali?\s*[:\-]?\s*([0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{2,7})\s*kwh\b/i,
      /(?:ultimi\s+12\s+mesi|12\s+mesi)\s*[:\-]?\s*([0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{2,7})\s*kwh\b/i
    ];
    const found = firstMatch(text, patterns, value => Math.round(italianNumber(value)), 96, 'annual_label');
    return typeof found.value === 'number' && found.value >= 100 && found.value <= 500000 ? found : result(0, 0, 'not_found');
  }

  function extractAnnualSpend(text) {
    const patterns = [
      /(?:spesa\s+annua(?:le)?(?:\s+sostenuta)?|costo\s+annuo|spesa\s+per\s+l['’]anno)\s*[:\-]?\s*(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{2,8},[0-9]{2})\s*(?:€|eur\b)?/i,
      /(?:spesa\s+annua(?:le)?(?:\s+sostenuta)?|costo\s+annuo|spesa\s+per\s+l['’]anno)[\s\S]{0,100}?(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{2,8},[0-9]{2})\s*(?:€|eur\b)/i
    ];
    const found = firstMatch(text, patterns, italianNumber, 96, 'annual_label');
    return typeof found.value === 'number' && found.value >= 25 && found.value <= 100000 ? found : result(0, 0, 'not_found');
  }

  function extractPeriodKwh(text) {
    const match = /(?:consumo\s+(?:del\s+)?periodo|energia\s+prelevata|consumi\s+fatturati)[\s\S]{0,80}?([0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{1,6})\s*kwh\b/i.exec(text);
    const value = match ? Math.round(italianNumber(match[1])) : 0;
    return value >= 1 && value <= 500000 ? result(value, 74, 'period_label') : result(0, 0, 'not_found');
  }

  function extractPeriodAmount(text) {
    const match = /(?:totale\s+(?:da\s+pagare|bolletta|fattura|documento)|importo\s+(?:totale|da\s+pagare)|da\s+pagare)\s*[:\-]?\s*(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{1,7},[0-9]{2})\s*(?:€|eur\b)?/i.exec(text);
    const value = match ? italianNumber(match[1]) : 0;
    return value >= 1 && value <= 100000 ? result(value, 84, 'period_total') : result(0, 0, 'not_found');
  }

  function extractPod(text) {
    const match = text.match(/\bIT[0-9A-Z]{12,18}\b/i);
    return match ? result(match[0].toUpperCase(), 99, 'pod_pattern') : empty('not_found');
  }

  function safePersonName(value) {
    const candidate = compact(value)
      .replace(/\b(?:codice|indirizzo|pod|pdr|offerta|consumo|spesa|mercato|fornitura|fattura|bolletta)\b.*$/i, '')
      .replace(/[^A-Za-zÀ-ÿ'’.\- ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = candidate.split(' ').filter(Boolean);
    const hasBusinessMarker = /\b(srl|s\.r\.l|spa|s\.p\.a|sas|snc)\b/i.test(candidate);
    if ((words.length < 2 && !hasBusinessMarker) || candidate.length < 5 || candidate.length > 80) return '';
    if (/\b(energia|elettrica|fornitura|bolletta|fattura|totale|pagare|consumo)\b/i.test(candidate)) return '';
    return titleCase(candidate);
  }

  function extractFullName(raw) {
    const patterns = [
      /(?:intestatario(?:\s+(?:del\s+)?contratto|\s+(?:della\s+)?fornitura|\s+fornitura)?|nominativo|cliente\s+finale|titolare|ragione\s+sociale|denominazione)\s*[:\-]?\s*([^\n]{5,90})/i,
      /i\s+tuoi\s+dati\s*\n\s*([A-ZÀ-Ý][A-ZÀ-Ý'’.\- ]{4,90})\s*\n\s*(?:indirizzo|codice)/i
    ];
    return firstMatch(raw, patterns, safePersonName, 86, 'labelled_person');
  }

  function cleanAddress(value) {
    return compact(value)
      .replace(/\s+\b(?:pod|pdr|codice|consumo|spesa|offerta|potenza|totale|cliente|fornitura)\b[\s\S]*$/i, '')
      .replace(/[;,\-\s]+$/, '')
      .trim();
  }

  function extractFullAddress(text) {
    const addressPattern = /((?:via|viale|piazza|corso|largo|vicolo|strada|località|loc\.)\s+[A-Za-zÀ-ÿ0-9'’.,\- ]{3,110}?\s+\b\d{5}\b\s+[A-Za-zÀ-ÿ'’\- ]{2,48}\s*(?:\([A-Za-z]{2}\)|[A-Za-z]{2}))/i;
    const labels = /(?:indirizzo\s+(?:di\s+)?(?:fornitura|punto\s+di\s+fornitura|fatturazione)|indirizzo\s+fornitura)\s*[:\-]?\s*([\s\S]{0,220}?)(?=\b(?:codice\s+(?:fiscale|cliente|pod)|potenza|offerta|consumo\s+annuo|altre\s+informazioni)\b|$)/i.exec(text);
    const labelled = labels?.[1] ? labels[1].match(addressPattern) : null;
    const fallback = text.match(addressPattern);
    const match = labelled || fallback;
    const value = match ? cleanAddress(match[1]) : '';
    return value ? result(value, labelled ? 93 : 76, labelled ? 'labelled_address' : 'address_pattern') : empty('not_found');
  }

  function billSignal(text) {
    const normalized = compact(text).toLowerCase();
    const words = ['bolletta', 'fattura', 'energia elettrica', 'fornitura', 'pod', 'kwh', 'contatore', 'mercato libero', 'servizio elettrico', 'totale da pagare'];
    return words.reduce((total, word) => total + (normalized.includes(word) ? 1 : 0), 0);
  }

  function parse(rawText) {
    const raw = String(rawText || '').replace(/\r/g, '\n');
    const flattened = compact(raw);
    const annualKwh = extractAnnualKwh(flattened);
    const annualSpend = extractAnnualSpend(flattened);
    const periodKwh = extractPeriodKwh(flattened);
    const periodAmount = extractPeriodAmount(flattened);
    const pod = extractPod(flattened);
    const fullName = extractFullName(raw);
    const fullAddress = extractFullAddress(flattened);
    const signal = billSignal(flattened);
    const isBill = signal >= 2 && Boolean(annualKwh.value || annualSpend.value || periodKwh.value || periodAmount.value || pod.value);

    return {
      isBill,
      billSignal: signal,
      annualKwh,
      annualSpend,
      periodKwh,
      periodAmount,
      pod,
      fullName,
      fullAddress,
      source: 'local_parser_v9',
      text: isBill ? 'Lettura locale completata: nel lead vengono conservati solo dati tecnici strutturati, non il testo integrale della bolletta.' : ''
    };
  }

  global.EconBillParserV9 = Object.freeze({ parse, italianNumber, compact });
})(window);
