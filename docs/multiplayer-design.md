# Rancangan: Ceki Online Multiplayer (Colyseus)

Dokumen acuan untuk mengubah Ceki (saat ini single-player vs bot, static site di
GitHub Pages) menjadi **online player-vs-player 2–4 pemain** dengan
[Colyseus](https://colyseus.io).

## Keputusan yang sudah dikunci

| Topik | Keputusan |
|---|---|
| Framework realtime | **Colyseus** (Node, room otoritatif) |
| Host server | **Render** (Web Service) |
| Identitas | **Tanpa login** — cukup **nickname** saat buat/join room |
| Kode room | **Kode 4 huruf** (mis. `KQ7A`) via `filterBy(['code'])` |
| Timer giliran | **45 detik**, lalu aksi diambil alih |
| Jendela reconnect | **60 detik** (selama itu bot mengambil alih kursi) |
| Frontend | Tetap **GitHub Pages**; ada 2 mode: "Main lokal (bot)" & "Main online" |
| Persistensi | **In-memory** (tanpa DB) untuk MVP |

## 1. Prinsip inti — server otoritatif

Server memegang **satu-satunya state asli**. Client hanya **mengirim niat aksi**
dan **merender view**. Seluruh validasi aturan terjadi di server (reuse
`layMeld` / `takeDiscard` / `discardCard` yang sudah mengembalikan
`{ ok, reason }`). Client tidak pernah dipercaya.

**Aturan emas hidden-info:** isi/urutan deck dan kartu tangan tiap pemain
**tidak pernah** masuk ke state yang di-broadcast. Deck & semua tangan hidup di
memori server; tiap client hanya menerima **tangannya sendiri** lewat pesan
bertarget. Ini menutup celah curang secara **desain**, bukan sekadar
menyembunyikan di UI.

## 2. Arsitektur

```
┌──────────────────────────┐        WSS         ┌───────────────────────────┐
│ Frontend (GitHub Pages)  │ ─────────────────▶ │  Colyseus server (Render) │
│  - render(view)          │  command messages  │  - CekiRoom (authoritative)
│  - kirim aksi            │ ◀───────────────── │  - reuse engine game.js   │
│  - animasi via event     │  public state +    │  - bot via ai.js          │
│                          │  private hand +    │  - in-memory rooms         │
│                          │  events            │                           │
└──────────────────────────┘                    └───────────────────────────┘
```

## 3. Reuse engine (aset terbesar — sudah siap)

`js/deck.js`, `js/melds.js`, `js/game.js`, `js/ai.js` sudah jalan di Node
(`module.exports`). Server membuat **satu instance `Game` per room**.

Refactor kecil yang diperlukan di `game.js`:
- Lepaskan asumsi `players[0] === human`. Generalkan menjadi peran per-seat
  (`isBot`), sehingga bot bisa duduk di kursi mana pun.
- Tambah dua helper serialisasi (lihat §4):
  - `publicView()` → objek aman untuk semua orang.
  - `privateHand(seat)` → kartu tangan satu pemain.
- Simpan `id` kartu (sudah ada `card.id`) sebagai kunci aksi client
  (`layMeld { cardIds }`, `discard { cardId }`).

Tidak ada perubahan pada logika aturan — hanya lapisan serialisasi & seat.

## 4. Model state — publik vs privat

| Data | Lokasi | Dikirim ke |
|---|---|---|
| Deck (isi & urutan) | **server-only** | tidak pernah |
| Tangan tiap pemain | **server-only** | hanya pemilik (pesan `hand`) |
| Giliran, fase, `mustMeldCard`, jumlah kartu tiap pemain | Schema publik | semua |
| Tumpukan buangan (kartu terlihat) | Schema publik | semua |
| Meld yang sudah turun (semua pemain) | Schema publik | semua |
| Skor, nomor sesi, target, pemenang | Schema publik | semua |
| Log / riwayat, timer giliran | Schema publik | semua |
| Info kursi (nickname, connected, isBot) | Schema publik | semua |

Rahasia (deck & tangan) **sengaja tidak dimasukkan ke Schema** → aman lintas
versi Colyseus tanpa bergantung pada fitur filter/`@view`.

### Sketsa Colyseus Schema (publik)

```ts
class CardView extends Schema {         // hanya kartu yang boleh terlihat
  @type("string") id: string;           // "H7", "S10", "JOKER-red"
  @type("string") rank: string;         // null utk joker
  @type("string") suit: string;
  @type("boolean") joker: boolean;
}
class MeldView extends Schema {
  @type("string") type: string;         // "run" | "set"
  @type("number") points: number;
  @type([CardView]) cards: ArraySchema<CardView>;
}
class SeatView extends Schema {
  @type("string") nickname: string;
  @type("boolean") connected: boolean;
  @type("boolean") isBot: boolean;
  @type("number") handCount: number;    // jumlah saja, bukan isinya
  @type("number") score: number;
  @type([MeldView]) melds: ArraySchema<MeldView>;
}
class GameState extends Schema {
  @type("string") phase: string;        // "lobby" | "draw" | "act" | "sessionOver" | "gameOver"
  @type("number") current: number;      // seat index giliran
  @type("number") targetScore: number;
  @type("number") sessionNo: number;
  @type("number") deckCount: number;
  @type([CardView]) discardTop: ArraySchema<CardView>; // s.d. 7 kartu teratas (utk kipas)
  @type("string") mustMeldCardId: string;              // "" bila tak ada
  @type("number") turnEndsAt: number;                  // epoch ms utk countdown 45s
  @type([SeatView]) seats: ArraySchema<SeatView>;
  @type(["string"]) log: ArraySchema<string>;
  @type("string") winnerNickname: string;
}
```

## 5. Protokol pesan

**Client → Server** (aksi; semua divalidasi ulang di server):

| Pesan | Payload | Fase |
|---|---|---|
| `joinSeat` | `{ nickname }` | lobby |
| `setReady` | `{ ready }` | lobby |
| `setTarget` | `{ target }` | lobby (host) |
| `addBot` / `removeBot` | `{ seat }` | lobby (host) |
| `startGame` | — | lobby (host) |
| `drawDeck` | — | giliranmu, fase draw |
| `takeDiscard` | `{ depth }` | giliranmu, fase draw |
| `layMeld` | `{ cardIds: string[] }` | giliranmu, fase act |
| `discard` | `{ cardId }` | giliranmu, fase act |
| `playAgain` | — | gameOver |

**Server → Client:**

| Pesan | Isi |
|---|---|
| (Schema patch) | state publik, otomatis diff biner (~50ms) |
| `hand` | `CardView[]` tangan pribadi penerima (dikirim ulang saat tangannya berubah) |
| `event` | `{ type, ... }` untuk animasi/log: `laid`, `took`, `closed`, `jokerEnded`, `sessionResult`, dll |
| `error` | `{ reason }` — aksi ilegal; tampilkan sebagai hint (seperti `flashHint`) |

## 6. `CekiRoom` — lifecycle

```
onCreate(options):
  this.setState(new GameState())
  code = options.code (dari client saat create)   // filterBy(['code'])
  hostSessionId = pertama yang joinSeat
  game = null  // dibuat saat startGame

onJoin(client, options):
  tambah SeatView { nickname, connected:true }
  kirim snapshot + hand kosong

onMessage('startGame'):
  isi kursi kosong dengan bot (opsional)
  game = new Game(nicknames, { targetScore })
  game.startSession(firstSeat)
  syncPublic(); kirim hand ke tiap kursi manusia
  scheduleTurn()

onMessage(aksi giliran):
  if client.seat !== game.current -> error "Bukan giliranmu"
  hasil = game[method](args)          // reuse engine
  if !hasil.ok -> client.send('error', { reason: hasil.reason }); return
  syncPublic()                        // update Schema -> patch otomatis
  kirim 'hand' ke pemain yang tangannya berubah
  broadcast 'event' seperlunya
  if fase berpindah & giliran bot -> jalankan bot (lihat §7)
  else scheduleTurn()                 // reset timer 45s

onLeave(client, consented):
  seat.connected = false
  bot mengambil alih kursi sementara
  allowReconnection(client, 60):
    berhasil -> seat.connected = true, pemain lanjut
    gagal    -> bot permanen di kursi itu (game jalan terus)
```

### Timer giliran (45 dtk)

- `state.turnEndsAt = Date.now() + 45000` tiap giliran baru; client render
  countdown.
- `this.clock.setTimeout(onTimeout, 45000)`. Saat timeout: lakukan **aksi aman
  otomatis** (ambil dari deck bila belum ambil, lalu buang kartu paling tak
  berguna — reuse `AI.decideDiscard`), atau serahkan giliran ke logika bot.

## 7. Integrasi bot

- Kursi kosong / pemain disconnect diisi bot. Bot memakai `ai.js` yang sudah ada
  (`decideDraw` / `decideMelds` / `decideDiscard`).
- Giliran bot dijalankan **di server** dengan jeda memakai `this.clock.setTimeout`
  agar tetap terasa "berpikir" (animasi di client didorong lewat `event`).
- Karena engine identik, perilaku bot online = bot lokal.

## 8. Kode room (join by code)

Registrasi:
```ts
gameServer.define("ceki", CekiRoom).filterBy(["code"]);
```
- **Buat room:** client generate kode 4 huruf (A–Z, hindari 0/O/1/I),
  `client.create("ceki", { code, nickname })`.
- **Gabung:** `client.join("ceki", { code, nickname })` → Colyseus mengarahkan ke
  room dengan `code` sama. Bila tak ada → error "Room tidak ditemukan".
- Tangani tabrakan kode (jarang) dengan retry generate saat create.

## 9. Refactor frontend

Saat ini `js/ui.js` menyetir `Game` lokal. Pisahkan:

- **`js/ui.js` → renderer murni**: `render(view, myHand)` dari state server.
  Banyak fungsi render existing (`renderScoreboard`, `renderOpponents`,
  `renderCenter`, `cardEl`, `meldChip`, modal hasil) bisa dipakai ~apa adanya
  karena sudah "render dari objek".
- **`js/net.js` (baru)**: koneksi Colyseus (`colyseus.js` SDK), kirim aksi,
  terima `onStateChange` / `hand` / `event` / `error`, panggil `render`.
- **Mode lokal dipertahankan**: menu awal punya "Main lokal (lawan bot)" (pakai
  `Game` lokal seperti sekarang) & "Main online" (pakai `net.js`). Engine sama.
- Lobby UI baru: input nickname, tombol Buat Room (tampilkan kode), input kode +
  Gabung, daftar kursi + ready, pilih target, tombol Mulai (host).

## 10. Hosting & deploy (Render)

- **Server**: repo terpisah / folder `server/` → Render **Web Service** (Node).
  - `PORT` dari `process.env.PORT`, bind `0.0.0.0`.
  - Endpoint health `GET /` untuk Render.
  - WebSocket (WSS) otomatis via domain Render (`wss://<app>.onrender.com`).
  - Free tier: instance "tidur" saat idle → koneksi pertama lambat (wajar MVP).
- **Frontend**: tetap GitHub Pages; simpan URL server di config (mis.
  `window.CEKI_SERVER = "wss://<app>.onrender.com"`).
- **CORS/origin**: izinkan origin `https://dimnabs.github.io`.

## 11. Keamanan (checklist)

- [ ] Semua aksi divalidasi server (reuse `{ok, reason}` engine).
- [ ] Deck & tangan lawan tak pernah dikirim ke client mana pun.
- [ ] Cek `client.seat === game.current` sebelum memproses aksi giliran.
- [ ] Rate-limit / abaikan pesan di luar fase/giliran.
- [ ] Kode room tak bocor ke room lain; nickname disanitasi (panjang, karakter).

## 12. Rencana bertahap (milestone)

| M | Isi | Definition of done |
|---|---|---|
| **M1** | `server/` + `CekiRoom` membungkus engine; public Schema + private `hand`; aksi draw/takeDiscard/layMeld/discard + validasi; **2 pemain, 1 room** (kode hardcoded dulu) | Dua browser menyelesaikan 1 game penuh online, tanpa kebocoran kartu |
| **M2** | Lobby + kode 4-huruf (`filterBy`), nickname, ready, pilih target; **3–4 pemain**; isi kursi kosong dgn bot | Room 2–4 pemain + bot, dibuat & digabung via kode |
| **M3** | Timer giliran 45s + aksi aman; disconnect/reconnect 60s (bot ambil alih); animasi via `event`; mode lokal tetap ada | Tahan gangguan koneksi & timeout |
| **M4** | Polish: main lagi, ganti nickname, salin kode/link undangan, error UX; deploy Render + Pages | Bisa dipakai teman-teman end-to-end |

## 13. Struktur berkas (usulan)

```
/ (frontend, GitHub Pages — seperti sekarang + net.js & lobby)
  index.html
  css/style.css
  js/{deck,melds,game,ai,ui}.js
  js/net.js            # baru: koneksi Colyseus
server/                # Node service utk Render
  package.json
  src/index.ts         # boot Colyseus, define("ceki").filterBy(["code"])
  src/CekiRoom.ts       # room otoritatif
  src/schema.ts        # GameState & Schema publik
  src/engine/          # symlink/copy deck,melds,game,ai (atau paket bersama)
```
Catatan: engine dipakai di dua sisi. Opsi: (a) jadikan paket lokal bersama, atau
(b) salin + uji kontrak lewat test. Untuk MVP, `require` langsung dari `../js`
lewat build sederhana sudah cukup.

## 14. Risiko & mitigasi

- **Versi Colyseus** (mekanisme filter berubah antar versi): dihindari dengan
  menaruh rahasia di luar Schema. ✅
- **Refactor `ui.js`** (pisah render dari logika): sedang, tapi lurus; mode lokal
  jadi test-bed.
- **Free tier Render tidur**: tampilkan status "menghubungkan…"; pertimbangkan
  ping keep-alive bila perlu.
- **Sinkronisasi bot delay** vs patch: dorong animasi lewat `event`, bukan
  bergantung timing patch.

---

Setelah rancangan ini disetujui, eksekusi mulai dari **M1**.
