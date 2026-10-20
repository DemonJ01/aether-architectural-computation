import http from 'node:http';
import { constants, createReadStream } from 'node:fs';
import { realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { handleApi, allowedApiMethods, MAX_BODY_BYTES } from './api.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
// Authorizes only the exact inline import map shared by the public HTML pages:
// {"imports":{"three":"/vendor/three.module.min.js"}}
export const STATIC_CSP = "default-src 'self'; script-src 'self' 'sha256-eRHC8u2lqY54b7M+uHZC1fVgoIXfuAdb+RDlb54o14w='; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': STATIC_CSP,
};

// Inspect the unnormalised request target: URL() alone erases dot segments.
export function resolvePublicPath(target, publicDir = PUBLIC_DIR) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return null;
  let pathname;
  try { pathname = decodeURIComponent(target.split('?', 1)[0]); } catch { return null; }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes('#')) return null;
  const segments = pathname.split('/');
  if (segments.some(segment => segment.startsWith('.'))) return null;
  const root = path.resolve(publicDir);
  const result = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  return result.startsWith(`${root}${path.sep}`) ? result : null;
}

function sendError(response, status, message, extra = {}) {
  if (response.headersSent || response.destroyed) return;
  const body = JSON.stringify({ error: { message } });
  response.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), ...extra });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Request body exceeds the byte limit.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => { if (!failed) resolve(Buffer.concat(chunks, size)); });
    request.on('error', reject);
    request.on('aborted', () => reject(Object.assign(new Error('Request interrupted.'), { status: 400 })));
  });
}

async function serveStatic(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    request.resume();
    sendError(response, 405, 'Method not allowed.', { allow: 'GET, HEAD' });
    return;
  }
  const file = resolvePublicPath(request.url);
  if (!file) { sendError(response, 404, 'File not found.'); return; }
  let handle;
  try {
    const [root, resolved] = await Promise.all([realpath(PUBLIC_DIR), realpath(file)]);
    if (!resolved.startsWith(`${root}${path.sep}`)) { sendError(response, 404, 'File not found.'); return; }
    handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) { await handle.close(); handle = null; sendError(response, 404, 'File not found.'); return; }
    response.writeHead(200, {
      ...HEADERS,
      'content-type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
    });
    if (request.method === 'HEAD') { await handle.close(); handle = null; response.end(); return; }
    const stream = createReadStream(resolved, { fd: handle.fd, autoClose: false });
    await pipeline(stream, response);
    await handle.close();
    handle = null;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (response.headersSent) response.destroy();
    else sendError(response, ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES'].includes(error.code) ? 404 : 500, 'File not found.');
  }
}

export function createServer() {
  const server = http.createServer({ maxHeaderSize: 16_384 }, async (request, response) => {
    try {
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) { sendError(response, 400, 'Invalid request target.'); return; }
      if (!resolvePublicPath(request.url)) { sendError(response, 404, 'File not found.'); return; }
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) { await serveStatic(request, response); return; }
      const allowed = allowedApiMethods(url.pathname);
      if (!allowed) { request.resume(); sendError(response, 404, 'API endpoint not found.'); return; }
      if (!allowed.includes(request.method)) {
        request.resume();
        sendError(response, 405, 'Method not allowed.', { allow: allowed.join(', ') });
        return;
      }
      const declared = request.headers['content-length'];
      if (declared && Number(declared) > MAX_BODY_BYTES) {
        request.resume();
        sendError(response, 413, 'Request body exceeds the byte limit.');
        return;
      }
      const headers = new Headers();
      for (const key of ['content-type', 'content-length']) {
        const value = request.headers[key];
        if (typeof value === 'string') headers.set(key, value);
      }
      const body = request.method === 'POST' ? await readBody(request) : undefined;
      if (request.method !== 'POST') request.resume();
      const result = await handleApi(new Request(url, { method: request.method, headers, body }));
      response.writeHead(result.status, { ...HEADERS, ...Object.fromEntries(result.headers) });
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      sendError(response, error.status || 500, error.status ? error.message : 'Request could not be completed.');
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function createPortfolioServer({ port = 4184, host = '127.0.0.1' } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be an integer from 0 to 65535.');
  if (typeof host !== 'string' || !host.trim()) throw new TypeError('host must be a non-empty string.');
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = process.env.PORT === undefined ? 4184 : Number(process.env.PORT);
  const host = process.env.HOST || '127.0.0.1';
  createPortfolioServer({ port, host }).then(server => {
    const address = server.address();
    console.log(`Architectural computation: http://${host}:${address.port}`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
