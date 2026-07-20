/*
 * ui.js — Menyambungkan mesin Ceki ke DOM: render meja, interaksi pemain,
 * dan animasi giliran bot.
 */
(function () {
  'use strict';

  var SUIT_SYMBOL = Deck.SUIT_SYMBOL;
  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var game = null;
  var selected = {};   // id kartu terpilih di tangan
  var busy = false;    // true saat bot bermain / animasi
  var drewThisTurn = false;
  var online = null;   // saat mode online: { send(type, payload) }. null = mode lokal.

  // ---------- Pembuatan elemen kartu ----------
  function cardEl(card, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'card' + (opts.mini ? ' card-mini' : '');
    if (opts.faceDown) {
      el.className += ' card-back';
      el.innerHTML = '<span>CEKI</span>';
      return el;
    }
    if (card.joker) {
      el.className += ' joker';
      el.innerHTML =
        '<div class="corner">★</div>' +
        '<div class="pip">JOKER</div>' +
        '<div class="corner br">★</div>';
      el.dataset.id = card.id;
      return el;
    }
    el.className += ' ' + card.color;
    var sym = SUIT_SYMBOL[card.suit];
    var label = card.rank + sym;
    el.innerHTML =
      '<div class="corner">' + label + '</div>' +
      '<div class="pip">' + sym + '</div>' +
      '<div class="corner br">' + label + '</div>';
    el.dataset.id = card.id;
    return el;
  }

  function meldChip(meld) {
    var chip = document.createElement('div');
    chip.className = 'meld-chip';
    meld.cards.forEach(function (c) { chip.appendChild(cardEl(c, { mini: true })); });
    var pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = '+' + meld.points;
    chip.appendChild(pts);
    return chip;
  }

  // ---------- Render penuh ----------
  function render() {
    if (!game) return;
    renderScoreboard();
    renderOpponents();
    renderCenter();
    renderHand();
    renderControls();
    renderLog();
  }

  function renderScoreboard() {
    var el = $('scoreboard');
    el.innerHTML = '';
    game.players.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'score-card' + (i === 0 ? ' you' : '') +
        (game.current === i && !game.sessionOver ? ' active' : '');
      var initial = p.name.charAt(0).toUpperCase();
      card.innerHTML =
        '<div class="who"><div class="avatar">' + initial + '</div>' +
        '<div><div class="pname">' + p.name + '</div></div></div>' +
        '<div class="pscore">' + p.score + '</div>';
      el.appendChild(card);
    });
  }

  function renderOpponents() {
    var el = $('opponents');
    el.innerHTML = '';
    for (var i = 1; i < game.players.length; i++) {
      var p = game.players[i];
      var box = document.createElement('div');
      box.className = 'opp' + (game.current === i && !game.sessionOver ? ' active' : '');
      var head = document.createElement('div');
      head.className = 'opp-head';
      head.innerHTML = '<span class="opp-name">' + p.name + '</span>' +
        '<span class="opp-count">' + p.hand.length + ' kartu</span>';
      box.appendChild(head);
      var hand = document.createElement('div');
      hand.className = 'opp-hand';
      for (var k = 0; k < p.hand.length; k++) hand.appendChild(cardEl(null, { mini: true, faceDown: true }));
      box.appendChild(hand);
      var melds = document.createElement('div');
      melds.className = 'opp-melds';
      p.melds.forEach(function (m) { melds.appendChild(meldChip(m)); });
      box.appendChild(melds);
      el.appendChild(box);
    }
  }

  function renderCenter() {
    $('deck-count').textContent = game.deck.length;
    var deckPile = $('deck-pile');
    var discPile = $('discard-pile');
    var isHumanDraw = game.current === 0 && game.phase === 'draw' && !busy && !game.sessionOver;

    deckPile.classList.toggle('selectable', isHumanDraw);
    deckPile.classList.toggle('disabled', !isHumanDraw);

    // Kipas buangan: tampilkan hingga 7 kartu teratas. Kartu yang memenuhi
    // syarat pengambilan dapat diklik (mengambil kartu itu + semua di atasnya).
    var discFan = $('discard-top');
    discFan.innerHTML = '';
    var len = game.discard.length;
    if (len === 0) {
      discFan.innerHTML = '<div class="card card-back" style="opacity:.25"></div>';
      discPile.classList.remove('selectable');
      discPile.classList.add('disabled');
    } else {
      var maxShow = Math.min(game.maxDiscardTake, len);
      var start = len - maxShow;
      var anyTakeable = false;
      for (var w = start; w < len; w++) {
        var depth = len - w; // 1 = teratas
        var card = game.discard[w];
        var el = cardEl(card);
        if (w !== start) el.style.marginLeft = '-22px';
        var takeable = isHumanDraw && game.canTakeDiscard(depth);
        if (takeable) {
          anyTakeable = true;
          el.classList.add('takeable');
          el.title = 'Ambil ' + depth + ' kartu';
          (function (dp) {
            el.addEventListener('click', function (e) { e.stopPropagation(); onTakeDiscardDepth(dp); });
          })(depth);
        } else if (isHumanDraw) {
          el.classList.add('dim');
          el.title = 'Belum bisa diambil (butuh 2 kartu pembentuk meld)';
        }
        discFan.appendChild(el);
      }
      discPile.classList.toggle('selectable', anyTakeable);
      discPile.classList.toggle('disabled', isHumanDraw && !anyTakeable);
    }

    var banner = $('turn-banner');
    if (game.sessionOver) {
      banner.textContent = 'Sesi selesai.';
      banner.className = 'turn-banner';
    } else if (game.current === 0) {
      banner.textContent = game.phase === 'draw'
        ? 'Giliranmu — ambil kartu dari deck atau buangan.'
        : 'Turunkan meld (opsional), lalu buang satu kartu.';
      banner.className = 'turn-banner action';
    } else {
      banner.textContent = game.players[game.current].name + ' sedang berpikir…';
      banner.className = 'turn-banner';
    }
  }

  function renderHand() {
    var me = game.players[0];
    $('me-name').textContent = me.name + ' — ' + me.hand.length + ' kartu';
    var inline = $('me-melds-inline');
    inline.innerHTML = '';
    me.melds.forEach(function (m) { inline.appendChild(meldChip(m)); });

    var hand = $('hand');
    hand.innerHTML = '';
    var interactive = game.current === 0 && game.phase === 'act' && !busy && !game.sessionOver;
    me.hand.forEach(function (card) {
      var el = cardEl(card);
      if (selected[card.id]) el.classList.add('selected');
      if (game.mustMeldCard === card) el.classList.add('must');
      if (!interactive) el.classList.add('disabled');
      else el.addEventListener('click', function () { toggleSelect(card); });
      hand.appendChild(el);
    });
  }

  function renderControls() {
    var human = game.current === 0 && !busy && !game.sessionOver;
    var drawPhase = human && game.phase === 'draw';
    var actPhase = human && game.phase === 'act';
    var sel = selectedCards();

    $('btn-draw-deck').disabled = !drawPhase;
    $('btn-take-discard').disabled = !drawPhase || !game.canTakeDiscard(1);
    $('btn-lay').disabled = !actPhase || sel.length < 3;
    $('btn-discard').disabled = !actPhase || sel.length !== 1 || sel[0].joker || !!game.mustMeldCard;

    var hint = $('hint');
    hint.className = 'hint';
    if (actPhase && game.mustMeldCard) {
      hint.textContent = 'Kartu ' + Deck.cardLabel(game.mustMeldCard) +
        ' dari buangan wajib kamu turunkan sebagai meld dulu.';
      hint.className = 'hint warn';
    } else if (actPhase) {
      if (sel.length === 0) hint.textContent = 'Pilih 3+ kartu untuk meld, atau 1 kartu untuk dibuang.';
      else if (sel.length === 1) hint.textContent = sel[0].joker ? 'Joker tak boleh dibuang.' : 'Tekan "Buang Kartu".';
      else {
        var type = Melds.meldType(sel);
        if (type) hint.textContent = 'Meld valid (' + (type === 'set' ? 'set' : 'seri') + ', +' + Melds.meldPoints(sel) + ').';
        else { hint.textContent = 'Pilihan bukan set/seri valid.'; hint.className = 'hint warn'; }
      }
    } else if (drawPhase) {
      hint.textContent = game.discard.length
        ? 'Klik kartu buangan untuk ambil kartu itu + semua di atasnya (butuh 2 kartu pembentuk meld).'
        : 'Ambil kartu dari deck.';
    } else {
      hint.textContent = '';
    }
  }

  function renderLog() {
    var ul = $('log');
    ul.innerHTML = '';
    var items = game.log.slice(-60);
    items.forEach(function (line) {
      var li = document.createElement('li');
      if (/★|🏆|TUTUP|Bonus|menang|Sesi/.test(line)) li.className = 'hi';
      li.textContent = line;
      ul.appendChild(li);
    });
    ul.scrollTop = ul.scrollHeight;
  }

  // ---------- Interaksi pemain ----------
  function selectedCards() {
    return game.players[0].hand.filter(function (c) { return selected[c.id]; });
  }
  function toggleSelect(card) {
    if (selected[card.id]) delete selected[card.id]; else selected[card.id] = true;
    render();
  }
  function clearSelection() { selected = {}; }

  function onDrawDeck() {
    if (busy || !game || game.current !== 0 || game.phase !== 'draw') return;
    if (online) { online.send('drawDeck'); return; }
    game.drawFromDeck();
    drewThisTurn = true;
    clearSelection();
    render();
  }
  function onTakeDiscard() {
    onTakeDiscardDepth(1); // tombol = ambil kartu teratas
  }
  function onTakeDiscardDepth(depth) {
    if (busy || !game || game.current !== 0 || game.phase !== 'draw') return;
    if (online) { online.send('takeDiscard', { depth: depth }); return; }
    var r = game.takeDiscard(depth);
    if (r.ok) { drewThisTurn = true; clearSelection(); render(); }
    else flashHint(r.reason);
  }
  function onLay() {
    if (busy || !game || game.current !== 0 || game.phase !== 'act') return;
    var sel = selectedCards();
    if (sel.length < 3) return;
    if (online) { online.send('layMeld', { cardIds: sel.map(function (c) { return c.id; }) }); clearSelection(); return; }
    var r = game.layMeld(sel);
    if (!r.ok) { flashHint(r.reason); return; }
    clearSelection();
    render();
  }
  function onDiscard() {
    if (busy || !game || game.current !== 0 || game.phase !== 'act') return;
    var sel = selectedCards();
    if (sel.length !== 1) return;
    if (online) { online.send('discard', { cardId: sel[0].id }); clearSelection(); return; }
    var r = game.discardCard(sel[0]);
    if (!r.ok) { flashHint(r.reason); return; }
    clearSelection();
    render();
    if (game.sessionOver) { showResult(); return; }
    runBots();
  }
  function flashHint(msg) {
    var hint = $('hint');
    hint.textContent = msg;
    hint.className = 'hint warn';
  }

  // ---------- Giliran bot ----------
  async function runBots() {
    busy = true;
    render();
    while (!game.sessionOver && game.current !== 0) {
      await botTurn(game.current);
    }
    busy = false;
    clearSelection();
    drewThisTurn = false;
    render();
    if (game.sessionOver) showResult();
  }

  // Kecepatan animasi bot (ms). Dapat dipercepat lewat tombol "Cepat".
  var SPEED_NORMAL = { draw: 300, act: 260, lay: 240, discard: 150 };
  var SPEED_FAST = { draw: 70, act: 60, lay: 60, discard: 40 };
  var SPEED = SPEED_NORMAL;
  var fastMode = false;

  async function botTurn(idx) {
    await sleep(SPEED.draw);
    // 1) Ambil
    var choice = AI.decideDraw(game);
    if (choice.source === 'discard') game.takeDiscard(choice.depth); else game.drawFromDeck();
    render();
    if (game.sessionOver) return;
    await sleep(SPEED.act);

    // 2) Turunkan meld
    var plan = AI.decideMelds(game);
    for (var i = 0; i < plan.length; i++) {
      var res = game.layMeld(plan[i]);
      if (res.ok) { render(); await sleep(SPEED.lay); }
    }
    if (game.sessionOver) return;

    // 3) Buang
    var card = AI.decideDiscard(game);
    if (card) game.discardCard(card);
    render();
    await sleep(SPEED.discard);
  }

  // ---------- Hasil sesi / game over ----------
  function showResult() {
    var res = game.lastResult;
    var rows = res.rows.slice().sort(function (a, b) { return b.total - a.total; });
    var title = game.gameOver ? '🏆 Permainan Selesai' : 'Hasil Sesi ' + game.sessionNo;

    var html = '<table class="result-table"><thead><tr>' +
      '<th>Pemain</th><th>Meld</th><th>Sisa</th><th>Bonus</th><th>Sesi</th><th>Total</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var isWinner = game.gameOver && game.winner && r.id === game.winner.id;
      var isCloser = res.closer === r.id;
      var deadStr = (r.deadwood + r.jokerPenalty) > 0 ? '−' + (r.deadwood + r.jokerPenalty) : '0';
      var deltaCls = r.delta >= 0 ? 'pos' : 'neg';
      var deltaStr = (r.delta >= 0 ? '+' : '−') + Math.abs(r.delta);
      html += '<tr class="' + (isWinner ? 'winner ' : '') + (isCloser ? 'closer' : '') + '">' +
        '<td>' + r.name + '</td>' +
        '<td class="pos">+' + r.meldPts + '</td>' +
        '<td class="neg">' + deadStr + '</td>' +
        '<td class="pos">' + (r.closeBonus ? '+' + r.closeBonus : '—') + '</td>' +
        '<td class="' + deltaCls + '">' + deltaStr + '</td>' +
        '<td>' + r.total + '</td></tr>';
    });
    html += '</tbody></table>';

    if (game.gameOver) {
      html = '<p style="font-size:16px;margin-top:0">Pemenang: <strong style="color:var(--accent)">' +
        game.winner.name + '</strong> dengan ' + game.winner.score + ' poin.</p>' + html;
    } else {
      html += '<p style="color:var(--ink-dim);font-size:13px">Target menang: ' +
        game.targetScore + ' poin. Pemain skor tertinggi jalan pertama sesi berikutnya.</p>';
    }

    $('modal-title').textContent = title;
    $('modal-body').innerHTML = html;
    $('modal-btn').textContent = game.gameOver ? 'Main Lagi' : 'Sesi Berikutnya';
    $('modal').classList.remove('hidden');
  }

  function onModalBtn() {
    $('modal').classList.add('hidden');
    if (online) {
      // Sesi berikutnya di-advance otomatis oleh server; "Main Lagi" -> playAgain.
      if (game && game.gameOver) online.send('playAgain');
      return;
    }
    if (game.gameOver) { showModeSelect(); return; }
    var starter = game.nextSessionStarter();
    game.startSession(starter);
    clearSelection();
    render();
    if (game.current !== 0) runBots();
  }

  // ---------- Bootstrap ----------
  var chosenTarget = 500;

  function newGame(targetScore) {
    online = null; // mode lokal
    game = new Game(['Kamu', 'Bot Ani', 'Bot Budi', 'Bot Citra'],
      { targetScore: targetScore || chosenTarget });
    game.startSession(0);
    clearSelection();
    busy = false;
    render();
    if (game.current !== 0) runBots();
  }

  function hideAllModals() {
    ['modal', 'setup-modal', 'mode-modal', 'lobby-modal', 'rules-modal'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
  }
  function showSetup() { hideAllModals(); $('setup-modal').classList.remove('hidden'); }
  function showModeSelect() {
    hideAllModals();
    $('mode-modal').classList.remove('hidden');
  }
  function leaveToMenu() {
    if (online && window.Net && window.Net.leave) window.Net.leave();
    online = null; game = null; busy = false; clearSelection();
    showModeSelect();
  }

  function markTargetPreset(value) {
    var btns = document.querySelectorAll('#target-options button');
    btns.forEach(function (b) {
      b.classList.toggle('active', parseInt(b.dataset.target, 10) === value);
    });
  }

  function bindSetup() {
    var opts = document.querySelectorAll('#target-options button');
    opts.forEach(function (b) {
      b.addEventListener('click', function () {
        chosenTarget = parseInt(b.dataset.target, 10);
        $('custom-target').value = '';
        markTargetPreset(chosenTarget);
      });
    });
    $('custom-target').addEventListener('input', function () {
      var v = parseInt(this.value, 10);
      if (!isNaN(v) && v > 0) { chosenTarget = v; markTargetPreset(-1); }
    });
    $('setup-start').addEventListener('click', function () {
      var custom = parseInt($('custom-target').value, 10);
      var target = (!isNaN(custom) && custom >= 50) ? custom : chosenTarget;
      if (!target || target < 50) target = 500;
      chosenTarget = target;
      $('setup-modal').classList.add('hidden');
      newGame(target);
    });
    markTargetPreset(chosenTarget); // sorot default 500
  }

  function bindEvents() {
    $('btn-draw-deck').addEventListener('click', onDrawDeck);
    $('btn-take-discard').addEventListener('click', onTakeDiscard);
    $('btn-lay').addEventListener('click', onLay);
    $('btn-discard').addEventListener('click', onDiscard);
    $('modal-btn').addEventListener('click', onModalBtn);
    $('btn-restart').addEventListener('click', function () {
      $('modal').classList.add('hidden'); leaveToMenu();
    });
    $('deck-pile').addEventListener('click', onDrawDeck);
    $('discard-pile').addEventListener('click', onTakeDiscard);
    $('btn-speed').addEventListener('click', function () {
      fastMode = !fastMode;
      SPEED = fastMode ? SPEED_FAST : SPEED_NORMAL;
      $('btn-speed').textContent = '⏩ Cepat: ' + (fastMode ? 'On' : 'Off');
    });
    $('btn-rules').addEventListener('click', function () { $('rules-modal').classList.remove('hidden'); });
    $('rules-close').addEventListener('click', function () { $('rules-modal').classList.add('hidden'); });
  }

  function bindMode() {
    var local = $('mode-local'), onlineBtn = $('mode-online');
    if (local) local.addEventListener('click', showSetup);
    if (onlineBtn) onlineBtn.addEventListener('click', function () {
      if (window.Net && window.Net.showLobby) { hideAllModals(); window.Net.showLobby(); }
      else flashHint('Modul online tak termuat.');
    });
  }

  // Antarmuka yang dipakai net.js (mode online).
  window.CekiUI = {
    render: render,
    showResult: showResult,
    flashHint: flashHint,
    clearSelection: clearSelection,
    hideAllModals: hideAllModals,
    showModeSelect: showModeSelect,
    setGame: function (g) { game = g; },
    getGame: function () { return game; },
    setBusy: function (b) { busy = !!b; },
    setOnline: function (o) { online = o; },     // { send(type, payload) } atau null
    cardEl: cardEl,
    $: $
  };

  window.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    bindSetup();
    bindMode();
    showModeSelect(); // layar awal: pilih Lokal / Online
  });
})();
