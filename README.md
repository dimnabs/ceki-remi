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
   **beserta semua kartu di atasnya**, dengan syarat kamu punya **≥2 kartu di
   tangan** yang bisa membentuk meld dengan kartu itu. Klik kartu di kipas
   buangan untuk mengambil dari sana; kartu yang belum memenuhi syarat tampak
   redup.
2. **Turunkan meld** (opsional) — pilih 3+ kartu di tanganmu lalu tekan
   *Turunkan Meld*.
3. **Buang** satu kartu untuk mengakhiri giliran (pilih 1 kartu → *Buang Kartu*).

### Kombinasi "jadi" (minimal 3 kartu)

- **Set** — rank sama, simbol berbeda: `8♠ 8♥ 8♦`.
- **Seri** — berurutan, simbol sama: `4♣ 5♣ 6♣`. Deret melingkar diperbolehkan:
  `K♠ A♠ 2♠` dan `A♠ 2♠ 3♠` valid.

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

Menggantikan kartu apa pun. **Tidak boleh** dipakai untuk meld pertamamu,
**tidak boleh** dibuang, dan bila tersisa di tangan saat sesi berakhir → **−500**.

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

- **Ambil**: mengambil kartu buangan hanya bila menaikkan potensi poin meld,
  selain itu mengambil dari deck.
- **Turunkan**: menurunkan meld sebanyak mungkin (meld pertama tanpa joker).
- **Buang**: membuang kartu non-joker bernilai terbesar yang tidak berpotensi jadi.

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
