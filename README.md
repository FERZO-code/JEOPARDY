# Party Night 🎉

Giochi da fare con gli amici: **Jeopardy Night** e **Chi Sei Davvero?**

## Online (Vercel)
Il sito è statico + una funzione (`api/party.js`). Le stanze per giocare dai telefoni stanno in **Upstash Redis**
(integrazione del Marketplace di Vercel).

1. Vercel → progetto → **Storage** → Upstash for Redis → collegalo al progetto (oppure
   `vercel integration add upstash/upstash-kv`).
2. Ridistribuisci (push su GitHub).
3. Apri il sito, scegli un gioco, premi **📱 Telefoni**: ognuno scansiona il QR code col proprio telefono.

Variabili usate (le crea l'integrazione): `KV_REST_API_URL` e `KV_REST_API_TOKEN`
(oppure `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`).

## In casa, senza internet né database
```bash
node party-server.js     # oppure: npm start
```
Apri il link con l'indirizzo IP mostrato nel terminale; computer e telefoni sulla stessa rete Wi-Fi.
Le stanze stanno in memoria.

## Da un solo schermo
Apri `index.html` (o il sito) e gioca tutti insieme: il telefono è facoltativo.

## File
| File | Cosa fa |
|---|---|
| `index.html` | Home con la scelta dei giochi e dei giocatori |
| `jeopardy.html` | Jeopardy Night |
| `chisei.html` | Chi Sei Davvero? (4 parti) |
| `play.html` | Schermata che si apre sui telefoni |
| `api/party.js` | Funzione Vercel con le API delle stanze (Upstash Redis) |
| `lib/party-api.js` | Logica delle stanze, condivisa con il server locale |
| `party-server.js` | Server locale facoltativo (stanze in memoria) |
| `net.js`, `shared.js`, `shared.css`, `qrcode.js` | Codice condiviso (`qrcode.js`: libreria MIT di Kazuhiko Arase) |
