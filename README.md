# Party Night 🎉

Giochi da fare con gli amici: **Jeopardy Night** e **Chi Sei Davvero?**

## Giocare tutti insieme da un solo schermo
Apri `index.html` con un doppio clic. Non serve nulla di più.

## Giocare dai telefoni (QR code)
Serve solo [Node.js](https://nodejs.org) (nessuna dipendenza da installare).

```bash
node server.js     # oppure: npm start
```

1. Apri sul computer il link che compare nel terminale (quello con l'indirizzo IP, es. `http://192.168.1.37:3000`).
2. Scegli un gioco e premi **📱 Telefoni** per mostrare il QR code.
3. Ognuno lo inquadra con il telefono, scrive il nome ed è dentro.

Computer e telefoni devono essere sulla **stessa rete Wi-Fi**. Il computer fa da "banco": tiene la partita e
mostra il tabellone; i telefoni servono per rispondere. Chi non ha il telefono può giocare comunque dal computer.

## File
| File | Cosa fa |
|---|---|
| `index.html` | Home con la scelta dei giochi e dei giocatori |
| `jeopardy.html` | Jeopardy Night |
| `chisei.html` | Chi Sei Davvero? (4 parti) |
| `play.html` | Schermata che si apre sui telefoni |
| `server.js` | Server locale per il multi-dispositivo (solo Node, nessun pacchetto) |
| `net.js`, `shared.js`, `shared.css`, `qrcode.js` | Codice condiviso (`qrcode.js`: libreria MIT di Kazuhiko Arase) |
