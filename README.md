# ECON — Report preliminare con database lead

Questa versione mantiene il visual e il motore locale di OCR/report, ma sostituisce Netlify Forms come archivio principale con:

- **Netlify Database (Postgres)** per lead, eventi, report e stato di lavorazione.
- **Netlify Blobs** per le bollette, conservate come documenti privati separati dal record commerciale.
- **Netlify Functions** per validazione server-side, deduplicazione per telefono, idempotenza dei retry e rate limiting.
- **Migrazione automatica** in `netlify/database/migrations`.

## Flusso dati

1. Alla generazione del report, `lead-intake` crea o aggiorna **un solo lead** in base al telefono normalizzato, registrando anche email e indirizzo completo dell’immobile.
2. `lead-event` salva gli eventi `report_generated`, `report_viewed_without_bill` e `whatsapp_opened` senza creare duplicati.
3. `document-upload` valida formato/firma del file, calcola SHA-256, salva la bolletta in `econ-private-documents` e crea il riferimento nel database.
4. Il task programmato `document-retention` elimina le bollette scadute dopo **180 giorni**.

Il testo OCR completo non viene inviato né salvato nel database.

## Attivazione Netlify

1. Crea un repository GitHub e carica **l'intera cartella** del progetto.
2. In Netlify, collega il repository come progetto con deploy continuo.
3. Nel terminale del repository esegui:

```bash
npm install
npx netlify login
npx netlify link
npx netlify database init
npm run dev
```

`netlify database init` inizializza il database per il sito collegato. Al deploy, Netlify applicherà automaticamente `netlify/database/migrations/20260704121500_create_econ_leads.sql` prima della pubblicazione.

4. Esegui prima un **Deploy Preview** da un branch dedicato e prova:
   - lead senza bolletta;
   - lead con PDF;
   - caricamento bolletta dopo il report;
   - perdita rete / retry;
   - stesso click ripetuto;
   - stesso documento ricaricato.

5. Solo dopo i test, unisci il branch alla produzione.

## Dati consultabili

Nel pannello Netlify Database trovi:

- `econ_leads`: un record commerciale per telefono, con email e indirizzo completo da verificare, consumo annuale e spesa annuale dichiarati;
- `econ_lead_events`: timeline del comportamento;
- `econ_documents`: metadati e chiavi private delle bollette;
- store Blobs `econ-private-documents`: file sorgente.

## Dati marketing acquisiti

La landing salva automaticamente `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, percorso di ingresso e referrer.

## Da configurare prima di campagne a pagamento

- Verifica l'informativa privacy pubblicata e sostituisci `PRIVACY_NOTICE_VERSION` in `public/assets/app.js` quando la modifichi.
- Configura un CAPTCHA o Turnstile se il traffico cresce: il progetto include già honeypot lato markup, same-origin checks e rate limiting sulle Functions, ma un CAPTCHA è consigliato per campagne Meta/Google ad alto volume.
- Non esporre mai il database, i Blob o le credenziali CRM al browser. Le integrazioni CRM/n8n vanno aggiunte dalla Function o con webhook server-to-server.
- Definisci chi può accedere alla sezione Blobs/Database in Netlify: le bollette contengono dati personali e contrattuali.

## Comandi utili

```bash
npm run check
npm run dev
npx netlify deploy
npx netlify deploy --prod
```

## Flusso manuale address-first

Nel percorso “Continua con i dati manuali” non vengono più richiesti tipo immobile, copertura disponibile o dato di consumo. Sono invece obbligatori nome, telefono, **email** e **indirizzo completo dell’immobile**. L’indirizzo viene presentato come elemento prioritario perché abilita la verifica preliminare del tetto: posizione, esposizione, ombreggiamenti e superficie disponibile. Senza bolletta, il report non mostra stime economiche non supportate; restituisce una verifica del tetto da completare.


## Aggiornamento v3 — dati annuali obbligatori

Nel percorso **“Continua con i dati manuali”** restano eliminati tipo immobile, copertura disponibile e selettore del dato di consumo. Sono obbligatori: nome, telefono, indirizzo completo, **consumo annuale in kWh**, **spesa annuale in euro**, email e presa visione privacy.

Il consumo è espresso in **kWh**, non kW: i kW misurano la potenza, mentre il consumo annuo della bolletta è misurato in kWh. I due valori alimentano lo scenario preliminare; l’indirizzo resta il dato prioritario per la verifica reale del tetto. La CTA resta disponibile nella prima piega tramite conversion bar fissa, oltre al pulsante nel form.

## Aggiornamento v4 — bolletta prima, form manuale solo in alternativa

Il caricamento della bolletta avvia subito la lettura locale di consumi, importi e POD. Quando il documento è riconosciuto, la CTA fissa nella prima piega diventa **“Genera il report dalla bolletta”**: nome, telefono, email, indirizzo, consumo e spesa annuale non sono più obbligatori.

Il database crea in questo caso un lead con modalità `bill_only` e stato `document_only`; la bolletta viene poi collegata al record con hash e retention. Se la lettura automatica supera il tempo disponibile o fallisce lato browser, l’utente può comunque inviare la bolletta senza compilare il form e ECON completerà la verifica tecnica. Il percorso manuale mantiene invece tutti i dati obbligatori e la presa visione privacy tramite checkbox.


## Aggiornamento v5 — scenario opportunità, più valorizzazione di autonomia e autoconsumo

Il report preliminare utilizza ora uno **scenario opportunità**: il sistema viene dimensionato in modo leggermente più espansivo rispetto al puro pareggio dei consumi, con maggiore spazio per accumulo e sfruttamento del tetto. Il report presenta quindi:

- impianto fotovoltaico con margine di produzione superiore;
- accumulo più capiente, utile a valorizzare le ore serali;
- autonomia potenziale e indicazione dell’autoconsumo potenziale;
- valore annuo potenziale da fotovoltaico, accumulo e ottimizzazione della fornitura.

Per correttezza commerciale, le card e le note riportano espressamente che si tratta di uno **scenario opportunità** da validare su profilo orario, tetto, ombreggiamenti, vincoli di connessione e sopralluogo. Non è una garanzia di risparmio.


## Correzioni di audit v6

- La richiesta `lead-intake` parte nel percorso di submit **prima** dell’OCR e della generazione report.
- La richiesta JSON usa `keepalive: true` per ridurre la perdita dell’acquisizione quando l’utente naviga subito dopo il click.
- I rate limit delle Functions usano `aggregateBy: ["ip"]`. Il valore stringa precedente veniva compilato nel manifest come aggregazione di dominio, cioè un limite globale per tutti i visitatori, inadatto a campagne a pagamento.
- Il modulo condiviso è stato spostato fuori da `netlify/functions`: non viene più pubblicato come endpoint `_shared` indesiderato.
- Il job di retention elimina prima il blob e poi la riga SQL; se l’eliminazione del file fallisce, il record resta disponibile per un nuovo tentativo invece di generare un documento orfano.

### Cosa significa “bolletta senza form”

Il percorso diretto crea immediatamente un record `document_only` anche senza telefono o email. È una richiesta con bolletta, non un lead commercialmente contattabile finché il visitatore non usa WhatsApp oppure non lascia un recapito. Per campagne a pagamento, monitora distintamente `document_only` e lead con recapito.
