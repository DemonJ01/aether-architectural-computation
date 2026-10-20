import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { handleApi, allowedApiMethods, MAX_BODY_BYTES, MAX_CONTEXT_CHARACTERS } from '../api.mjs';
import { resolvePublicPath, createServer, createPortfolioServer, STATIC_CSP } from '../server.mjs';
import { CONDITION } from '../public/engine.mjs';

const origin = 'https://study.example';
const get = path => handleApi(new Request(`${origin}${path}`));
const post = (path, value) => handleApi(new Request(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }));
const read = async response => ({ status: response.status, body: await response.json() });

test('health identifies a running architectural computation service', async () => {
  const response = await get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  assert.deepEqual(await response.json(), { ok: true, service: 'architectural-computation', schema: 'architectural-computation-api/1.0' });
});

test('baseline and raised beam evaluations retain independently calculated route lengths', async () => {
  const baseline = await (await get('/api/study')).json();
  assert.equal(baseline.selectedId, 'derived');
  assert.equal(baseline.rows.length, 6);
  assert.equal(baseline.feasibleCount, 3);
  const north = baseline.rows.find(row => row.id === 'north');
  // 10.6 m between endpoints, plus two 3.1 m lateral legs.
  assert.ok(Math.abs(north.length - (11.3 - 0.7 + 2 * (7.1 - 4))) < 1e-9);
  assert.ok(Math.abs(north.length - 16.8) < 1e-9);
  const derived = baseline.rows.find(row => row.id === 'derived');
  // Beam edge, separation and half service width place the tighter bypass at y = 6.8 m.
  const bypassY = 6.4 + baseline.params.clearance + baseline.geometry.ductWidth / 2;
  assert.ok(Math.abs(derived.length - (11.3 - 0.7 + 2 * (bypassY - 4))) < 1e-9);
  assert.ok(Math.abs(derived.length - 16.2) < 1e-9);
  assert.equal(derived.feasible, true);
  const response = await post('/api/evaluate', { beamSoffit: 3.05, headroom: 2.4, clearance: 0.1, maintenance: true });
  assert.equal(response.status, 200);
  const raised = await response.json();
  assert.equal(raised.selectedId, 'under');
  assert.equal(raised.feasibleCount, 4);
  const under = raised.rows.find(row => row.id === 'under');
  const offset = 3 - (3.05 - 0.1 - 0.35 / 2);
  assert.ok(Math.abs(under.length - (11.3 - 0.7 + 2 * offset)) < 1e-9);
  assert.ok(Math.abs(under.length - 11.05) < 1e-9);
  assert.equal(under.feasible, true);
  assert.ok(under.checks.every(check => check.pass));
});

test('partial parameters use the declared defaults', async () => {
  const { status, body } = await read(await post('/api/evaluate', { maintenance: false }));
  assert.equal(status, 200);
  assert.deepEqual(body.params, { beamSoffit: 2.7, headroom: 2.4, clearance: 0.1, maintenance: false });
  assert.equal((await post('/api/evaluate', {})).status, 200);
});

test('API rejects invalid finite values, wrong types, arrays, null and unknown fields', async () => {
  const invalid = [
    { beamSoffit: '3.05' }, { beamSoffit: null }, { beamSoffit: 3.21 }, { beamSoffit: 2.44 },
    { headroom: 0 }, { headroom: true }, { clearance: -0.1 }, { clearance: 0.21 },
    { maintenance: 'false' }, { maintenance: 0 }, { maintenance: null }, { arbitrary: 1 },
    { params: {} }, [], null, 'text', 42,
  ];
  for (const value of invalid) {
    const { status, body } = await read(await post('/api/evaluate', value));
    assert.equal(status, 422, JSON.stringify(value));
    assert.ok(body.error.code);
  }
  for (const body of ['{"beamSoffit":1e309}', '{"__proto__":{"polluted":true}}']) {
    const response = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
    assert.equal(response.status, 422);
  }
  assert.equal({}.polluted, undefined);
});

test('API accepts inclusive geometric boundaries', async () => {
  for (const value of [
    { beamSoffit: 2.45, headroom: 2.1, clearance: 0.05, maintenance: false },
    { beamSoffit: 3.2, headroom: 2.6, clearance: 0.2, maintenance: true },
  ]) assert.equal((await post('/api/evaluate', value)).status, 200);
});

