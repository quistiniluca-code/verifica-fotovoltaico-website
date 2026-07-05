/*
 * ECON bill parser v10
 * Local-only structured extraction. The full bill text is never sent to Functions,
 * Database or Blobs metadata: only validated technical fields are exposed.
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
      .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|srls)\b/gi, match => match.toUpperCase());
  }

  function result(value, confidence, source) {
    return { value, confidence, source };
  }

  function empty(source) {
    return result('', 0, source || 'not_found');
  }

  function normalizePositive(value, min, max) {
    const parsed = italianNumber(value);
    return parsed >= min && parsed <= max ? parsed : 0;
  }

  function valueMatch(text, patterns, min, max, confidence, source, round) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      let value = normalizePositive(match[1] || '', min, max);
      if (round && value) value = Math.round(value);
      if (value) return result(value, confidence, source);
    }
    return result(0, 0, 'not_found');
  }

  function extractAnnualKwh(text) {
    return valueMatch(text, [
      /(?:il\s+tuo\s+)?(?:consumo|consumi)\s+annuo(?:\s+aggiornato)?\s*\(\s*kwh\s*\)\s*[:\-]?\s*([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})/i,
      /(?:il\s+tuo\s+)?(?:consumo|consumi)\s+annuo(?:\s+aggiornato)?(?:\s+al\s+seguente\s+periodo)?[\s\S]{0,180}?([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})\s*kwh(?:\s*\/\s*anno)?\b/i,
      /(?:consumo|consumi)\s+annui?\s*[:\-]?[\s\S]{0,100}?([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})\s*kwh(?:\s*\/\s*anno)?\b/i,
      /in\s+un\s+anno\s+hai\s+consumato\s*([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})\s*kwh\b/i,
      /(?:ultimi\s+12\s+mesi|12\s+mesi)[\s\S]{0,100}?([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})\s*kwh\b/i
    ], 100, 500000, 98, 'annual_label', true);
  }

  function extractAnnualSpend(text) {
    return valueMatch(text, [
      /(?:totale\s+)?spesa\s+annua(?:le)?(?:\s+sostenuta)?\s*[:\-]?[\s\S]{0,180}?(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{2,8},[0-9]{2})\s*(?:€|eur\b)/i,
      /(?:costo\s+annuo|spesa\s+per\s+l['’]anno)[\s\S]{0,180}?(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{2,8},[0-9]{2})\s*(?:€|eur\b)/i
    ], 25, 100000, 98, 'annual_label', false);
  }

  function extractPeriodKwh(text) {
    return valueMatch(text, [
      /(?:consumo\s+totale\s+fatturato(?:\s+del\s+periodo)?|consumo\s+fatturato|consumo\s+del\s+periodo|consumi\s+fatturati|energia\s+prelevata)[\s\S]{0,100}?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]+)?|[0-9]{1,6})\s*kwh\b/i
    ], 1, 500000, 84, 'period_label', true);
  }

  function extractPeriodAmount(text) {
    return valueMatch(text, [
      /(?:totale\s+(?:da\s+pagare|bolletta|fattura|documento)|importo\s+(?:totale|da\s+pagare)|questo\s+mese\s+dovrai\s+pagare)[\s\S]{0,60}?(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{1,7},[0-9]{2})\s*(?:€|eur\b|euro\b)?/i
    ], 1, 100000, 90, 'period_total', false);
  }

  function extractPod(text) {
    const match = text.match(/\bIT[0-9A-Z]{10,20}\b/i);
    return match ? result(match[0].toUpperCase(), 99, 'pod_pattern') : empty('not_found');
  }

  function safePersonName(value) {
    const candidate = compact(value)
      .replace(/\b(?:codice|indirizzo|pod|pdr|offerta|consumo|spesa|mercato|fornitura|fattura|bolletta|periodo|potenza|totale)\b.*$/i, '')
      .replace(/[^A-Za-zÀ-ÿ0-9'’.\- ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = candidate.split(' ').filter(Boolean);
    const hasBusinessMarker = /\b(srl|s\.r\.l|spa|s\.p\.a|sas|snc|srls)\b/i.test(candidate);
    if ((words.length < 2 && !hasBusinessMarker) || candidate.length < 5 || candidate.length > 80) return '';
    if (/\b(energia|elettrica|fornitura|bolletta|fattura|totale|pagare|consumo|mercato)\b/i.test(candidate)) return '';
    return titleCase(candidate);
  }

  function extractFullName(raw) {
    const patterns = [
      /(?:intestatario(?:\s+(?:del\s+)?contratto|\s+(?:della\s+)?fornitura|\s+fornitura)?|intestata\s+a|contratto\s+intestato\s+a|nominativo|cliente\s+finale|titolare|ragione\s+sociale|denominazione)\s*[:\-]?\s*\n?\s*([^\n]{5,90})/i,
      /i\s+tuoi\s+dati\s*(?:identificativi)?\s*\n?\s*([A-ZÀ-Ý][A-ZÀ-Ý'’.\- ]{4,90}?)(?=\s*(?:\n| )\s*(?:indirizzo|codice)\b)/i,
      /dati\s+cliente[\s\S]{0,160}?\n\s*([A-ZÀ-Ý][A-ZÀ-Ý0-9'’.\- ]{4,90})\n\s*(?:via|viale|piazza|corso|strada)\b/i,
      /dati\s+fattura[\s\S]{0,180}?\n\s*([A-ZÀ-Ý][A-ZÀ-Ý0-9'’.\- ]{4,90})\n\s*(?:via|viale|piazza|corso|strada)\b/i
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(raw);
      const name = safePersonName(match?.[1] || '');
      if (name) return result(name, 88, 'labelled_person');
    }
    return empty('not_found');
  }

  function cleanAddress(value) {
    return compact(value)
      .replace(/\s+\b(?:pod|pdr|codice|consumo|spesa|offerta|potenza|totale|cliente|fornitura|periodo)\b[\s\S]*$/i, '')
      .replace(/[;,\-\s]+$/, '')
      .trim();
  }

  function findAddress(text) {
    const patterns = [
      /((?:via|viale|piazza|corso|largo|vicolo|strada|località|loc\.)\s+[A-Za-zÀ-ÿ0-9'’.,\- ]{3,120}?\s+\b\d{5}\b\s+[A-Za-zÀ-ÿ'’\- ]{2,48}\s*(?:\([A-Za-z]{2}\)|[A-Za-z]{2}))/i,
      /([A-Za-zÀ-ÿ'’.,\- ]{4,80},?\s*\d{1,4}[A-Za-z]?\s*,?\s*\b\d{5}\b\s+[A-Za-zÀ-ÿ'’\- ]{2,48}\s*(?:\([A-Za-z]{2}\)|[A-Za-z]{2}))/i
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      const value = cleanAddress(match?.[1] || '');
      if (value && /\d{5}/.test(value)) return value;
    }
    return '';
  }

  function extractFullAddress(raw) {
    const labelled = /(?:indirizzo\s+(?:di\s+)?(?:fornitura|punto\s+di\s+fornitura|fatturazione)|servizio\s+fornito\s+in)\s*[:\-]?\s*([\s\S]{0,240}?)(?=\b(?:codice\s+(?:fiscale|cliente|pod)|potenza|offerta|consumo\s+annuo|altre\s+informazioni|scontrino)\b|$)/i.exec(raw);
    const labelledValue = labelled?.[1] ? findAddress(labelled[1]) : '';
    const fallback = findAddress(raw);
    const value = labelledValue || fallback;
    return value ? result(value, labelledValue ? 93 : 78, labelledValue ? 'labelled_address' : 'address_pattern') : empty('not_found');
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
    const fullAddress = extractFullAddress(raw);
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
      source: 'local_parser_v10',
      text: isBill ? 'Lettura locale completata: nel lead vengono conservati solo dati tecnici strutturati, non il testo integrale della bolletta.' : ''
    };
  }

  global.EconBillParserV9 = Object.freeze({ parse, italianNumber, compact });
})(window);
