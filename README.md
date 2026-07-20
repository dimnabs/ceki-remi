# Ceki — Remi 7 Kartu 🂡

Permainan kartu **Remi 7 Kartu / Ceki** yang bisa dimainkan langsung di browser:
kamu melawan 3 bot ber-strategi *greedy*. Dibuat sebagai aplikasi web statis
(HTML/CSS/JavaScript murni) — tanpa dependensi, tanpa build.

Aturan mengacu pada:
- [Cara main kartu remi paling sederhana (Kumparan)](https://kumparan.com/info-sport/cara-main-kartu-remi-paling-sederhana-ini-aturannya-1vxfpTVWEa7/full)
- [Strategi Greedy pada Permainan Kartu Remi — Makalah IF2211 Strategi Algoritma, ITB (Aria Bachrul Ulum Berlian)](https://informatika.stei.itb.ac.id/~rinaldi.munir/Stmik/2020-2021/Makalah2021/Makalah-Stima-2021-K3%20(9).pdf)

## Cara Menjalankan

Tidak perlu server — cukup buka `index.html` di browser:

```bash
# langsung
xdg-open index.html      # Linux
open index.html          # macOS

# atau via server statis apa pun bila mau
python3 -m http.server 8000   # lalu buka http://localhost:8000
```

## Cara Bermain

Setiap pemain mendapat **7 kartu**. Pada giliranmu:

1. **Ambil** kartu — dari **Deck**, atau dari **Buangan**. Dari buangan kamu
   boleh mengambil kartu yang diinginkan (maksimal **7 kartu** dari atas)
   **beserta semua kartu di atasnya**. Syaratnya: kartu itu **wajib langsung
   kamu turunkan sebagai bagian meld** pada giliran itu (tak boleh sekadar
   ambil lalu buang). Klik kartu di kipas buangan untuk mengambil dari sana;
   kartu yang belum memenuhi syarat tampak redup. Kartu wajib ditandai
   label **"wajib"** di tanganmu, dan tombol *Buang* terkunci sampai ia turun.
2. **Turunkan meld** (opsional) — pilih 3+ kartu di tanganmu lalu tekan
   *Turunkan Meld*.
3. **Buang** satu kartu untuk mengakhiri giliran (pilih 1 kartu → *Buang Kartu*).

### Kombinasi "jadi" (minimal 3 kartu)

- **Seri** — berurutan, simbol sama, dalam **satu blok**: `2–10`
  (mis. `4♣ 5♣ 6♣`) atau `J-Q-K`. **Tidak melingkar** dan **As tidak masuk
  seri** (`Q-K-A`, `K-A-2`, `10-J-Q` tidak valid).
- **Set** — rank sama, simbol berbeda: `8♠ 8♥ 8♦`. Hanya boleh diturunkan
  **setelah kamu punya minimal satu seri yang turun** — jadi meld pertamamu
  wajib berupa seri.

### Nilai kartu

| Kartu | Poin |
|-------|------|
| 2–10  | 5    |
| J,Q,K | 10   |
| As    | 15   |
| Joker | mengikuti kartu yang diwakili |

Kartu yang diturunkan menjadi **poin plus**; kartu sisa di tangan saat sesi
berakhir menjadi **poin minus**.

### Joker

Menggantikan kartu apa pun. **Tidak boleh** dipakai untuk meld pertamamu.
Membuang joker **mengakhiri sesi** (hanya terjadi bila terpaksa — cuma joker
tersisa di tangan). Bila tersisa di tangan saat sesi berakhir → **−500**.

### Wajib buang tiap giliran

Setiap giliran harus diakhiri dengan membuang 1 kartu, jadi kamu **tidak boleh
menurunkan seluruh kartu tangan** — selalu sisakan minimal 1 kartu untuk
dibuang. (Menurunkan kartu terakhir ditolak; bot pun mematuhi ini.)

### Tutup tangan (menang sesi)

Habiskan seluruh kartu (semua jadi, sisa satu dibuang) → **bonus +250**
(atau **+500** bila melibatkan joker).

### Akhir sesi & pemenang

Sesi berakhir saat ada yang **tutup tangan** atau saat **deck habis** — lalu
skor dihitung. Skor diakumulasi antar-sesi. **Pemenang** = pemain pertama yang
total skornya mencapai **target**.

Target skor dipilih di layar awal: **300**, **500**, **1000** (aturan asli
makalah), atau nilai custom. Semakin tinggi target, semakin banyak ronde yang
dimainkan — permainan ini memang biasa dimainkan lama.

## Strategi Bot (Greedy)

Sesuai makalah IF2211 ITB, tiap bot memilih aksi yang memaksimalkan poin lokal
("take what you can get now"):

- **Ambil**: mengambil dari buangan (kedalaman 1–7, *deadwood-aware*) hanya
  bila menaikkan nilai tangan dan kartunya bisa langsung dijadikan meld yang
  sah; selain itu mengambil dari deck.
- **Turunkan**: menurunkan meld sebanyak mungkin — **seri lebih dulu** (set
  baru menyusul), meld pertama tanpa joker, dan kartu wajib dari buangan
  diturunkan lebih dulu.
- **Buang**: membuang kartu paling tak berpotensi (mempertahankan kartu yang
  bisa menjadi seri/set), bernilai terbesar bila seri.

## Struktur Proyek

```
index.html      # tata letak & muat skrip
css/style.css   # tema meja hijau, responsif, theme-aware
js/deck.js      # model kartu, deck, nilai poin
js/melds.js     # deteksi & penilaian set/seri (+ joker), findBestMelds
js/game.js      # mesin aturan: giliran, tutup tangan, penilaian, akhir sesi
js/ai.js        # bot strategi greedy
js/ui.js        # render DOM, interaksi pemain, animasi giliran bot
```

Modul `deck.js`, `melds.js`, `game.js`, dan `ai.js` juga bisa dipakai di Node.js
(mendukung `module.exports`) untuk pengujian atau simulasi headless.

## Catatan

- Deck **tidak** dikocok ulang: bila deck habis, sesi berakhir (aturan asli).
- Ada batas aman `maxTurns` yang sangat besar sekadar untuk mencegah kemacetan
  teoretis; dalam permainan normal sesi berakhir jauh sebelum itu (deck habis
  di sekitar ~27 giliran).

Aturan Ceki berbeda-beda antar daerah — versi ini mengambil dasar dari kedua
sumber di atas.
