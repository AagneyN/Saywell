// Local web server for the browser/PWA version. Binds to 127.0.0.1 only and sends strict
// security headers. Microphone access works because localhost is a secure context.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = resolve(fileURLToPath(new URL('.', import.meta.url)), 'www');
const PORT = Number(process.env.PORT || 5178);
const HOST = '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.txt': 'text/plain' };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' https: blob: data:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), clipboard-write=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(WWW, '.' + p);
    if (file !== WWW && !file.startsWith(WWW + sep)) { res.writeHead(403); return res.end(); }
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) { res.writeHead(404, HEADERS); return res.end('Not found'); }
    res.writeHead(200, { ...HEADERS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
}).listen(PORT, HOST, () => console.log(`Saywell web app: http://localhost:${PORT}`));
