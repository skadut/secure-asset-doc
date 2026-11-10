// Self-check: round trip + timeout against a local HTTP server. No frameworks.
import assert from 'node:assert/strict';
import http from 'node:http';
import { client } from './crypto-client.mjs';

const server = http.createServer((req, res) => {
  if (req.url === '/echo') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ got: JSON.parse(body) }));
    });
  }
  // /slow: never respond
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

const r = await client(url)('/echo', { a: 1 }, 2000);
assert.equal(r.status, 200);
assert.deepEqual(r.json, { got: { a: 1 } });

const t0 = Date.now();
await assert.rejects(client(url)('/slow', {}, 100));
assert.ok(Date.now() - t0 < 1000);

server.closeAllConnections();
server.close();
console.log('crypto-client ok');
