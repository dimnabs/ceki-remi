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

  function bestPoints(cards) {
    return Melds.findBestMelds(cards).meldPoints;
  }

  // Keputusan fase AMBIL: 'discard' atau 'deck'.
  function decideDraw(game) {
    var top = game.topDiscard();
    if (!top) return 'deck';
    var p = game.currentPlayer();
    var base = bestPoints(p.hand);
    var withCard = bestPoints(p.hand.concat([top]));
    // Ambil dari buangan bila kartu itu menambah potensi poin meld.
    return withCard > base ? 'discard' : 'deck';
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
