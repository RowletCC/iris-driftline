import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, diffSnapshots, projectRows, validSnapshot } from './lib/analysis.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8781);
const target = process.env.IRIS_URL || 'http://127.0.0.1:52773';
const user = process.env.IRIS_USER || '_SYSTEM';
const password = process.env.IRIS_PASSWORD || '';

const endpoints = {
  tasks: '/v2/tasks?maxRows=500',
  history: '/v2/task/history?maxRows=500',
  upcoming: '/v2/task/upcoming?hoursOffset=48&maxRows=500',
  manager: '/v2/task/manager',
  resources: '/v2/monitor/dashboard/system-resources',
  webApps: '/v2/web-apps?maxRows=500',
  roles: '/v2/security/roles?maxRows=500'
};

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

export async function irisGet(kind, options = {}) {
  if (!Object.hasOwn(endpoints, kind)) throw new Error('Unknown endpoint');
  const base = options.target ?? target;
  const login = options.user ?? user;
  const secret = options.password ?? password;
  if (!secret) throw new Error('IRIS_PASSWORD is not set');
  const address = new URL('/api/admin' + endpoints[kind], base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(address, {
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${login}:${secret}`).toString('base64')}` },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const body = await response.json();
    if (body.status?.Errors?.length) throw new Error(body.status.Errors.join('; ').slice(0, 250));
    return projectRows(kind, body.result);
  } finally {
    clearTimeout(timer);
  }
}

export async function capture(options = {}) {
  if (process.env.DEMO === '1' && !options.target) return demoCapture();
  const result = await Promise.all(Object.keys(endpoints).map(async kind => {
    try { return [kind, await irisGet(kind, options), null]; }
    catch (error) { return [kind, null, String(error.message || error)]; }
  }));
  const data = {}, errors = {};
  for (const [kind, rows, error] of result) {
    if (error) errors[kind] = error;
    else data[kind] = rows;
  }
  if (!Object.keys(data).length) throw new Error('No IRIS endpoint responded; check the URL, credentials, and API availability');
  return { capturedAt: new Date().toISOString(), source: new URL(options.target ?? target).origin, data, errors, insights: analyze({ data }) };
}

let demoSequence = 0;
function demoCapture() {
  const changed = demoSequence++ % 2 === 1;
  const data = {
    tasks: [
      { Id: 12, Name: 'Daily archive', Namespace: '%SYS', Type: 'System', Suspended: changed, NextScheduled: '2026-09-25 02:00:00' },
      { Id: 27, Name: 'Revenue report refresh', Namespace: 'USER', Type: 'User', Suspended: false, NextScheduled: '2026-09-25 03:30:00' },
      ...(changed ? [{ Id: 34, Name: 'Invoice sync', Namespace: 'USER', Type: 'User', Suspended: false, NextScheduled: '2026-09-25 04:00:00' }] : [])
    ],
    upcoming: [
      { Id: 12, Name: 'Daily archive', Namespace: '%SYS', Datetime: '2026-09-25 02:00:00', Suspended: changed },
      { Id: 27, Name: 'Revenue report refresh', Namespace: 'USER', Datetime: '2026-09-25 03:30:00', Suspended: false }
    ],
    history: [
      { TaskId: 12, Name: 'Daily archive', LastStart: '2026-09-24 02:00:00', Status: 'Success' },
      { TaskId: 27, Name: 'Revenue report refresh', LastStart: '2026-09-24 03:30:00', Status: 'Error', Result: 'Output file unavailable' }
    ],
    manager: [{ Status: 'Running' }],
    resources: [{ Name: 'Global', Seize: 12, Nseize: 6, Aseize: 4, Bseize: 1, BusySet: 0 }],
    webApps: [{ Name: '/csp/user', Namespace: 'USER', Enabled: true }],
    roles: [{ Name: '%Developer', Description: 'Development role' }]
  };
  return { capturedAt: new Date().toISOString(), source: 'Synthetic demo (no IRIS)', data, errors: {}, insights: analyze({ data }) };
}

async function readBody(req) {
  let chunks = '', size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Payload too large');
    chunks += chunk;
  }
  return JSON.parse(chunks);
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/api/snapshot') return send(res, 200, await capture());
      if (req.method === 'POST' && url.pathname === '/api/diff') {
        const body = await readBody(req);
        if (!validSnapshot(body.before) || !validSnapshot(body.after)) return send(res, 400, { error: 'Two valid snapshots are required' });
        return send(res, 200, diffSnapshots(body.before, body.after));
      }
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, mime] = staticFiles.get(url.pathname);
        const content = await fs.readFile(path.join(root, 'public', file));
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
        return res.end(content);
      }
      send(res, 404, { error: 'Not found' });
    } catch (error) {
      send(res, 500, { error: String(error.message || error) });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, host, () => console.log(`IRIS Driftline listening on http://${host}:${port}`));
}