test('malformed JSON, UTF-8, content types and declared lengths are rejected', async () => {
  for (const body of ['', '{', '{"clearance":NaN}', 'null trailing']) {
    const response = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_json');
  }
  const utf8 = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0xff]) }));
  assert.equal(utf8.status, 400);
  for (const type of ['', 'text/plain', 'text/html', 'application/x-www-form-urlencoded']) {
    const response = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': type }, body: '{}' }));
    assert.equal(response.status, 415);
  }
  for (const declared of ['not-a-number', '-1', '9007199254740993']) {
    const response = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': declared }, body: '{}' }));
    assert.equal(response.status, 400);
  }
  const mismatch = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1' }, body: '{}' }));
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, 'invalid_length');
});

test('byte limits apply to both content-length and streamed bodies', async () => {
  const declared = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) }, body: '{}' }));
  assert.equal(declared.status, 413);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  const streamed = await handleApi(new Request(`${origin}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' }));
  assert.equal(streamed.status, 413);
  assert.equal(cancelled, true);
});

test('unknown paths and methods have explicit status and Allow headers', async () => {
  assert.equal((await get('/api/not-found')).status, 404);
  assert.equal((await get('/api/study/')).status, 404);
  for (const [path, method, allow] of [
    ['/api/health', 'POST', 'GET'], ['/api/evaluate', 'GET', 'POST'],
    ['/api/export', 'HEAD', 'POST'], ['/api/context', 'DELETE', 'GET, POST'],
  ]) {
    const response = await handleApi(new Request(`${origin}${path}`, { method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), allow);
  }
  const methods = allowedApiMethods('/api/context');
  methods.push('DELETE');
  assert.deepEqual(allowedApiMethods('/api/context'), ['GET', 'POST']);
  assert.equal(allowedApiMethods('/api/not-found'), null);
});

test('authored context endpoint reports exact qualifier retention honestly', async () => {
  const response = await get('/api/context');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.experiments.length, 6);
  assert.match(body.methodology, /no language model/);
  for (const row of body.experiments) {
    assert.equal(row.fixedRetainsCondition, row.before.includes(CONDITION));
    assert.equal(row.blockRetainsCondition, row.after.includes(CONDITION));
    assert.equal(row.fixedRetainsCondition, false);
    assert.equal(row.blockRetainsCondition, true);
  }
});

test('pasted context comparison counts paragraph splits without echoing text or claiming semantics', async () => {
  const text = `${'first '.repeat(490)}\n\n${'second '.repeat(20)}`;
  const { status, body } = await read(await post('/api/context', { text }));
  assert.equal(status, 200);
  assert.deepEqual(body.input, { characters: text.length, words: 510, paragraphs: 2 });
  assert.equal(body.fixed.chunkCount, 2);
  assert.equal(body.fixed.splitParagraphCount, 1);
  assert.deepEqual(body.fixed.chunkWordCounts, [500, 10]);
  assert.deepEqual(body.paragraphs.blockWordCounts, [490, 20]);
  assert.match(body.methodology, /not a measure of semantic accuracy/);
  assert.match(body.limitations, /no language model/);
  const injection = await post('/api/context', { text: '<script>alert(1)</script>' });
  assert.equal(injection.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.ok(!(await injection.text()).includes('<script>'));
});

test('pasted context length, empty input and fields are bounded', async () => {
  for (const value of [{}, { text: '' }, { text: '  \n ' }, { text: 1 }, { text: 'a'.repeat(MAX_CONTEXT_CHARACTERS + 1) }, { text: 'okay', url: 'https://example.com' }]) {
    assert.equal((await post('/api/context', value)).status, 422);
  }
  assert.equal((await post('/api/context', { text: 'a'.repeat(MAX_CONTEXT_CHARACTERS) })).status, 200);
});

test('exports are computed attachments in JSON, CSV and SVG', async () => {
  for (const format of ['json', 'csv', 'svg']) {
    const response = await post('/api/export', { params: { beamSoffit: 3.05 }, format, routeId: 'under' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="architectural-computation-study.${format}"`);
    const content = await response.text();
    if (format === 'json') assert.equal(JSON.parse(content).selectedId, 'under');
    if (format === 'csv') {
      assert.match(response.headers.get('content-type'), /^text\/csv/);
      assert.equal(content.split('\n').length, 7);
      assert.match(content, /^under,11\.050,/m);
    }
    if (format === 'svg') {
      assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
      assert.match(content, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(content, /Pass below beam plan/);
      assert.ok(!content.includes('<script'));
    }
  }
  assert.equal((await post('/api/export', { format: 'json' })).status, 200);
});

