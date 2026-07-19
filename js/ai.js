/*
 * ai.js — Bot ber-strategi GREEDY untuk Ceki (mengacu makalah IF2211 ITB).
 *
 * Semboyan greedy: "take what you can get now" — di tiap langkah pilih aksi
 * yang memaksimalkan poin lokal:
 *   - AMBIL   : ambil kartu buangan hanya bila menaikkan potensi poin meld,
 *               selain itu ambil dari deck.
 *   - TURUNKAN: turunkan meld sebanyak mungkin (meld pertama tanpa joker).
 *   - BUANG   : buang kartu bernilai terbesar yang tidak berpotensi jadi.
 */
(function (global) {
  'use strict';

  var Deck = global.Deck || (typeof require !== 'undefined' ? require('./deck.js') : null);
  var Melds = global.Melds || (typeof require !== 'undefined' ? require('./melds.js') : null);

  function deadwoodValue(cards) {
    var dv = 0;
    for (var i = 0; i < cards.length; i++) dv += cards[i].joker ? 500 : cards[i].value;
    return dv;
  }

  // Skor tangan = poin meld terbaik dikurangi nilai kartu sisa (deadwood).
  // Dipakai agar bot tak serakah mengambil banyak kartu buangan yang jadi sampah.
  function handScore(cards) {
    var fb = Melds.findBestMelds(cards);
    return fb.meldPoints - deadwoodValue(fb.deadwood);
  }

  // Keputusan fase AMBIL. Mengembalikan { source:'deck' } atau
  // { source:'discard', depth:N } — memilih kedalaman terbaik dari buangan.
  function decideDraw(game) {
    var p = game.currentPlayer();
    var base = handScore(p.hand);
    var len = game.discard.length;
    var maxD = Math.min(game.maxDiscardTake, len);
    var best = { gain: 0, depth: 0 };
    for (var d = 1; d <= maxD; d++) {
      if (!game.canTakeDiscard(d)) continue;
      var taken = game.discard.slice(len - d);
      var gain = handScore(p.hand.concat(taken)) - base;
      if (gain > best.gain) best = { gain: gain, depth: d };
    }
    // Ambil dari buangan hanya bila benar-benar meningkatkan nilai tangan.
    return best.depth > 0 ? { source: 'discard', depth: best.depth } : { source: 'deck' };
  }

  /*
   * Rencanakan meld yang akan diturunkan giliran ini.
   * Mengembalikan array grup kartu (urut turun). Menyisakan minimal satu
   * kartu non-joker di tangan agar selalu bisa membuang.
   * Jika seluruh kartu bisa dibuat meld dan tepat satu tersisa -> tutup tangan.
   */
  function decideMelds(game) {
    var p = game.currentPlayer();
    var hand = p.hand.slice();
    var hasLaid = p.hasLaidMeld;
    var planned = [];

    while (true) {
      var fb = Melds.findBestMelds(hand, { allowJoker: hasLaid });
      if (fb.melds.length === 0) break;
      // Ambil satu meld (poin terbesar) untuk diturunkan.
      var meld = fb.melds.slice().sort(function (a, b) { return b.points - a.points; })[0];
      planned.push(meld.cards.slice());
      // Kurangi tangan.
      meld.cards.forEach(function (c) {
        var idx = hand.indexOf(c);
        if (idx !== -1) hand.splice(idx, 1);
      });
      hasLaid = true;
    }

    // Pastikan tersisa >= 1 kartu non-joker untuk dibuang.
    // hand = sisa yang TIDAK diturunkan.
    var nonJokerLeft = hand.filter(function (c) { return !c.joker; }).length;
    if (nonJokerLeft === 0 && planned.length > 0) {
      // Kembalikan satu kartu non-joker dari meld terakhir agar bisa dibuang.
      for (var i = planned.length - 1; i >= 0 && nonJokerLeft === 0; i--) {
        var grp = planned[i];
        var cand = grp.filter(function (c) { return !c.joker; });
        if (cand.length > 0) {
          // Buang kartu bernilai terkecil dari meld agar kerugian minimal.
          cand.sort(function (a, b) { return a.value - b.value; });
          var give = cand[0];
          var gi = grp.indexOf(give);
          grp.splice(gi, 1);
          if (grp.length < 3) planned.splice(i, 1); // meld pecah -> batalkan
          nonJokerLeft = 1;
        }
      }
    }
    return planned;
  }

  // Keputusan fase BUANG: kartu non-joker bernilai terbesar yang deadwood.
  function decideDiscard(game) {
    var p = game.currentPlayer();
    var nonJoker = p.hand.filter(function (c) { return !c.joker; });
    if (nonJoker.length === 0) return null; // hanya joker (semestinya tak terjadi)

    var fb = Melds.findBestMelds(p.hand, { allowJoker: p.hasLaidMeld });
    var deadwood = fb.deadwood.filter(function (c) { return !c.joker; });
    var pool = deadwood.length > 0 ? deadwood : nonJoker;
    pool.sort(function (a, b) { return b.value - a.value; });
    return pool[0];
  }

  var api = {
    decideDraw: decideDraw,
    decideMelds: decideMelds,
    decideDiscard: decideDiscard
  };

  global.AI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
