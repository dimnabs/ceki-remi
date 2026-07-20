/*
 * index.js — Boot server Colyseus untuk Ceki.
 * Room "ceki" diarahkan berdasarkan kode room (filterBy) agar pemain bisa
 * bergabung memakai kode pendek yang mudah dibagikan.
 */
const http = require('http');
const { Server } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { CekiRoom } = require('./CekiRoom');

const PORT = Number(process.env.PORT) || 2567;

// HTTP server untuk health check (Render) + upgrade WebSocket.
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Ceki server OK');
    return;
  }
  res.writeHead(404); res.end('Not found');
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

// Kode room dibedakan lewat opsi { code }; join memakai kode yang sama.
gameServer.define('ceki', CekiRoom).filterBy(['code']);

gameServer.listen(PORT, undefined, undefined, () => {
  console.log('Ceki Colyseus server listening on :' + PORT);
});