test('export inputs cannot inject markup, fields, filenames or arbitrary route geometry', async () => {
  for (const value of [
    {}, { format: 'pdf' }, { format: 'svg', routeId: '<script>alert(1)</script>' },
    { format: 'json', params: { points: [] } }, { format: 'json', params: null },
    { format: 'svg', routeId: null }, { format: 'svg', routeId: 1 },
    { format: 'json', filename: 'x.html' }, { format: 'csv', params: { clearance: '0.1' } },
  ]) {
    const response = await post('/api/export', value);
    assert.equal(response.status, 422, JSON.stringify(value));
    assert.ok(!(await response.text()).includes('<script>'));
  }
});

test('static paths reject traversal, encoded segments, hidden files and malformed targets', () => {
  const root = '/tmp/architectural-computation-public';
  assert.equal(resolvePublicPath('/', root), `${root}/index.html`);
  assert.equal(resolvePublicPath('/engine.mjs?version=1', root), `${root}/engine.mjs`);
  assert.equal(resolvePublicPath('/assets/plan.svg', root), `${root}/assets/plan.svg`);
  for (const target of [
    '../private/notes.md', '/../../private/notes.md', '/public/../private/notes.md',
    '/%2e%2e/private/notes.md', '/%2E%2E%2Fprivate/notes.md', '/%2e/engine.mjs',
    '/assets/%2e%2e/private/notes.md', '/assets/..%5cprivate/notes.md',
    '/.git/config', '/assets/.env', '/%00', '/%', '/%GG', '//private/notes.md',
    'https://example.com/', '/engine.mjs#fragment',
  ]) assert.equal(resolvePublicPath(target, root), null, target);
});

test('server can be constructed without starting a network listener', () => {
  const server = createServer();
  assert.equal(server.listening, false);
  assert.equal(server.requestTimeout, 15_000);
  assert.equal(server.headersTimeout, 10_000);
  assert.equal(server.maxRequestsPerSocket, 100);
  server.close();
});

test('static CSP authorizes only the exact import map present in every public HTML page', async () => {
  const directive = STATIC_CSP.split(';').map(value => value.trim()).find(value => value.startsWith('script-src '));
  const sources = directive.split(/\s+/u).slice(1);
  assert.equal(sources.length, 2);
  assert.equal(sources[0], "'self'");
  assert.match(sources[1], /^'sha256-[A-Za-z0-9+/]+=*'$/u);
  assert.ok(!sources.includes("'unsafe-inline'"));
  assert.ok(!sources.includes("'unsafe-eval'"));
  const expected = '{"imports":{"three":"/vendor/three.module.min.js"}}';
  for (const name of ['index.html', 'case-study.html', 'lab.html', 'research.html']) {
    const html = await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
    const maps = [...html.matchAll(/<script\s+type="importmap">([\s\S]*?)<\/script>/gu)];
    assert.equal(maps.length, 1, name);
    assert.equal(maps[0][1], expected, name);
    const hash = createHash('sha256').update(maps[0][1], 'utf8').digest('base64');
    assert.ok(sources.includes(`'sha256-${hash}'`), name);
  }
  const modified = createHash('sha256').update(`${expected} `, 'utf8').digest('base64');
  assert.ok(!sources.includes(`'sha256-${modified}'`));
});

test('invalid listener options fail before opening a port', async () => {
  for (const port of [-1, 65536, 1.2, NaN, '4184']) await assert.rejects(createPortfolioServer({ port }), /port must/);
  await assert.rejects(createPortfolioServer({ host: '' }), /host must/);
});
