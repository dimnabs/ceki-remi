/*
 * game.js — Mesin aturan Remi 7 Kartu / Ceki.
 *
 * Alur giliran:
 *   1. AMBIL  : dari deck, ATAU dari tumpukan buangan — boleh mengambil kartu
 *               yang diinginkan (maksimal 7 kartu dari atas) beserta semua
 *               kartu di atasnya, dengan syarat pemain punya >= 2 kartu di
 *               tangan yang bisa membentuk meld dengan kartu itu.
 *   2. TURUNKAN (opsional): letakkan meld (set/seri) >= 3 kartu.
 *   3. BUANG  : buang 1 kartu ke tumpukan buangan.
 *
 * Sesi berakhir bila deck habis atau ada pemain "tutup tangan" (hand kosong
 * setelah membuang). Skor diakumulasi antar-sesi hingga ada yang capai target.
 */
(function (global) {
  'use strict';

  var Deck = global.Deck || (typeof require !== 'undefined' ? require('./deck.js') : null);
  var Melds = global.Melds || (typeof require !== 'undefined' ? require('./melds.js') : null);

  // Target kemenangan. Aturan makalah ITB memakai 1000; di sini default 500
  // (aturan rumah) agar satu permainan selesai dalam waktu wajar. Dapat diubah
  // lewat opts.targetScore.
  var TARGET_SCORE = 500;
  var CLOSE_BONUS = 250;
  var CLOSE_BONUS_JOKER = 500;
  var JOKER_PENALTY = 500;

  function Game(playerNames, opts) {
    opts = opts || {};
    this.rng = opts.rng || Math.random;
    this.players = playerNames.map(function (name, i) {
      return {
        id: i,
        name: name,
        isHuman: i === 0,
        hand: [],
        melds: [],          // [{cards, type, points}]
        hasLaidMeld: false, // untuk aturan "meld pertama tanpa joker"
        score: 0            // total akumulasi antar sesi
      };
    });
    this.deck = [];
    this.discard = [];
    this.current = 0;
    this.phase = 'draw';    // 'draw' | 'act'
    this.sessionOver = false;
    this.gameOver = false;
    this.winner = null;
    this.mustMeldCard = null; // kartu buangan yang wajib dijadikan meld
    this.sessionNo = 0;
    this.log = [];
    this.lastResult = null; // ringkasan skor sesi terakhir
    this.turnCount = 0;
    // Safety agar sesi selalu berujung meski (secara teori) pemain terus
    // mengambil dari buangan. Dalam praktik sesi berakhir jauh lebih dulu saat
    // deck habis. Nilai besar agar tidak mengganggu permainan normal.
    this.maxTurns = opts.maxTurns || 400;
    this.maxDiscardTake = opts.maxDiscardTake || 7; // maks kartu diambil dari buangan
    this.targetScore = opts.targetScore || TARGET_SCORE;
  }

  Game.prototype._log = function (msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  };

  Game.prototype.startSession = function (firstPlayer) {
    this.sessionNo++;
    this.deck = Deck.shuffle(Deck.buildDeck(), this.rng);
    this.discard = [];
    this.sessionOver = false;
    this.lastResult = null;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      p.hand = [];
      p.melds = [];
      p.hasLaidMeld = false;
    }
    // Bagikan 7 kartu per pemain.
    for (var c = 0; c < 7; c++) {
      for (var j = 0; j < this.players.length; j++) {
        this.players[j].hand.push(this.deck.pop());
      }
    }
    // Buka satu kartu awal ke tumpukan buangan.
    this.discard.push(this.deck.pop());
    this.current = (typeof firstPlayer === 'number') ? firstPlayer : 0;
    this.phase = 'draw';
    this.turnCount = 0;
    this.mustMeldCard = null;
    this._sortHand(this.players[0]);
    this._log('— Sesi ' + this.sessionNo + ' dimulai. ' +
      this.players[this.current].name + ' jalan pertama. —');
    return this;
  };

  Game.prototype._sortHand = function (player) {
    player.hand.sort(function (a, b) {
      if (a.joker && !b.joker) return 1;
      if (b.joker && !a.joker) return -1;
      if (a.joker && b.joker) return 0;
      if (a.suit !== b.suit) return Deck.SUITS.indexOf(a.suit) - Deck.SUITS.indexOf(b.suit);
      return a.runPos - b.runPos;
    });
  };

  Game.prototype.currentPlayer = function () { return this.players[this.current]; };
  Game.prototype.topDiscard = function () {
    return this.discard.length ? this.discard[this.discard.length - 1] : null;
  };

  // ---- AMBIL ----
  Game.prototype.drawFromDeck = function () {
    if (this.phase !== 'draw') return { ok: false, reason: 'Bukan fase ambil.' };
    if (this.deck.length === 0) {
      this._endSessionDeckEmpty();
      return { ok: false, reason: 'deck-habis' };
    }
    var p = this.currentPlayer();
    var card = this.deck.pop();
    p.hand.push(card);
    this._sortHand(p);
    this.phase = 'act';
    this._log(p.name + ' mengambil dari deck.');
    return { ok: true, card: card };
  };

  // Adakah 3-kartu meld yang SAH & boleh diturunkan SEKARANG memakai `card`
  // (mempertimbangkan: meld pertama tanpa joker, dan set butuh seri lebih dulu)?
  Game.prototype._canFormLegalMeldWith = function (player, card) {
    var hand = player.hand;
    var hasRun = player.melds.some(function (m) { return m.type === 'run'; });
    var firstMeld = !player.hasLaidMeld;
    for (var i = 0; i < hand.length; i++) {
      for (var j = i + 1; j < hand.length; j++) {
        var group = [card, hand[i], hand[j]];
        if (!Melds.isValidMeld(group)) continue;
        var type = Melds.meldType(group);
        var hasJoker = group.some(function (c) { return c.joker; });
        if (firstMeld && hasJoker) continue;     // meld pertama tanpa joker
        if (type === 'set' && !hasRun) continue; // set butuh seri lebih dulu
        return true;
      }
    }
    return false;
  };

  // Bolehkah mengambil `depth` kartu teratas dari buangan? (syarat aturan)
  Game.prototype.canTakeDiscard = function (depth) {
    if (this.phase !== 'draw') return false;
    if (depth < 1 || depth > this.maxDiscardTake) return false;
    if (depth > this.discard.length) return false;
    var p = this.currentPlayer();
    // Setelah wajib-meld (>=3 kartu) harus tetap ada >=1 kartu untuk dibuang.
    // Jadi total kartu setelah mengambil minimal 4 (3 untuk meld + 1 buangan).
    if (p.hand.length + depth < 4) return false;
    // Kartu yang "diinginkan" adalah yang terdalam dari yang diambil.
    var wanted = this.discard[this.discard.length - depth];
    return this._canFormLegalMeldWith(p, wanted);
  };

  // Ambil `depth` kartu teratas dari buangan (kartu diinginkan + semua di atasnya).
  // Kartu yang diinginkan WAJIB diturunkan sebagai bagian meld pada giliran ini.
  Game.prototype.takeDiscard = function (depth) {
    depth = depth || 1;
    if (this.phase !== 'draw') return { ok: false, reason: 'Bukan fase ambil.' };
    if (this.discard.length === 0) return { ok: false, reason: 'Tumpukan buangan kosong.' };
    if (depth > this.maxDiscardTake) return { ok: false, reason: 'Maksimal ' + this.maxDiscardTake + ' kartu dari atas.' };
    if (depth > this.discard.length) return { ok: false, reason: 'Tidak sebanyak itu di buangan.' };
    var wanted = this.discard[this.discard.length - depth];
    var p = this.currentPlayer();
    if (p.hand.length + depth < 4) {
      return { ok: false, reason: 'Kartu tak cukup — setelah menurunkan meld harus tersisa 1 kartu untuk dibuang.' };
    }
    if (!this._canFormLegalMeldWith(p, wanted)) {
      return { ok: false, reason: 'Butuh 2 kartu di tangan yang bisa jadi meld dengan ' + Deck.cardLabel(wanted) + '.' };
    }
    var taken = this.discard.splice(this.discard.length - depth, depth);
    for (var k = 0; k < taken.length; k++) p.hand.push(taken[k]);
    this._sortHand(p);
    this.phase = 'act';
    // Kartu ini wajib menjadi bagian meld sebelum boleh membuang.
    this.mustMeldCard = wanted;
    this._log(p.name + ' mengambil ' + taken.length + ' kartu dari buangan (' +
      taken.map(Deck.cardLabel).join(' ') + ').');
    return { ok: true, cards: taken };
  };

  // ---- TURUNKAN MELD ----
  // cards: array kartu dari tangan pemain saat ini.
  Game.prototype.layMeld = function (cards) {
    if (this.phase !== 'act') return { ok: false, reason: 'Ambil kartu dulu.' };
    var p = this.currentPlayer();
    if (!cards || cards.length < 3) return { ok: false, reason: 'Meld minimal 3 kartu.' };
    // Semua kartu harus ada di tangan.
    for (var i = 0; i < cards.length; i++) {
      if (p.hand.indexOf(cards[i]) === -1) return { ok: false, reason: 'Kartu tidak di tangan.' };
    }
    var type = Melds.meldType(cards);
    if (!type) return { ok: false, reason: 'Bukan set / seri yang valid.' };
    var hasJoker = cards.some(function (c) { return c.joker; });
    if (!p.hasLaidMeld && hasJoker) {
      return { ok: false, reason: 'Meld pertama tidak boleh memakai joker.' };
    }
    // Aturan: set hanya boleh setelah pemain menurunkan minimal satu seri.
    if (type === 'set') {
      var hasRun = p.melds.some(function (m) { return m.type === 'run'; });
      if (!hasRun) return { ok: false, reason: 'Set hanya boleh setelah menurunkan seri (urut) lebih dulu.' };
    }
    // Aturan: tiap giliran wajib membuang 1 kartu — jangan turunkan kartu terakhir.
    if (p.hand.length - cards.length < 1) {
      return { ok: false, reason: 'Sisakan minimal 1 kartu untuk dibuang.' };
    }
    // Pindahkan kartu dari tangan ke meld.
    for (var k = 0; k < cards.length; k++) {
      p.hand.splice(p.hand.indexOf(cards[k]), 1);
    }
    var points = Melds.meldPoints(cards);
    p.melds.push({ cards: cards.slice(), type: type, points: points });
    p.hasLaidMeld = true;
    // Bila meld ini memuat kartu wajib dari buangan, kewajiban terpenuhi.
    if (this.mustMeldCard && cards.indexOf(this.mustMeldCard) !== -1) {
      this.mustMeldCard = null;
    }
    this._log(p.name + ' menurunkan ' + (type === 'set' ? 'set' : 'seri') +
      ' (' + cards.map(Deck.cardLabel).join(' ') + ') +' + points);
    return { ok: true, type: type, points: points };
  };

  // ---- BUANG ----
  Game.prototype.discardCard = function (card) {
    if (this.phase !== 'act') return { ok: false, reason: 'Ambil kartu dulu.' };
    var p = this.currentPlayer();
    if (p.hand.indexOf(card) === -1) return { ok: false, reason: 'Kartu tidak di tangan.' };
    // Aturan: kartu yang diambil dari buangan wajib diturunkan sebagai meld dulu.
    if (this.mustMeldCard) {
      return { ok: false, reason: 'Turunkan dulu meld yang memuat ' + Deck.cardLabel(this.mustMeldCard) + ' (kartu dari buangan).' };
    }
    if (card.joker) {
      var hasNonJoker = p.hand.some(function (c) { return !c.joker; });
      if (hasNonJoker) return { ok: false, reason: 'Joker tidak boleh dibuang.' };
      // Terpaksa (hanya joker tersisa): aturan asli — membuang joker mengakhiri sesi.
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this._log(p.name + ' terpaksa membuang joker — sesi berakhir.');
      this._scoreSession(null, 0);
      return { ok: true, jokerEnded: true };
    }
    p.hand.splice(p.hand.indexOf(card), 1);
    this.discard.push(card);
    this._log(p.name + ' membuang ' + Deck.cardLabel(card) + '.');

    // Tutup tangan: tangan kosong setelah membuang.
    if (p.hand.length === 0) {
      this._endSessionClosed(p);
      return { ok: true, closed: true };
    }
    this._nextTurn();
    return { ok: true, closed: false };
  };

  Game.prototype._nextTurn = function () {
    this.turnCount++;
    // Safety: sesi yang (secara teori) tak berujung diakhiri seperti deck habis.
    if (this.turnCount >= this.maxTurns) { this._endSessionDeckEmpty(); return; }
    this.current = (this.current + 1) % this.players.length;
    this.phase = 'draw';
    this.mustMeldCard = null;
    // Aturan: bila deck sudah habis, sesi berakhir.
    if (this.deck.length === 0) { this._endSessionDeckEmpty(); }
  };

  // ---- AKHIR SESI ----
  Game.prototype._endSessionClosed = function (closer) {
    var jokerInMelds = closer.melds.some(function (m) {
      return m.cards.some(function (c) { return c.joker; });
    });
    var bonus = jokerInMelds ? CLOSE_BONUS_JOKER : CLOSE_BONUS;
    this._log('★ ' + closer.name + ' TUTUP TANGAN! Bonus +' + bonus + '.');
    this._scoreSession(closer, bonus);
  };

  Game.prototype._endSessionDeckEmpty = function () {
    if (this.sessionOver) return;
    this._log('Deck habis — sesi berakhir tanpa tutup tangan.');
    this._scoreSession(null, 0);
  };

  Game.prototype._scoreSession = function (closer, bonus) {
    if (this.sessionOver) return;
    this.sessionOver = true;
    this.phase = 'over';
    var rows = [];
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      var meldPts = 0;
      for (var m = 0; m < p.melds.length; m++) meldPts += p.melds[m].points;

      var deadwood = 0, jokerPenalty = 0;
      for (var h = 0; h < p.hand.length; h++) {
        if (p.hand[h].joker) jokerPenalty += JOKER_PENALTY;
        else deadwood += p.hand[h].value;
      }
      var closeBonus = (closer && p === closer) ? bonus : 0;
      var delta = meldPts - deadwood - jokerPenalty + closeBonus;
      p.score += delta;
      rows.push({
        id: p.id, name: p.name, meldPts: meldPts, deadwood: deadwood,
        jokerPenalty: jokerPenalty, closeBonus: closeBonus, delta: delta,
        total: p.score, handLeft: p.hand.slice()
      });
    }
    this.lastResult = { closer: closer ? closer.id : null, rows: rows };

    // Cek akhir permainan.
    var maxScore = -Infinity, winner = null;
    for (var w = 0; w < this.players.length; w++) {
      if (this.players[w].score > maxScore) { maxScore = this.players[w].score; winner = this.players[w]; }
    }
    if (maxScore >= this.targetScore) {
      this.gameOver = true;
      this.winner = winner;
      this._log('🏆 ' + winner.name + ' menang permainan dengan ' + winner.score + ' poin!');
    }
    return this.lastResult;
  };

  // Pemain pertama sesi berikutnya = peraih skor terbesar saat ini.
  Game.prototype.nextSessionStarter = function () {
    var maxScore = -Infinity, idx = 0;
    for (var i = 0; i < this.players.length; i++) {
      if (this.players[i].score > maxScore) { maxScore = this.players[i].score; idx = i; }
    }
    return idx;
  };

  Game.TARGET_SCORE = TARGET_SCORE;

  global.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
})(typeof window !== 'undefined' ? window : globalThis);
