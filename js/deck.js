/*
 * deck.js — Model kartu, deck, dan nilai poin untuk Remi 7 Kartu / Ceki.
 *
 * Aturan nilai (berdasarkan makalah IF2211 ITB):
 *   - Kartu 2..10  = 5 poin
 *   - J, Q, K      = 10 poin
 *   - As (A)       = 15 poin
 *   - Joker        = poin kartu yang diwakilinya
 */
(function (global) {
  'use strict';

  var SUITS = ['S', 'H', 'C', 'D']; // Sekop, Hati, Keriting (Club), Wajik (Diamond)
  var SUIT_SYMBOL = { S: '♠', H: '♥', C: '♣', D: '♦' };
  var SUIT_COLOR = { S: 'black', C: 'black', H: 'red', D: 'red' };

  // Urutan rank. runPos dipakai untuk mendeteksi seri (deret) secara melingkar:
  // A=1, 2..10, J=11, Q=12, K=13. Deret melingkar diperbolehkan (mis. K-A-2).
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function rankValue(rank) {
    if (rank === 'A') return 15;
    if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
    return 5; // 2..10
  }

  function runPos(rank) {
    return RANKS.indexOf(rank) + 1; // 1..13
  }

  var _id = 0;
  function makeCard(rank, suit) {
    return {
      id: ++_id,
      rank: rank,          // 'A'..'K' atau null untuk joker
      suit: suit,          // 'S'/'H'/'C'/'D' atau null untuk joker
      joker: false,
      color: SUIT_COLOR[suit],
      value: rankValue(rank),
      runPos: runPos(rank)
    };
  }

  function makeJoker(kind) {
    return {
      id: ++_id,
      rank: null,
      suit: null,
      joker: true,
      jokerKind: kind,     // 'red' | 'black'
      color: kind === 'red' ? 'red' : 'black',
      value: 0,            // dihitung dinamis saat masuk meld
      runPos: null
    };
  }

  // Satu set penuh: 52 kartu + 2 joker.
  function buildDeck() {
    var cards = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) {
        cards.push(makeCard(RANKS[r], SUITS[s]));
      }
    }
    cards.push(makeJoker('red'));
    cards.push(makeJoker('black'));
    return cards;
  }

  // Fisher–Yates shuffle. rng opsional (untuk deterministik saat testing).
  function shuffle(cards, rng) {
    rng = rng || Math.random;
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = cards[i];
      cards[i] = cards[j];
      cards[j] = tmp;
    }
    return cards;
  }

  function cardLabel(card) {
    if (card.joker) return 'Joker';
    return card.rank + SUIT_SYMBOL[card.suit];
  }

  var api = {
    SUITS: SUITS,
    RANKS: RANKS,
    SUIT_SYMBOL: SUIT_SYMBOL,
    SUIT_COLOR: SUIT_COLOR,
    rankValue: rankValue,
    runPos: runPos,
    makeCard: makeCard,
    makeJoker: makeJoker,
    buildDeck: buildDeck,
    shuffle: shuffle,
    cardLabel: cardLabel
  };

  global.Deck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
