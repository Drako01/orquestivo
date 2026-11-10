const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// The connector sends `Authorization: Bearer <token>` through the runtime's global fetch without a redirect
// policy (src/vscode/remote.ts). This test pins the runtime behaviour that makes that safe: a redirect to a
// different origin must not carry the credential. If a future Node version changes it, this test fails first.
const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });

test('fetch drops the Authorization header when a redirect leaves the origin', async () => {
  let seenByTarget;
  const target = await listen((request, response) => {
    seenByTarget = request.headers.authorization ?? null;
    response.end('{}');
  });
  const origin = await listen((request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/landing` });
    response.end();
  });
  try {
    const response = await fetch(`http://127.0.0.1:${origin.address().port}/start`, { headers: { Authorization: 'Bearer ghp_secret' } });
    assert.equal(response.status, 200);
    assert.equal(seenByTarget, null, 'the credential leaked to a different origin');
  } finally {
    await close(origin);
    await close(target);
  }
});
