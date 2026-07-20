# Ceki — Server Multiplayer (Colyseus)

Server **otoritatif** untuk Ceki online (lihat rancangan lengkap di
[`../docs/multiplayer-design.md`](../docs/multiplayer-design.md)). Ini bagian
**M1**: room `ceki` yang membungkus engine permainan, menjaga deck & tangan
tetap rahasia di server, dan memvalidasi semua aksi.

## Prinsip
- Engine (`../js/deck.js`, `melds.js`, `game.js`, `ai.js`) dipakai ulang apa
  adanya (Node-ready).
- **Hidden info**: deck & tangan hanya di memori server. Client menerima state
  publik (Colyseus Schema) + **tangannya sendiri** lewat pesan `hand`. Tak ada
  kartu lawan / isi deck yang pernah dikirim.
- Kursi kosong / pemain terputus diisi **bot** (`ai.js`), dgn jendela reconnect
  60 dtk. Timer giliran 45 dtk → aksi aman otomatis.

## Menjalankan (lokal)
```bash
cd server
npm install
npm start            # default PORT=2567
# health check:
curl http://localhost:2567/health
```
Frontend menghubungkan via `ws://localhost:2567` (lokal) atau `wss://…` (produksi).

## Protokol singkat
Client → server: `setReady`, `setTarget`, `addBot`, `removeBot`, `startGame`,
`drawDeck`, `takeDiscard {depth}`, `layMeld {cardIds}`, `discard {cardId}`,
`playAgain`.

Server → client: Schema patch (state publik), `welcome {seat, code}`,
`hand {cards}` (privat), `event {type,…}` (mis. `sessionResult`),
`error {reason}`.

Room diarahkan lewat **kode room** (`filterBy(['code'])`): buat dengan
`client.create('ceki', { code, nickname })`, gabung dengan
`client.joinById(roomId, { nickname })` atau join by code.

## Deploy ke Render
1. Buat **Web Service** baru dari repo ini, root directory `server/`.
2. Build command: `npm install` · Start command: `npm start`.
3. Render menyediakan `PORT` via env (sudah dibaca `process.env.PORT`).
4. WebSocket (WSS) otomatis lewat domain Render.
5. Set URL server di frontend (mis. `window.CEKI_SERVER = 'wss://<app>.onrender.com'`).

> Catatan: server memakai engine dari `../js/`. Pastikan perbaikan engine
> (mis. PR "empty-hand fix") sudah ada di branch yang di-deploy.

## Status M1 (tervalidasi lewat client Node)
- Join-by-code, `welcome`/seat, state publik + tangan privat (tanpa kebocoran).
- Keempat aksi (draw / takeDiscard / layMeld / discard) tervalidasi server.
- Game penuh sampai `gameOver` untuk 1 manusia + 3 bot **dan** 2 manusia
  (termasuk tutup tangan + bonus), 0 aksi ilegal.
- Reconnect/bot-takeover & timer giliran terpasang.

Berikutnya (frontend M1): `js/net.js` + UI lobby + render dari state server.
