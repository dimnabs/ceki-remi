/*
 * game.js — Mesin aturan Remi 7 Kartu / Ceki.
 *
 * Alur giliran:
 *   1. AMBIL  : dari deck atau dari puncak tumpukan buangan.
 *   2. TURUNKAN (opsional): letakkan meld (set/seri) >= 3 kartu.
 *   3. BUANG  : buang 1 kartu ke tumpukan buangan.
 *
 * Sesi berakhir bila deck habis atau ada pemain "tutup tangan" (hand kosong
 * setelah membuang). Skor diakumulasi antar-sesi hingga ada total > 1000.
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
    this.sessionNo = 0;
    this.log = [];
    this.lastResult = null; // ringkasan skor sesi terakhir
    this.turnCount = 0;
    this.maxTurns = opts.maxTurns || 120;   // safety agar sesi selalu berujung
    // Berapa kali tumpukan buangan boleh dikocok ulang jadi deck saat deck habis.
    // Memberi kesempatan "tutup tangan" tanpa membuat ronde kepanjangan.
    this.maxReshuffles = (opts.maxReshuffles != null) ? opts.maxReshuffles : 2;
    this.reshuffles = 0;
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
    this.reshuffles = 0;
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

  // Isi ulang deck dari tumpukan buangan (sisakan kartu teratas).
  // Mengembalikan false bila tidak cukup kartu untuk diisi ulang.
  Game.prototype._replenishDeck = function () {
    if (this.reshuffles >= this.maxReshuffles) return false;
    if (this.discard.length <= 1) return false;
    var top = this.discard.pop();
    this.deck = Deck.shuffle(this.discard, this.rng);
    this.discard = [top];
    this.reshuffles++;
    this._log('Deck habis — tumpukan buangan dikocok ulang menjadi deck baru.');
    return true;
  };

  // ---- AMBIL ----
  Game.prototype.drawFromDeck = function () {
    if (this.phase !== 'draw') return { ok: false, reason: 'Bukan fase ambil.' };
    if (this.deck.length === 0 && !this._replenishDeck()) {
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

  Game.prototype.takeDiscard = function () {
    if (this.phase !== 'draw') return { ok: false, reason: 'Bukan fase ambil.' };
    if (this.discard.length === 0) return { ok: false, reason: 'Tumpukan buangan kosong.' };
    var p = this.currentPlayer();
    var card = this.discard.pop();
    p.hand.push(card);
    this._sortHand(p);
    this.phase = 'act';
    this._log(p.name + ' mengambil ' + Deck.cardLabel(card) + ' dari buangan.');
    return { ok: true, card: card };
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
    // Pindahkan kartu dari tangan ke meld.
    for (var k = 0; k < cards.length; k++) {
      p.hand.splice(p.hand.indexOf(cards[k]), 1);
    }
    var points = Melds.meldPoints(cards);
    p.melds.push({ cards: cards.slice(), type: type, points: points });
    p.hasLaidMeld = true;
    this._log(p.name + ' menurunkan ' + (type === 'set' ? 'set' : 'seri') +
      ' (' + cards.map(Deck.cardLabel).join(' ') + ') +' + points);
    return { ok: true, type: type, points: points };
  };

  // ---- BUANG ----
  Game.prototype.discardCard = function (card) {
    if (this.phase !== 'act') return { ok: false, reason: 'Ambil kartu dulu.' };
    var p = this.currentPlayer();
    if (p.hand.indexOf(card) === -1) return { ok: false, reason: 'Kartu tidak di tangan.' };
    if (card.joker) return { ok: false, reason: 'Joker tidak boleh dibuang.' };
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
    // Safety: sesi yang terlalu panjang diakhiri seperti deck habis.
    if (this.turnCount >= this.maxTurns) { this._endSessionDeckEmpty(); return; }
    this.current = (this.current + 1) % this.players.length;
    this.phase = 'draw';
    // Jika deck & buangan tak bisa lagi menyediakan kartu, akhiri sesi.
    if (this.deck.length === 0 && this.discard.length <= 1) { this._endSessionDeckEmpty(); }
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
