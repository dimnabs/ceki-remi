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

1. **Ambil** satu kartu — dari **Deck** atau dari **Buangan** (klik tumpukannya
   atau tombolnya).
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

Sesi berakhir saat ada yang tutup tangan. Bila deck habis, tumpukan buangan
dikocok ulang menjadi deck baru (maksimal 2×), lalu sesi berakhir dan skor
dihitung. Skor diakumulasi antar-sesi. **Pemenang** = pemain pertama yang total
skornya mencapai **500** (aturan rumah agar cepat; makalah aslinya 1000 —
lihat `opts.targetScore`).

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

## Catatan Penyederhanaan

- Pengambilan dari buangan disederhanakan menjadi **kartu teratas saja**
  (aturan asli membolehkan mengambil beberapa kartu dari tumpukan buangan
  dengan syarat tertentu).
- Deck dikocok ulang dari buangan agar sesi berpeluang ditutup, dengan batas
  untuk menjaga durasi permainan tetap wajar.

Aturan Ceki berbeda-beda antar daerah — versi ini mengambil dasar dari kedua
sumber di atas.
