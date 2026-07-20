/*
 * melds.js — Deteksi & penilaian kombinasi "jadi" (set / seri) untuk Ceki.
 *
 *   - Set  : >= 3 kartu dengan rank sama (mis. 4-4-4, J-J-J-J).
 *   - Seri : >= 3 kartu berurutan dengan simbol sama (mis. 4H-5H-6H).
 *            TIDAK melingkar. Seri hanya boleh dalam SATU blok:
 *              * blok angka  : 2..10  (mis. 2-3-4 s/d 8-9-10)
 *              * blok gambar : J-Q-K
 *            As TIDAK bisa masuk seri (hanya untuk set). Lintas-blok seperti
 *            10-J-Q atau Q-K-A tidak valid.
 *   - Joker : kartu liar, menggantikan kartu apa pun.
 */
(function (global) {
  'use strict';

  var Deck = global.Deck || (typeof require !== 'undefined' ? require('./deck.js') : null);

  function splitJokers(cards) {
    var reals = [], jokers = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].joker) jokers++; else reals.push(cards[i]);
    }
    return { reals: reals, jokers: jokers };
  }

  // Apakah sekelompok kartu membentuk SET yang valid?
  function isSet(cards) {
    if (cards.length < 3 || cards.length > 4) return false; // maksimum 4 (satu per simbol)
    var sj = splitJokers(cards);
    if (sj.reals.length === 0) return false; // butuh minimal 1 kartu asli
    var rank = sj.reals[0].rank;
    for (var i = 1; i < sj.reals.length; i++) {
      if (sj.reals[i].rank !== rank) return false;
    }
    // Simbol tidak boleh duplikat pada satu set.
    var suits = {};
    for (var k = 0; k < sj.reals.length; k++) {
      if (suits[sj.reals[k].suit]) return false;
      suits[sj.reals[k].suit] = true;
    }
    return true;
  }

  // runPos: A=1, 2..10, J=11, Q=12, K=13.
  // Blok seri yang sah: angka [2..10] dan gambar [11..13] (J-Q-K). Tanpa wrap.
  // Mengembalikan array posisi jendela seri bila valid, atau null.
  function _runWindow(cards) {
    if (cards.length < 3) return null;
    var sj = splitJokers(cards);
    if (sj.reals.length === 0) return null;
    var suit = sj.reals[0].suit;
    var positions = [];
    for (var i = 0; i < sj.reals.length; i++) {
      if (sj.reals[i].suit !== suit) return null;
      positions.push(sj.reals[i].runPos);
    }
    // Posisi asli harus unik.
    var seen = {};
    for (var p = 0; p < positions.length; p++) {
      if (seen[positions[p]]) return null;
      seen[positions[p]] = true;
    }
    var n = cards.length;
    // Kandidat titik awal: seluruh jendela harus muat dalam satu blok.
    var starts = [];
    for (var s = 2; s + n - 1 <= 10; s++) starts.push(s);   // blok angka 2..10
    for (var s2 = 11; s2 + n - 1 <= 13; s2++) starts.push(s2); // blok gambar J-Q-K
    for (var k = 0; k < starts.length; k++) {
      var start = starts[k];
      var win = {}, arr = [];
      for (var off = 0; off < n; off++) { win[start + off] = true; arr.push(start + off); }
      var ok = true;
      for (var q = 0; q < positions.length; q++) {
        if (!win[positions[q]]) { ok = false; break; }
      }
      if (ok) return arr;
    }
    return null;
  }

  // Apakah sekelompok kartu membentuk SERI (run) yang valid?
  function isRun(cards) {
    return _runWindow(cards) !== null;
  }

  function isValidMeld(cards) {
    return isSet(cards) || isRun(cards);
  }

  // Tentukan tipe meld ('set' | 'run' | null).
  function meldType(cards) {
    if (isSet(cards)) return 'set';
    if (isRun(cards)) return 'run';
    return null;
  }

  // Hitung poin sebuah meld valid, termasuk nilai yang diwakili joker.
  function meldPoints(cards) {
    var type = meldType(cards);
    if (!type) return 0;
    var sj = splitJokers(cards);
    var total = 0;
    for (var i = 0; i < sj.reals.length; i++) total += sj.reals[i].value;

    if (sj.jokers === 0) return total;

    if (type === 'set') {
      // Joker mewakili rank set tsb.
      var jokerVal = Deck.rankValue(sj.reals[0].rank);
      total += sj.jokers * jokerVal;
      return total;
    }

    // type === 'run' : cari posisi kosong yang ditambal joker.
    var window = _runWindow(cards);
    if (!window) return total;
    var used = {};
    sj.reals.forEach(function (c) { used[c.runPos] = true; });
    var jsum = 0;
    for (var w = 0; w < window.length; w++) {
      if (!used[window[w]]) jsum += Deck.rankValue(Deck.RANKS[window[w] - 1]);
    }
    return total + jsum;
  }

  /*
   * findBestMelds — bagi tangan menjadi kumpulan meld disjoint yang
   * memaksimalkan poin meld, lalu meminimalkan sisa (deadwood).
   * Tangan kecil (<= ~10 kartu) sehingga pencarian rekursif memadai.
   *
   * opts.allowJoker (default true): jika false, meld yang mengandung joker
   * diabaikan (dipakai untuk aturan "meld pertama tidak boleh pakai joker").
   */
  function findBestMelds(cards, opts) {
    opts = opts || {};
    var allowJoker = opts.allowJoker !== false;

    // 1) Kumpulkan semua meld kandidat (subset valid, ukuran 3..).
    var candidates = [];
    var n = cards.length;
    var idx = cards.map(function (_, i) { return i; });

    // Enumerasi subset via bitmask (n <= ~12 aman).
    var limit = 1 << n;
    for (var mask = 1; mask < limit; mask++) {
      var bits = popcount(mask);
      if (bits < 3) continue;
      var subset = [];
      var hasJoker = false;
      for (var i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          subset.push(cards[i]);
          if (cards[i].joker) hasJoker = true;
        }
      }
      if (hasJoker && !allowJoker) continue;
      if (isValidMeld(subset)) {
        candidates.push({ mask: mask, points: meldPoints(subset), size: bits });
      }
    }

    // 2) Cari kombinasi meld disjoint terbaik (maksimum poin).
    var best = { points: -Infinity, masks: [], usedMask: 0 };

    function deadwoodValue(usedMask) {
      var dv = 0;
      for (var i = 0; i < n; i++) {
        if (!(usedMask & (1 << i))) {
          dv += cards[i].joker ? 500 : cards[i].value; // joker sisa sangat mahal
        }
      }
      return dv;
    }

    function search(start, usedMask, points, chosen) {
      // Evaluasi solusi saat ini.
      var dw = deadwoodValue(usedMask);
      if (points > best.points ||
          (points === best.points && dw < deadwoodValue(best.usedMask))) {
        best = { points: points, masks: chosen.slice(), usedMask: usedMask };
      }
      for (var c = start; c < candidates.length; c++) {
        var cm = candidates[c].mask;
        if ((cm & usedMask) === 0) {
          chosen.push(cm);
          search(c + 1, usedMask | cm, points + candidates[c].points, chosen);
          chosen.pop();
        }
      }
    }
    search(0, 0, 0, []);

    // 3) Bangun hasil.
    var melds = [];
    best.masks.forEach(function (m) {
      var group = [];
      for (var i = 0; i < n; i++) if (m & (1 << i)) group.push(cards[i]);
      melds.push({ cards: group, type: meldType(group), points: meldPoints(group) });
    });
    var deadwood = [];
    for (var i = 0; i < n; i++) if (!(best.usedMask & (1 << i))) deadwood.push(cards[i]);

    return {
      melds: melds,
      deadwood: deadwood,
      meldPoints: best.points === -Infinity ? 0 : best.points,
      usedMask: best.usedMask
    };
  }

  function popcount(x) {
    var c = 0;
    while (x) { x &= x - 1; c++; }
    return c;
  }

  var api = {
    isSet: isSet,
    isRun: isRun,
    isValidMeld: isValidMeld,
    meldType: meldType,
    meldPoints: meldPoints,
    findBestMelds: findBestMelds
  };

  global.Melds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
