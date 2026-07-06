/* ECON bill parser v10 — structured local extraction only. */
(function attachEconBillParser(global) {
  'use strict';

  const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
  const result = (value, confidence, source) => ({ value, confidence, source });
  const empty = () => result('', 0, 'not_found');

  function italianNumber(value) {
    let raw = String(value || '').replace(/\s+/g, '').replace(/€/g, '').replace(/eur/ig, '').trim();
    if (!raw) return 0;
    raw = raw.replace(/[^\d,.-]/g, '');
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');
    if (comma !== -1 && dot !== -1) raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    else if (comma !== -1) raw = raw.replace(/\./g, '').replace(',', '.');
    else if (dot !== -1 && raw.slice(dot + 1).length === 3) raw = raw.replace(/\./g, '');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  }

  function titleCase(value) {
    return compact(value).toLocaleLowerCase('it-IT')
      .replace(/\b([a-zà-ÿ])/g, character => character.toLocaleUpperCase('it-IT'))
      .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|srls)\b/gi, value => value.toUpperCase());
  }

  function labelledNumber(text, patterns, min, max, round) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      let value = italianNumber(match[1]);
      if (value < min || value > max) continue;
      if (round) value = Math.round(value);
      return result(value, 98, 'annual_or_period_label');
    }
    return result(0, 0, 'not_found');
  }

  function extractAnnualKwh(text) {
    return labelledNumber(text, [
      /(?:il\s+tuo\s+)?(?:consumo|consumi)\s+annuo(?:\s+aggiornato)?\s*\(\s*kwh\s*\)\s*[:\-]?\s*([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})/i,
      /(?:il\s+tuo\s+)?(?:consumo|consumi)\s+annuo(?:\s+aggiornato)?(?:\s+al\s+seguente\s+periodo)?[\s\S]{0,180}?([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})\s*kwh(?:\s*\/\s*anno)?\b/i,
      /(?:consumo|consumi)\s+annui?\s*[:\-]?[\s\S]{0,100}?([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})\s*kwh(?:\s*\/\s*anno)?\b/i,
      /in\s+un\s+anno\s+hai\s+consumato\s*([0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]+)?|[0-9]{3,7})\s*kwh\b/i
    ], 100, 500000, true);
  }

  function extractAnnualSpend(text) {
    return labelledNumber(text, [
      /(?:totale\s+)?spesa\s+annua(?:le)?(?:\s+sostenuta)?\s*[:\-]?[\s\S]{0,180}?(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{2,8},[0-9]{2})\s*(?:€|eur\b)/i,
      /(?:costo\s+annuo|spesa\s+per\s+l['’]anno)[\s\S]{0,180}?(?:€\s*)?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})?|[0-9]{2,8},[0-9]{2})\s*(?:€|eur\b)/i
    ], 25, 100000, false);
  }

  function extractPeriodKwh(text) {
    return labelledNumber(text, [
      /(?:consumo\s+totale\s+fatturato(?:\s+del\s+periodo)?|consumo\s+fatturato|consumo\s+del\s+periodo|consumi\s+fatturati|energia\s+prelevata)[\s\S]{0,100}?([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]+)?|[0-9]{1,6})\s*kwh\b/i
    ], 1, 500000, true);
  }

  function extractPeriodAmount(text) {
    return labelledNumber(text, [
      /(?:\btotale\s+(?:da\s+pagare|bolletta\b|fattura\b|documento\b)|\bimporto\s+(?:totale\b|da\s+pagare)|\bquesto\s+mese\s+dovrai\s+pagare)\s*[:\-]?\s*(?:€\s*)?((?:[0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{1,7})(?:,[0-9]{2})?)\s*(?:€|eur\b|euro\b)?/i
    ], 1, 100000, false);
  }

  function extractPod(text) {
    const match = text.match(/\bIT[0-9A-Z]{10,20}\b/i);
    return match ? result(match[0].toUpperCase(), 99, 'pod_pattern') : empty();
  }

  function cleanName(value) {
    const candidate = compact(value)
      .replace(/\b(?:codice|indirizzo|pod|pdr|offerta|consumo|spesa|mercato|fornitura|fattura|bolletta|periodo|potenza|totale)\b.*$/i, '')
      .replace(/[^A-Za-zÀ-ÿ0-9'’.\- ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const words = candidate.split(' ').filter(Boolean);
    const company = /\b(srl|s\.r\.l|spa|s\.p\.a|sas|snc|srls)\b/i.test(candidate);
    return ((words.length >= 2 || company) && candidate.length >= 5 && candidate.length <= 80) ? titleCase(candidate) : '';
  }

  function extractFullName(raw) {
    const patterns = [
      /(?:intestatario(?:\s+(?:del\s+)?contratto|\s+(?:della\s+)?fornitura|\s+fornitura)?|intestata\s+a|contratto\s+intestato\s+a|nominativo|cliente\s+finale|titolare|ragione\s+sociale|denominazione)\s*[:\-]?\s*\n?\s*([^\n]{5,90})/i,
      /i\s+tuoi\s+dati\s*(?:identificativi)?\s*\n?\s*([A-ZÀ-Ý][A-ZÀ-Ý'’.\- ]{4,90}?)(?=\s*(?:\n| )\s*(?:indirizzo|codice)\b)/i,
      /i\s+tuoi\s+dati\s+identificativi\s*\n\s*([^\n]{5,90})/i,
      /dati\s+(?:cliente|fattura)[\s\S]{0,160}?\n\s*([A-ZÀ-Ý][A-ZÀ-Ý0-9'’.\- ]{4,90})\n\s*(?:via|viale|piazza|corso|strada)\b/i
    ];
    for (const pattern of patterns) {
      const name = cleanName(pattern.exec(raw)?.[1] || '');
      if (name) return result(name, 88, 'labelled_person');
    }
    return empty();
  }

  function findAddress(text) {
    const patterns = [
      /((?:via|viale|piazza|corso|largo|vicolo|strada|località|loc\.)\s+[A-Za-zÀ-ÿ0-9'’.,\- ]{3,120}?\s+\b\d{5}\b\s+[A-Za-zÀ-ÿ'’\- ]{2,48}\s*(?:\([A-Za-z]{2}\)|[A-Za-z]{2}))/i,
      /([A-Za-zÀ-ÿ'’.,\- ]{4,80},?\s*\d{1,4}[A-Za-z]?\s*,?\s*\b\d{5}\b\s+[A-Za-zÀ-ÿ'’\- ]{2,48}\s*(?:\([A-Za-z]{2}\)|[A-Za-z]{2}))/i
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      const value = compact(match?.[1] || '').replace(/[;,\-\s]+$/, '');
      if (value && /\d{5}/.test(value)) return value;
    }
    return '';
  }

  function extractFullAddress(raw) {
    const label = /(?:indirizzo\s+(?:di\s+)?(?:fornitura|punto\s+di\s+fornitura|fatturazione)|servizio\s+fornito\s+in)\s*[:\-]?\s*([\s\S]{0,240}?)(?=\b(?:codice\s+(?:fiscale|cliente|pod)|potenza|offerta|consumo\s+annuo|altre\s+informazioni|scontrino)\b|$)/i.exec(raw);
    const value = (label && findAddress(label[1])) || findAddress(raw);
    return value ? result(value, label ? 93 : 78, label ? 'labelled_address' : 'address_pattern') : empty();
  }

  function parse(rawText) {
    const raw = String(rawText || '').replace(/\r/g, '\n');
    const text = compact(raw);
    const annualKwh = extractAnnualKwh(text);
    const annualSpend = extractAnnualSpend(text);
    const periodKwh = extractPeriodKwh(text);
    const periodAmount = extractPeriodAmount(text);
    const pod = extractPod(text);
    const signalWords = ['bolletta', 'fattura', 'energia elettrica', 'fornitura', 'pod', 'kwh', 'totale da pagare'];
    const billSignal = signalWords.filter(word => text.toLowerCase().includes(word)).length;
    return {
      isBill: billSignal >= 2 && Boolean(annualKwh.value || annualSpend.value || periodKwh.value || periodAmount.value || pod.value),
      billSignal,
      annualKwh,
      annualSpend,
      periodKwh,
      periodAmount,
      pod,
      fullName: extractFullName(raw),
      fullAddress: extractFullAddress(raw),
      source: 'local_parser_v10',
      text: 'Lettura locale completata: vengono conservati solo dati tecnici strutturati, non il testo integrale della bolletta.'
    };
  }

  global.EconBillParserV9 = Object.freeze({ parse, italianNumber, compact });
})(window);
