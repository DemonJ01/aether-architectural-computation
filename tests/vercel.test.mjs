import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import adapter from '../api/index.mjs';
import { handleApi, MAX_BODY_BYTES } from '../api.mjs';

const origin = 'https://aether.example';
const rewritten = (path, options) => new Request(`${origin}/api/index?__aether_endpoint=${encodeURIComponent(path.replace(/^\/api\//, ''))}`, options);
const jsonPost = value => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

test('Vercel fetch adapter preserves status, body and security headers for every endpoint', async () => {
  for (const [path, options] of [
    ['/api/health'], ['/api/study'], ['/api/evaluate', jsonPost({ beamSoffit: 3.05 })],
    ['/api/context'], ['/api/context', jsonPost({ text: `${'first '.repeat(490)}\n\n${'second '.repeat(20)}` })],
    ...['json', 'csv', 'svg'].map(format => ['/api/export', jsonPost({ format, params: { beamSoffit: 3.05 }, routeId: 'under' })]),
    ['/api/study', { method: 'DELETE' }], ['/api/not-found'],
    ['/api/evaluate', jsonPost({ beamSoffit: 'bad' })],
    ['/api/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }],
  ]) {
    const expected = await handleApi(new Request(`${origin}${path}`, options));
    const actual = await adapter.fetch(rewritten(path, options));
    assert.equal(actual.status, expected.status, path);
    assert.deepEqual([...actual.headers], [...expected.headers], path);
    assert.equal(await actual.text(), await expected.text(), path);
  }
});

test('adapter also accepts the original request URL exposed by hosting runtimes', async () => {
  const response = await adapter.fetch(new Request(`${origin}/api/study?__aether_endpoint=health`));
  assert.equal(response.status, 200);
  const study = await response.json();
  assert.equal(study.selectedId, 'derived');
  assert.equal(study.feasibleCount, 3);
});

test('adapter forwards the body stream without bypassing the API byte limit', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  const response = await adapter.fetch(rewritten('/api/evaluate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half',
  }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
});

test('ambiguous, missing and malformed endpoint values fail closed', async () => {
  for (const query of ['', '?__aether_endpoint=health&__aether_endpoint=study', '?__aether_endpoint=%2Fhealth', '?__aether_endpoint=study%2F', '?__aether_endpoint=..%2Fhealth']) {
    const response = await adapter.fetch(new Request(`${origin}/api/index${query}`));
    assert.equal(response.status, 404, query);
  }
});

test('Vercel configuration only publishes public assets and keeps the exact import map CSP', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.installCommand, '');
  assert.equal(config.buildCommand, '');
  assert.deepEqual(config.rewrites, [{ source: '/api/:endpoint*', destination: '/api/index?__aether_endpoint=:endpoint*' }]);
  const staticRule = config.headers[0];
  const pattern = new RegExp(`^${staticRule.source}$`);
  for (const path of ['/', '/index.html', '/ui.mjs', '/vendor/three.module.min.js', '/case-study.pdf']) assert.ok(pattern.test(path), path);
  for (const path of ['/api', '/api/health', '/api/export']) assert.ok(!pattern.test(path), path);
  const csp = staticRule.headers.find(header => header.key === 'Content-Security-Policy').value;
  const expected = '{"imports":{"three":"/vendor/three.module.min.js"}}';
  const hash = createHash('sha256').update(expected, 'utf8').digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`));
  assert.ok(!csp.includes("script-src 'unsafe-inline'"));
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const actual = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/u)?.[1];
  assert.equal(actual, expected);
});
