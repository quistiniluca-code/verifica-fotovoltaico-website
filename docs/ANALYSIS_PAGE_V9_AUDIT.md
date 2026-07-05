# ECON — Audit v9: Analisi preliminare energetica

## Scope
Pagina istituzionale: autorevolezza, utilità reale, qualità del segnale commerciale e continuità con la verifica tecnica ECON. Non è una landing advertising.

## Stato verificato
- `main` è pubblicato e contiene il flusso statico + Functions Netlify.
- La PR #1 non è un candidato di merge: aggiunge un parser parallelo lato client, intercetta `fetch`, richiede una Edge Function per iniettare asset e non modifica il parser che alimenta il report.

## P0 — prima della prossima release
1. Consolidare parsing bollette nel parser sorgente `public/assets/app.js` o in un modulo dedicato importato direttamente dalla pagina; eliminare parser paralleli e monkey-patch di `window.fetch`.
2. Estrarre separatamente `annualKwh`, `annualSpend`, `pod`, `fullName`, `fullAddress` e relativi livelli di confidenza.
3. Fare usare al report la spesa annua estratta quando affidabile; non annualizzare il totale della singola bolletta con coefficienti fissi.
4. Versionare o non marcare `immutable` i file JS/CSS funzionali: l'app usa nomi asset stabili e deve evitare client stale dopo un deploy.
5. Aggiungere test di accettazione per PDF nativi, bollette scansite, OCR fallito e percorso manuale.
6. Verificare nel Deploy Preview database, Blobs e lead intake al click CTA.

## P1 — dopo P0
1. CTA e report: linguaggio "analisi preliminare" e "scenario da verificare", senza promesse economiche implicite.
2. Rendere la bolletta la via consigliata e il form manuale una vera alternativa progressiva.
3. Caricare OCR pesante solo al bisogno e valutare integrità degli asset terzi.
4. Sostituire il font con Arimo e rimuovere preview non pubblicabili dal percorso `public`.
5. Rendere espliciti gli stati: analysis_started, document_received, report_generated, contact_opted_in, qualified, consultation_requested.

## P2 — evoluzione
- Dashboard commerciale e coda follow-up.
- Segmentazione Casa / Azienda / Condominio come scelta non bloccante.
- Tracking funnel e confronto testato tra pagina istituzionale e landing advertising dedicate.

## Acceptance criteria release v9
- I PDF Gritti e Octopus estraggono valori annui corretti senza usare importi mensili come spesa annua.
- Il report presenta solo dati rilevati o stime chiaramente etichettate.
- Il lead non viene dichiarato acquisito finché `lead-intake` non risponde con successo.
- Il percorso bolletta non richiede il form manuale.
- I record database e i documenti Blob sono creati e collegati con idempotenza.
- Nessun asset funzionale critico rimane bloccato in cache su client dopo un deploy.
