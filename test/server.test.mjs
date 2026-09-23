import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { capture, createServer } from '../server.mjs';

test('capture reads official paths with Basic auth and isolates forbidden endpoints', async () => {
  const seen = [];
  const iris = http.createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization });
    if (req.url.includes('/security/roles')) { res.writeHead(403); res.end('Forbidden'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result: req.url.includes('/tasks?') ? [{ Id: 1, Name: 'Backup', Suspended: false }] : [] }));
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => iris.once('listening', resolve));
  try {
    const result = await capture({ target: `http://127.0.0.1:${iris.address().port}`, user: '_SYSTEM', password: 'test-pass' });
    assert.equal(result.insights.taskCount, 1);
    assert.match(result.errors.roles, /403/);
    assert.equal(seen.length, 7);
    assert.ok(seen.every(item => item.auth === 'Basic X1NZU1RFTTp0ZXN0LXBhc3M='));
    assert.ok(seen.every(item => item.path.startsWith('/api/admin/v2/')));
  } finally { iris.close(); }
});

test('capture fails clearly when every IRIS endpoint rejects credentials', async () => {
  const iris = http.createServer((_req, res) => { res.writeHead(401); res.end('Unauthorized'); }).listen(0, '127.0.0.1');
  await new Promise(resolve => iris.once('listening', resolve));
  try {
    await assert.rejects(
      capture({ target: `http://127.0.0.1:${iris.address().port}`, user: '_SYSTEM', password: 'wrong-pass' }),
      /No IRIS endpoint responded/
    );
  } finally { iris.close(); }
});

test('public server serves UI and rejects unknown URLs', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /IRIS Driftline/);
    assert.equal((await fetch(`${base}/arbitrary`)).status, 404);
  } finally { server.close(); }
});
