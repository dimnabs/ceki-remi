/*
 * CekiRoom.js — Room Colyseus OTORITATIF untuk Ceki.
 *
 * Server memegang instance Game (engine yang sama dengan versi lokal). Deck &
 * tangan pemain hanya ada di sini; client menerima state publik (Schema) +
 * tangannya sendiri (pesan 'hand'). Semua aksi divalidasi ulang oleh engine.
 */
const { Room } = require('colyseus');
const { GameState, SeatView, MeldView, CardView } = require('./schema');

// Engine (dipakai ulang apa adanya dari frontend).
const Game = require('../js/game.js');
const AI = require('../js/ai.js');

const MAX_SEATS = 4;
const TURN_MS = 45000;          // batas waktu giliran manusia
const RECONNECT_MS = 60000;     // jendela reconnect
const NEXT_SESSION_MS = 4500;   // jeda sebelum sesi berikutnya
const BOT = { draw: 700, act: 550, lay: 500, discard: 350 };

class CekiRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_SEATS;
    this.setState(new GameState());
    this.state.phase = 'lobby';
    this.state.current = -1;
    this.state.hostSeat = 0;
    this.state.targetScore = clampTarget(options && options.targetScore);
    this.state.turnEndsAt = 0;

    this.code = (options && options.code) || this.roomId;
    this.setMetadata({ code: this.code });

    this.game = null;
    this.seatMeta = [];   // [{ sessionId, isBot, disconnected }]
    this.turnTimer = null;
    this.botToken = 0;     // membatalkan rangkaian bot lama

    this.onMessage('setReady', (client, m) => this.onSetReady(client, m));
    this.onMessage('setTarget', (client, m) => this.onSetTarget(client, m));
    this.onMessage('addBot', (client) => this.onAddBot(client));
    this.onMessage('removeBot', (client, m) => this.onRemoveBot(client, m));
    this.onMessage('startGame', (client) => this.onStartGame(client));
    this.onMessage('playAgain', (client) => this.onPlayAgain(client));

    this.onMessage('drawDeck', (client) => this.onAction(client, (g) => g.drawFromDeck()));
    this.onMessage('takeDiscard', (client, m) =>
      this.onAction(client, (g) => g.takeDiscard(Math.max(1, (m && m.depth) | 0))));
    this.onMessage('layMeld', (client, m) => this.onAction(client, (g) => {
      var cards = this.cardsFromIds(g, m && m.cardIds);
      if (!cards) return { ok: false, reason: 'Kartu tidak dikenali.' };
      return g.layMeld(cards);
    }));
    this.onMessage('discard', (client, m) => this.onAction(client, (g) => {
      var card = this.cardFromId(g, m && m.cardId);
      if (!card) return { ok: false, reason: 'Kartu tidak dikenali.' };
      return g.discardCard(card);
    }));
  }

  // ---------- Lobby ----------
  onJoin(client, options) {
    if (this.seatMeta.length >= MAX_SEATS) throw new Error('Room penuh.');
    var seat = this.seatMeta.length;
    this.seatMeta.push({ sessionId: client.sessionId, isBot: false, disconnected: false });
    var view = new SeatView();
    view.nickname = sanitizeName((options && options.nickname) || ('Pemain ' + (seat + 1)));
    view.connected = true;
    view.isBot = false;
    view.ready = false;
    view.handCount = 0;
    view.score = 0;
    this.state.seats.push(view);
    if (this.connectedHumans().length === 1) this.state.hostSeat = seat;
    this.pushLog(view.nickname + ' bergabung.');
    client.send('welcome', { seat: seat, code: this.code });
  }

  async onLeave(client, consented) {
    var seat = this.seatOf(client);
    if (seat < 0) return;
    this.state.seats[seat].connected = false;
    this.seatMeta[seat].disconnected = true;
    this.reassignHost();

    if (this.game && !this.game.gameOver && !this.state.phase.startsWith('lobby')) {
      // Selama game berlangsung: bot mengambil alih; beri kesempatan reconnect.
      this.pushLog(this.state.seats[seat].nickname + ' terputus — bot mengambil alih (60s).');
      if (this.isCurrentSeat(seat)) this.beginTurn(); // bot langsung jalan bila gilirannya
      try {
        await this.allowReconnection(client, RECONNECT_MS / 1000);
        this.seatMeta[seat].sessionId = client.sessionId;
        this.seatMeta[seat].disconnected = false;
        this.state.seats[seat].connected = true;
        this.pushLog(this.state.seats[seat].nickname + ' tersambung kembali.');
        this.sendHand(seat);
      } catch (e) { /* tetap dikendalikan bot */ }
    }
  }

  onSetReady(client, m) {
    if (this.state.phase !== 'lobby') return;
    var seat = this.seatOf(client); if (seat < 0) return;
    this.state.seats[seat].ready = !!(m && m.ready);
  }

  onSetTarget(client, m) {
    if (this.state.phase !== 'lobby' || !this.isHost(client)) return;
    this.state.targetScore = clampTarget(m && m.target);
  }

  onAddBot(client) {
    if (this.state.phase !== 'lobby' || !this.isHost(client)) return;
    if (this.seatMeta.length >= MAX_SEATS) return;
    var seat = this.seatMeta.length;
    this.seatMeta.push({ sessionId: null, isBot: true, disconnected: false });
    var view = new SeatView();
    view.nickname = 'Bot ' + botLetter(seat);
    view.connected = true; view.isBot = true; view.ready = true;
    view.handCount = 0; view.score = 0;
    this.state.seats.push(view);
  }

  onRemoveBot(client, m) {
    if (this.state.phase !== 'lobby' || !this.isHost(client)) return;
    var seat = (m && m.seat) | 0;
    if (seat < 0 || seat >= this.seatMeta.length) return;
    if (!this.seatMeta[seat].isBot) return;
    if (seat !== this.seatMeta.length - 1) return; // hanya kursi terakhir agar indeks stabil
    this.seatMeta.pop();
    this.state.seats.pop();
  }

  onStartGame(client) {
    if (this.state.phase !== 'lobby' || !this.isHost(client)) return;
    if (this.seatMeta.length < 2) { this.sendError(client, 'Butuh minimal 2 pemain.'); return; }
    var names = this.state.seats.map(function (s) { return s.nickname; });
    this.game = new Game(names, { targetScore: this.state.targetScore });
    var starter = Math.floor(Math.random() * names.length);
    this.game.startSession(starter);
    this.game.players.forEach((p) => this.game._sortHand(p)); // rapikan semua tangan
    this.lock();
    this.syncPublic();
    this.sendHandsAll();
    this.pushLog('Permainan dimulai. Target ' + this.state.targetScore + '.');
    this.beginTurn();
  }

  onPlayAgain(client) {
    if (this.state.phase !== 'gameOver' || !this.isHost(client)) return;
    this.game = null;
    this.clearTurnTimer();
    this.botToken++;
    this.state.phase = 'lobby';
    this.state.current = -1;
    this.state.turnEndsAt = 0;
    this.state.winnerNickname = '';
    this.state.mustMeldCardId = '';
    this.state.discardTop.splice(0);
    this.state.seats.forEach(function (s) { s.handCount = 0; s.score = 0; s.melds.splice(0); s.ready = s.isBot; });
    this.unlock();
    this.pushLog('Kembali ke lobby. Host bisa memulai lagi.');
  }

  // ---------- Aksi giliran ----------
  onAction(client, fn) {
    var g = this.game;
    if (!g || g.sessionOver) return;
    var seat = this.seatOf(client);
    if (seat !== g.current) { this.sendError(client, 'Bukan giliranmu.'); return; }
    var res = fn(g);
    // Sesi bisa berakhir sebagai EFEK SAMPING aksi (deck habis saat draw, tutup
    // tangan / buang joker saat discard) meski res.ok bisa false (mis. deck-habis).
    if (g.sessionOver) { this.afterAction(g); return; }
    if (!res || !res.ok) { this.sendError(client, (res && res.reason) || 'Aksi tidak valid.'); return; }
    this.afterAction(g);
  }

  // Dipanggil setelah aksi manusia. Draw/take/lay -> giliran tetap (fase 'act').
  // Buang -> engine memindah current & fase kembali 'draw' -> mulai giliran baru.
  afterAction(g) {
    this.syncPublic();
    this.sendHandsAll();
    if (g.sessionOver) { this.handleSessionEnd(g); return; }
    if (g.phase === 'draw') this.beginTurn(); // giliran berpindah setelah buang
  }

  // ---------- Alur giliran ----------
  beginTurn() {
    this.clearTurnTimer();
    var g = this.game;
    if (!g || g.sessionOver) return;
    var seat = g.current;
    if (this.isBotSeat(seat)) {
      this.state.turnEndsAt = 0;
      this.runBotTurn(seat);
    } else {
      this.state.turnEndsAt = Date.now() + TURN_MS;
      this.turnTimer = this.clock.setTimeout(() => this.autoMove(seat), TURN_MS);
    }
  }

  autoMove(seat) {
    var g = this.game;
    if (!g || g.sessionOver || g.current !== seat) return;
    // Aksi aman: bila belum ambil, ambil dari deck; lalu buang kartu ter-aman.
    if (g.phase === 'draw') g.drawFromDeck();
    if (g.sessionOver) { this.afterBotStep(g, true); return; }
    // Bila ada kewajiban meld dari buangan (mestinya tak terjadi via autoMove), pakai bot.
    var plan = AI.decideMelds(g);
    for (var i = 0; i < plan.length; i++) g.layMeld(plan[i]);
    var card = AI.decideDiscard(g);
    if (card) g.discardCard(card);
    this.pushLog(this.state.seats[seat].nickname + ' kehabisan waktu — aksi otomatis.');
    this.afterBotStep(g, true);
  }

  async runBotTurn(seat) {
    var token = ++this.botToken;
    var g = this.game;
    var alive = () => this.game === g && !g.sessionOver && g.current === seat && token === this.botToken;
    await this.sleep(BOT.draw); if (!alive()) return;

    var d = AI.decideDraw(g);
    if (d.source === 'discard') g.takeDiscard(d.depth); else g.drawFromDeck();
    this.syncPublic(); this.sendHandsAll();
    if (g.sessionOver) return this.handleSessionEnd(g);

    var plan = AI.decideMelds(g);
    for (var i = 0; i < plan.length; i++) {
      await this.sleep(BOT.lay); if (!alive()) return;
      var r = g.layMeld(plan[i]);
      if (r.ok) { this.syncPublic(); this.sendHandsAll(); }
    }
    await this.sleep(BOT.discard); if (!alive()) return;

    var card = AI.decideDiscard(g);
    if (card) g.discardCard(card);
    this.afterBotStep(g, false);
  }

  // Setelah buang (bot / auto): sinkron & tentukan langkah berikut.
  afterBotStep(g, fromAuto) {
    this.syncPublic(); this.sendHandsAll();
    if (g.sessionOver) return this.handleSessionEnd(g);
    this.beginTurn();
  }

  handleSessionEnd(g) {
    this.clearTurnTimer();
    this.state.turnEndsAt = 0;
    this.syncPublic();
    this.broadcast('event', { type: 'sessionResult', result: serializeResult(g), gameOver: g.gameOver });
    if (g.gameOver) {
      this.state.phase = 'gameOver';
      this.state.winnerNickname = g.winner ? g.winner.name : '';
      return;
    }
    this.state.phase = 'sessionOver';
    this.clock.setTimeout(() => {
      if (!this.game || this.game !== g) return;
      g.startSession(g.nextSessionStarter());
      g.players.forEach((p) => g._sortHand(p));
      this.syncPublic(); this.sendHandsAll();
      this.beginTurn();
    }, NEXT_SESSION_MS);
  }

  // ---------- Sinkronisasi ----------
  syncPublic() {
    var g = this.game;
    var s = this.state;
    if (!g) return;
    s.phase = g.gameOver ? 'gameOver' : (g.sessionOver ? 'sessionOver' : g.phase);
    s.current = g.sessionOver ? -1 : g.current;
    s.sessionNo = g.sessionNo;
    s.deckCount = g.deck.length;
    s.mustMeldCardId = g.mustMeldCard ? String(g.mustMeldCard.id) : '';

    for (var i = 0; i < g.players.length; i++) {
      var p = g.players[i], sv = s.seats[i];
      if (!sv) continue;
      sv.handCount = p.hand.length;
      sv.score = p.score;
      sv.melds.splice(0);
      for (var m = 0; m < p.melds.length; m++) {
        var mv = new MeldView();
        mv.type = p.melds[m].type; mv.points = p.melds[m].points;
        for (var c = 0; c < p.melds[m].cards.length; c++) mv.cards.push(cardView(p.melds[m].cards[c]));
        sv.melds.push(mv);
      }
    }
    // Kipas buangan: s.d. 7 kartu teratas, urut dari terdalam -> teratas.
    s.discardTop.splice(0);
    var start = Math.max(0, g.discard.length - g.maxDiscardTake);
    for (var k = start; k < g.discard.length; k++) s.discardTop.push(cardView(g.discard[k]));
    // Log (ambil 40 terakhir).
    s.log.splice(0);
    var logs = g.log.slice(-40);
    for (var l = 0; l < logs.length; l++) s.log.push(logs[l]);
  }

  sendHandsAll() {
    if (!this.game) return;
    for (var i = 0; i < this.seatMeta.length; i++) this.sendHand(i);
  }

  sendHand(seat) {
    if (!this.game) return;
    var meta = this.seatMeta[seat];
    if (!meta || meta.isBot || !meta.sessionId) return;
    var client = this.clientForSeat(seat);
    if (!client) return;
    var hand = this.game.players[seat].hand.map(cardView);
    client.send('hand', { cards: hand });
  }

  // ---------- Util ----------
  sleep(ms) { return new Promise((res) => this.clock.setTimeout(res, ms)); }
  clearTurnTimer() { if (this.turnTimer) { this.turnTimer.clear(); this.turnTimer = null; } }
  pushLog(msg) { this.state.log.push(msg); while (this.state.log.length > 40) this.state.log.shift(); }
  sendError(client, reason) { client.send('error', { reason: reason }); }

  seatOf(client) {
    for (var i = 0; i < this.seatMeta.length; i++)
      if (this.seatMeta[i].sessionId === client.sessionId) return i;
    return -1;
  }
  clientForSeat(seat) {
    var sid = this.seatMeta[seat] && this.seatMeta[seat].sessionId;
    if (!sid) return null;
    return this.clients.find(function (c) { return c.sessionId === sid; });
  }
  isBotSeat(seat) { var m = this.seatMeta[seat]; return !!(m && (m.isBot || m.disconnected)); }
  isCurrentSeat(seat) { return this.game && !this.game.sessionOver && this.game.current === seat; }
  isHost(client) { return this.seatOf(client) === this.state.hostSeat; }
  connectedHumans() { return this.seatMeta.filter(function (m) { return !m.isBot && !m.disconnected; }); }
  reassignHost() {
    if (this.seatMeta[this.state.hostSeat] && !this.seatMeta[this.state.hostSeat].disconnected) return;
    for (var i = 0; i < this.seatMeta.length; i++)
      if (!this.seatMeta[i].isBot && !this.seatMeta[i].disconnected) { this.state.hostSeat = i; return; }
  }
  cardFromId(g, id) {
    var hand = g.players[g.current].hand;
    for (var i = 0; i < hand.length; i++) if (String(hand[i].id) === String(id)) return hand[i];
    return null;
  }
  cardsFromIds(g, ids) {
    if (!Array.isArray(ids)) return null;
    var out = [];
    for (var i = 0; i < ids.length; i++) { var c = this.cardFromId(g, ids[i]); if (!c) return null; out.push(c); }
    return out;
  }
}

// ---------- Fungsi bebas ----------
function cardView(card) {
  var v = new CardView();
  v.id = String(card.id);
  v.rank = card.rank || '';
  v.suit = card.suit || '';
  v.joker = !!card.joker;
  v.color = card.color || '';
  return v;
}

function serializeResult(g) {
  var r = g.lastResult;
  if (!r) return null;
  return {
    closer: r.closer,
    rows: r.rows.map(function (row) {
      return {
        id: row.id, name: row.name, meldPts: row.meldPts, deadwood: row.deadwood,
        jokerPenalty: row.jokerPenalty, closeBonus: row.closeBonus, delta: row.delta, total: row.total
      };
    })
  };
}

function clampTarget(t) { t = t | 0; if (!t || t < 50) return 500; return Math.min(t, 5000); }
function sanitizeName(n) { return String(n || '').slice(0, 16).replace(/[<>]/g, '') || 'Pemain'; }
function botLetter(i) { return String.fromCharCode(65 + (i % 26)); }

module.exports = { CekiRoom };
