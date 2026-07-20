/*
 * schema.js — State PUBLIK yang disinkronkan Colyseus ke semua client.
 *
 * PENTING (hidden-info): isi/urutan deck dan kartu tangan tiap pemain TIDAK ada
 * di sini. Deck & tangan hidup di memori server (instance Game); tiap client
 * hanya menerima tangannya sendiri lewat pesan bertarget 'hand'.
 */
const { Schema, ArraySchema, defineTypes } = require('@colyseus/schema');

class CardView extends Schema {}
defineTypes(CardView, {
  id: 'string',       // id numerik kartu (sebagai string) untuk referensi aksi
  rank: 'string',     // '' untuk joker
  suit: 'string',     // '' untuk joker
  joker: 'boolean',
  color: 'string'     // 'red' | 'black' (untuk render)
});

class MeldView extends Schema {
  constructor() { super(); this.cards = new ArraySchema(); }
}
defineTypes(MeldView, {
  type: 'string',     // 'run' | 'set'
  points: 'number',
  cards: [CardView]
});

class SeatView extends Schema {
  constructor() { super(); this.melds = new ArraySchema(); }
}
defineTypes(SeatView, {
  nickname: 'string',
  connected: 'boolean',
  isBot: 'boolean',
  ready: 'boolean',
  handCount: 'number',
  score: 'number',
  melds: [MeldView]
});

class GameState extends Schema {
  constructor() {
    super();
    this.seats = new ArraySchema();
    this.discardTop = new ArraySchema();
    this.log = new ArraySchema();
  }
}
defineTypes(GameState, {
  phase: 'string',          // 'lobby' | 'draw' | 'act' | 'sessionOver' | 'gameOver'
  current: 'number',        // seat index yang sedang giliran (-1 di lobby)
  hostSeat: 'number',
  targetScore: 'number',
  sessionNo: 'number',
  deckCount: 'number',
  mustMeldCardId: 'string', // '' bila tak ada
  turnEndsAt: 'number',     // epoch ms untuk countdown; 0 = tak ada timer
  winnerNickname: 'string',
  seats: [SeatView],
  discardTop: [CardView],   // s.d. 7 kartu teratas buangan (untuk kipas)
  log: ['string']
});

module.exports = { CardView, MeldView, SeatView, GameState };
