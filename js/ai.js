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
  function popcount(x) { var c = 0; while (x) { x &= x - 1; c++; } return c; }

  // Cari meld terbaik di antara subset kartu, dengan filter tipe & batasan.
  //   opts.noJoker    : abaikan subset yang mengandung joker
  //   opts.must       : kartu yang WAJIB ada di subset (atau null)
  //   accept(type)    : true bila tipe meld diterima
  function scanBestMeld(cards, opts, accept) {
    var n = cards.length, best = null;
    for (var mask = 1; mask < (1 << n); mask++) {
      if (popcount(mask) < 3) continue;
      var subset = [], hasJoker = false, hasMust = !opts.must;
      for (var i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          subset.push(cards[i]);
          if (cards[i].joker) hasJoker = true;
          if (opts.must && cards[i] === opts.must) hasMust = true;
        }
      }
      if (!hasMust) continue;
      if (opts.noJoker && hasJoker) continue;
      if (!Melds.isValidMeld(subset)) continue;
      var type = Melds.meldType(subset);
      if (!accept(type)) continue;
      var pts = Melds.meldPoints(subset);
      if (!best || pts > best.points ||
          (pts === best.points && type === 'run' && best.type !== 'run')) {
        best = { cards: subset, type: type, points: pts };
      }
    }
    return best;
  }

  /*
   * Rencanakan meld yang diturunkan, mematuhi aturan:
   *  - seri harus turun sebelum set (set butuh minimal satu seri),
   *  - kartu wajib dari buangan (game.mustMeldCard) diturunkan lebih dulu.
   */
  function decideMelds(game) {
    var p = game.currentPlayer();
    var hand = p.hand.slice();
    var hasLaid = p.hasLaidMeld;
    var hasRun = p.melds.some(function (m) { return m.type === 'run'; });
    var must = game.mustMeldCard || null;
    var planned = [];

    function removeAll(group) {
      group.forEach(function (c) { var i = hand.indexOf(c); if (i !== -1) hand.splice(i, 1); });
    }

    // 1) Penuhi kewajiban kartu buangan lebih dulu (meld harus memuatnya).
    if (must && hand.indexOf(must) !== -1) {
      var forced = scanBestMeld(hand, { noJoker: !hasLaid, must: must }, function (t) {
        return t === 'run' || (t === 'set' && hasRun);
      });
      if (forced) {
        planned.push(forced.cards.slice());
        removeAll(forced.cards);
        hasLaid = true;
        if (forced.type === 'run') hasRun = true;
      }
    }

    // 2) Turunkan meld greedily — seri dulu bila belum ada seri.
    while (true) {
      if (!hasRun) {
        var run = scanBestMeld(hand, { noJoker: !hasLaid }, function (t) { return t === 'run'; });
        if (!run) break; // tanpa seri, set belum boleh diturunkan
        planned.push(run.cards.slice());
        removeAll(run.cards);
        hasLaid = true; hasRun = true;
      } else {
        var fb = Melds.findBestMelds(hand, { allowJoker: hasLaid });
        if (fb.melds.length === 0) break;
        var meld = fb.melds.slice().sort(function (a, b) { return b.points - a.points; })[0];
        planned.push(meld.cards.slice());
        removeAll(meld.cards);
        hasLaid = true;
        if (meld.type === 'run') hasRun = true;
      }
    }

    // Pastikan tersisa >= 1 kartu non-joker untuk dibuang.
    // hand = sisa yang TIDAK diturunkan.
    var nonJokerLeft = hand.filter(function (c) { return !c.joker; }).length;
    if (nonJokerLeft === 0 && planned.length > 0) {
      // Kembalikan satu kartu non-joker dari meld terakhir agar bisa dibuang.
      for (var i = planned.length - 1; i >= 0 && nonJokerLeft === 0; i--) {
        var grp = planned[i];
        if (must && grp.indexOf(must) !== -1) continue; // jangan bongkar meld wajib
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

  function sameRunBlock(a, b) {
    var lowA = a >= 2 && a <= 10, lowB = b >= 2 && b <= 10;
    var hiA = a >= 11 && a <= 13, hiB = b >= 11 && b <= 13;
    return (lowA && lowB) || (hiA && hiB);
  }

  // Seberapa berguna kartu ini dipertahankan (potensi jadi set/seri)?
  function usefulness(hand, card) {
    if (card.joker) return 999;
    var u = 0;
    for (var i = 0; i < hand.length; i++) {
      var o = hand[i];
      if (o === card || o.joker) continue;
      if (o.rank === card.rank) u += 3;                       // potensi set
      if (o.suit === card.suit && sameRunBlock(o.runPos, card.runPos) &&
          Math.abs(o.runPos - card.runPos) <= 2) u += 3;      // potensi seri
    }
    return u;
  }

  // Keputusan fase BUANG: kartu deadwood paling tak berguna & bernilai besar.
  function decideDiscard(game) {
    var p = game.currentPlayer();
    var nonJoker = p.hand.filter(function (c) { return !c.joker; });
    if (nonJoker.length === 0) return null; // hanya joker (semestinya tak terjadi)

    var fb = Melds.findBestMelds(p.hand, { allowJoker: p.hasLaidMeld });
    var deadwood = fb.deadwood.filter(function (c) { return !c.joker; });
    var pool = deadwood.length > 0 ? deadwood : nonJoker;
    // Buang yang paling tak berpotensi (usefulness terkecil), lalu nilai terbesar.
    pool.sort(function (a, b) {
      var ua = usefulness(p.hand, a), ub = usefulness(p.hand, b);
      if (ua !== ub) return ua - ub;
      return b.value - a.value;
    });
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
