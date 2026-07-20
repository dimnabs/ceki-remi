/*
 * net.js — Mode ONLINE: koneksi Colyseus + lobby + adapter render.
 *
 * State otoritatif ada di server. net.js mengubah state publik + tangan pribadi
 * menjadi objek "adapter" berbentuk seperti Game lokal (pemain SAYA dirotasi ke
 * indeks 0), lalu memakai renderer yang sama (window.CekiUI).
 */
(function () {
  'use strict';

  // URL server bisa di-override lewat ?server= (praktis untuk self-host / tunnel
  // yang URL-nya berubah), lalu window.CEKI_SERVER, lalu default lokal.
  var _params = new URLSearchParams(location.search);
  var SERVER = _params.get('server') || window.CEKI_SERVER ||
    ('ws://' + (location.hostname || 'localhost') + ':2567');
  var PREFILL_CODE = (_params.get('room') || '').toUpperCase();
  var $ = function (id) { return document.getElementById(id); };

  var client = null, room = null;
  var mySeat = -1;
  var myCode = '';       // kode room (dari pesan welcome)
  var myHand = [];       // kartu (view) tangan saya
  var lastAdapter = null;
  var wired = false;

  // ---------- Util kartu ----------
  function cardObj(cv) {
    if (cv.joker) return { id: String(cv.id), rank: null, suit: null, joker: true, color: cv.color || 'red', value: 0, runPos: null };
    return {
      id: String(cv.id), rank: cv.rank, suit: cv.suit, joker: false,
      color: cv.color || Deck.SUIT_COLOR[cv.suit],
      value: Deck.rankValue(cv.rank), runPos: Deck.runPos(cv.rank)
    };
  }
  function mapCards(arr) { var out = []; for (var i = 0; i < arr.length; i++) out.push(cardObj(arr[i])); return out; }
  function meldsOf(sv) {
    var out = [];
    for (var i = 0; i < sv.melds.length; i++) {
      var mv = sv.melds[i];
      out.push({ type: mv.type, points: mv.points, cards: mapCards(mv.cards) });
    }
    return out;
  }

  // ---------- Adapter: state server -> objek mirip Game ----------
  function buildAdapter(st) {
    var n = st.seats.length;
    var players = [];
    for (var r = 0; r < n; r++) {
      var seatIdx = (mySeat + r) % n;
      var sv = st.seats[seatIdx];
      var label = sv.nickname + (sv.isBot ? ' 🤖' : (!sv.connected ? ' (offline)' : ''));
      players.push({
        name: label,
        score: sv.score,
        hand: (r === 0) ? mapCards(myHand) : new Array(sv.handCount).fill(0),
        melds: meldsOf(sv)
      });
    }
    var playing = (st.phase === 'draw' || st.phase === 'act');
    var over = (st.phase === 'sessionOver' || st.phase === 'gameOver');
    var adapter = {
      players: players,
      current: over ? -1 : ((st.current < 0) ? -1 : ((st.current - mySeat + n) % n)),
      phase: playing ? st.phase : 'over',
      sessionOver: over,
      gameOver: (st.phase === 'gameOver'),
      deck: { length: st.deckCount },
      discard: mapCards(st.discardTop),
      maxDiscardTake: 7,
      targetScore: st.targetScore,
      sessionNo: st.sessionNo,
      log: (function () { var a = []; for (var i = 0; i < st.log.length; i++) a.push(st.log[i]); return a; })(),
      mustMeldCard: null,
      topDiscard: function () { return this.discard.length ? this.discard[this.discard.length - 1] : null; },
      canTakeDiscard: function (depth) { return clientCanTake(this, depth); }
    };
    if (st.mustMeldCardId) {
      adapter.mustMeldCard = players[0].hand.filter(function (c) { return String(c.id) === String(st.mustMeldCardId); })[0] || null;
    }
    return adapter;
  }

  // Replika aturan server untuk highlight (server tetap otoritatif saat aksi).
  function clientCanTake(a, depth) {
    var shown = a.discard;
    if (depth < 1 || depth > 7 || depth > shown.length) return false;
    var hand = a.players[0].hand;
    if (hand.length + depth < 4) return false;
    var wanted = shown[shown.length - depth];
    var melds = a.players[0].melds;
    var hasRun = melds.some(function (m) { return m.type === 'run'; });
    var first = melds.length === 0;
    for (var i = 0; i < hand.length; i++) {
      for (var j = i + 1; j < hand.length; j++) {
        var g = [wanted, hand[i], hand[j]];
        if (!Melds.isValidMeld(g)) continue;
        var t = Melds.meldType(g);
        var hasJoker = g.some(function (c) { return c.joker; });
        if (first && hasJoker) continue;
        if (t === 'set' && !hasRun) continue;
        return true;
      }
    }
    return false;
  }

  // ---------- Render ----------
  function rerender() {
    if (!room) return;
    var st = room.state;
    if (st.phase === 'lobby') { renderLobbyRoom(st); return; }
    if (mySeat < 0) return; // tunggu 'welcome'
    CekiUI.hideAllModals();
    var a = buildAdapter(st);
    lastAdapter = a;
    CekiUI.setGame(a);
    CekiUI.setOnline({ send: function (t, p) { if (room) room.send(t, p); } });
    CekiUI.setBusy(false);
    CekiUI.render();
    if (st.phase === 'draw' || st.phase === 'act') $('modal').classList.add('hidden');
  }

  function showOnlineResult(evt) {
    var st = room.state;
    var a = lastAdapter || buildAdapter(st);
    a.lastResult = evt.result;
    a.gameOver = evt.gameOver;
    a.sessionNo = st.sessionNo;
    a.targetScore = st.targetScore;
    if (evt.gameOver) {
      var rows = evt.result.rows.slice().sort(function (x, y) { return y.total - x.total; });
      var w = null;
      for (var i = 0; i < evt.result.rows.length; i++) if (evt.result.rows[i].name === st.winnerNickname) w = evt.result.rows[i];
      if (!w) w = rows[0];
      a.winner = { id: w.id, name: w.name, score: w.total };
    } else a.winner = null;
    CekiUI.setGame(a);
    CekiUI.showResult();
  }

  // ---------- Lobby ----------
  function genCode() {
    var alph = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa I O 0 1
    var s = '';
    for (var i = 0; i < 4; i++) s += alph[Math.floor(Math.random() * alph.length)];
    return s;
  }
  function setStatus(id, msg, warn) {
    var el = $(id); if (!el) return;
    el.textContent = msg || '';
    el.className = 'lobby-status' + (warn ? ' warn' : '');
  }
  function showEntry() { $('lobby-entry').classList.remove('hidden'); $('lobby-room').classList.add('hidden'); }
  function showRoomView() { $('lobby-entry').classList.add('hidden'); $('lobby-room').classList.remove('hidden'); }

  function connect() {
    if (!client) client = new Colyseus.Client(SERVER);
    return client;
  }
  function nickname() { return ($('lobby-nick').value || '').trim().slice(0, 16) || 'Pemain'; }

  async function createRoom() {
    setStatus('lobby-status', 'Menghubungkan…');
    try {
      var c = connect();
      var target = parseInt($('lobby-target') ? $('lobby-target').value : '500', 10) || 500;
      room = await c.create('ceki', { code: genCode(), nickname: nickname(), targetScore: target });
      bindRoom();
    } catch (e) { setStatus('lobby-status', 'Gagal membuat room: ' + (e.message || e), true); }
  }
  async function joinRoom() {
    var code = ($('lobby-code').value || '').trim().toUpperCase();
    if (code.length < 3) { setStatus('lobby-status', 'Masukkan kode room.', true); return; }
    setStatus('lobby-status', 'Menghubungkan…');
    try {
      var c = connect();
      room = await c.join('ceki', { code: code, nickname: nickname() });
      bindRoom();
    } catch (e) { setStatus('lobby-status', 'Gagal gabung (kode salah / room penuh?).', true); }
  }

  function bindRoom() {
    mySeat = -1; myHand = [];
    room.onMessage('welcome', function (m) { mySeat = m.seat; myCode = m.code || myCode; renderCurrent(); });
    room.onMessage('hand', function (m) { myHand = m.cards; rerender(); });
    room.onMessage('error', function (m) { CekiUI.flashHint(m.reason); });
    room.onMessage('event', function (m) { if (m.type === 'sessionResult') showOnlineResult(m); });
    room.onStateChange(function () { rerender(); });
    room.onLeave(function () { /* koneksi berakhir */ });
    showRoomView();
    renderCurrent();
  }
  function renderCurrent() { if (room) rerender(); }

  function isHost(st) { return mySeat >= 0 && st.hostSeat === mySeat; }

  function renderLobbyRoom(st) {
    $('lobby-room-code').textContent = myCode;
    // daftar kursi
    var wrap = $('lobby-seats'); wrap.innerHTML = '';
    for (var i = 0; i < st.seats.length; i++) {
      var s = st.seats[i];
      var row = document.createElement('div');
      row.className = 'lobby-seat' + (i === st.hostSeat ? ' host' : '');
      row.innerHTML = '<span class="ls-name">' + escapeHtml(s.nickname) +
        (i === mySeat ? ' <em>(kamu)</em>' : '') + '</span>' +
        '<span class="ls-tag">' + (s.isBot ? '🤖 bot' : (s.connected ? (i === st.hostSeat ? '👑 host' : 'online') : 'offline')) + '</span>';
      wrap.appendChild(row);
    }
    // kontrol host
    var host = isHost(st);
    $('lobby-host-controls').style.display = host ? '' : 'none';
    $('lobby-addbot').disabled = st.seats.length >= 4;
    $('lobby-start').disabled = st.seats.length < 2;
    if ($('lobby-target')) $('lobby-target').value = String(st.targetScore);
    setStatus('lobby-room-status', host
      ? (st.seats.length < 2 ? 'Butuh minimal 2 pemain (tambah bot atau ajak teman).' : 'Siap! Tekan Mulai.')
      : 'Menunggu host memulai…');
  }

  function escapeHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function wireLobby() {
    if (wired) return; wired = true;
    $('lobby-create').addEventListener('click', createRoom);
    $('lobby-join-btn').addEventListener('click', joinRoom);
    $('lobby-code').addEventListener('input', function () { this.value = this.value.toUpperCase(); });
    $('lobby-back').addEventListener('click', function () { Net.leave(); CekiUI.showModeSelect(); });
    $('lobby-copy').addEventListener('click', function () {
      var code = $('lobby-room-code').textContent;
      if (navigator.clipboard && code) navigator.clipboard.writeText(code);
      setStatus('lobby-room-status', 'Kode disalin: ' + code);
    });
    $('lobby-addbot').addEventListener('click', function () { if (room) room.send('addBot'); });
    $('lobby-start').addEventListener('click', function () { if (room) room.send('startGame'); });
    $('lobby-leave').addEventListener('click', function () { Net.leave(); showEntry(); });
    if ($('lobby-target')) $('lobby-target').addEventListener('change', function () {
      if (room) room.send('setTarget', { target: parseInt(this.value, 10) || 500 });
    });
  }

  window.Net = {
    showLobby: function () {
      wireLobby();
      showEntry();
      setStatus('lobby-status', '');
      if (PREFILL_CODE && $('lobby-code')) $('lobby-code').value = PREFILL_CODE;
      $('lobby-modal').classList.remove('hidden');
    },
    leave: function () {
      try { if (room) room.leave(); } catch (e) {}
      room = null; mySeat = -1; myCode = ''; myHand = []; lastAdapter = null;
      CekiUI.setOnline(null);
    }
  };
})();
