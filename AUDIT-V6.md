# Audit tecnico v6 — ECON Report preliminare

## Verifica acquisizione al click CTA

Il gestore `submit` del form esegue questa sequenza:

1. blocca il submit nativo;
2. imposta `state.submitted = true` per neutralizzare doppio click;
3. invoca `beginLeadCapture()` prima di OCR e calcolo report;
4. `beginLeadCapture()` POSTa su `/.netlify/functions/lead-intake` con un `requestId` idempotente;
5. il record viene scritto nella transazione Postgres come `econ_leads` + evento `lead_requested`;
6. il report e l’upload documento proseguono in parallelo ma usano lo stesso `leadId` restituito dal database.

Quindi il comando di acquisizione parte immediatamente dal click CTA. Il completamento definitivo richiede la risposta 2xx della Function; in caso di errore di rete l’interfaccia espone “Invio da confermare” e non dichiara l’acquisizione riuscita.

## Test eseguiti localmente

- `node --check public/assets/app.js` — superato.
- `npm run check` — TypeScript superato.
- `netlify functions:build --src netlify/functions` — compilazione Functions superata.
- Manifest Functions — verificato: gli endpoint pubblicati sono `lead-intake`, `lead-event`, `document-upload`, `document-retention`; il modulo shared non viene esposto come Function.
- Manifest Functions — verificato: rate limit aggregato per IP, non per dominio.

## Residuo da verificare obbligatoriamente in Deploy Preview

Serve ancora un test reale sul progetto Netlify collegato per confermare provisioning Database, migrazioni e scrittura in Blobs. Il repository locale non dispone dell’ID del progetto Netlify, quindi `netlify build` non può effettuare quella verifica end-to-end.
