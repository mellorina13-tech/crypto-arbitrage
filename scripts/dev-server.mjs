// Local dev server: serves the static site AND the arbitrage function at
// /.netlify/functions/arbitrage — no `netlify dev` or npm install required.
// Usage: node scripts/dev-server.mjs  →  http://localhost:8888

import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/arbitrage.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 8888;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/.netlify/functions/')) {
    const name = url.pathname.split('/').pop();
    const fn = name === 'get-prices' ? null : handler; // old endpoint removed
    if (!fn) {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'get-prices removed; use /.netlify/functions/arbitrage' }));
      return;
    }
    try {
      const result = await handler(
        { httpMethod: req.method, queryStringParameters: Object.fromEntries(url.searchParams) },
        {}
      );
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
    return;
  }

  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const data = await readFile(path.join(ROOT, filePath));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
});
