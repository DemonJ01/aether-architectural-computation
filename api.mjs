import { DEFAULT, LIMITS, solve, contextExperiment, fixedChunks, requirementBlocks, csv, planSVG } from './public/engine.mjs';

// Uses Web APIs only so the same handler can run in a worker or the local server.
export const MAX_BODY_BYTES = 131_072;
export const MAX_CONTEXT_CHARACTERS = 30_000;
const SCHEMA = 'architectural-computation-api/1.0';
const PARAM_KEYS = Object.keys(DEFAULT);
const METHODS = new Map([
  ['/api/health', ['GET']],
  ['/api/study', ['GET']],
  ['/api/evaluate', ['POST']],
  ['/api/context', ['GET', 'POST']],
  ['/api/export', ['POST']],
]);
export function allowedApiMethods(pathname) {
  const methods = METHODS.get(pathname);
  return methods ? [...methods] : null;
}
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
};

class InputError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function object(value, allowed, label = 'Body') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError(422, 'invalid_object', `${label} must be a JSON object.`);
  }
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new InputError(422, 'unknown_field', `${label} contains an unsupported field.`);
  }
  return value;
}

function params(value = {}) {
  object(value, PARAM_KEYS, 'Parameters');
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) {
      throw new InputError(422, 'invalid_parameter', `${key} must be a finite number from ${min} to ${max}.`);
    }
  }
  if (Object.hasOwn(value, 'maintenance') && typeof value.maintenance !== 'boolean') {
    throw new InputError(422, 'invalid_parameter', 'maintenance must be a boolean.');
  }
  return { ...DEFAULT, ...value };
}

async function readJson(request) {
  const mediaType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new InputError(415, 'unsupported_media_type', 'Use application/json.');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new InputError(400, 'invalid_length', 'Invalid content length.');
  }
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new InputError(413, 'body_too_large', 'Request body exceeds the byte limit.');
  }
  if (!request.body) throw new InputError(400, 'invalid_json', 'A JSON body is required.');
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InputError(413, 'body_too_large', 'Request body exceeds the byte limit.');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (declared !== null && Number(declared) !== size) {
    throw new InputError(400, 'invalid_length', 'Content length does not match the request body.');
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new InputError(400, 'invalid_json', 'The request must contain valid UTF-8 JSON.');
  }
}

function compareContext(value) {
  object(value, ['text']);
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > MAX_CONTEXT_CHARACTERS) {
    throw new InputError(422, 'invalid_text', `text must contain 1 to ${MAX_CONTEXT_CHARACTERS} characters.`);
  }
  const blocks = requirementBlocks(value.text);
  const chunks = fixedChunks(value.text, 500);
  const wordCount = text => text.trim().split(/\s+/u).length;
  let cursor = 0;
  let splitParagraphCount = 0;
  const blockSizes = blocks.map(block => {
    const count = wordCount(block);
    const end = cursor + count;
    if (Math.floor(cursor / 500) !== Math.floor((end - 1) / 500)) splitParagraphCount += 1;
    cursor = end;
    return count;
  });
  return {
    schema: SCHEMA,
    methodology: 'Deterministic text segmentation only. Fixed chunks use 500 words; paragraph blocks use blank lines. Paragraph preservation is not a measure of semantic accuracy, retrieval quality, or compliance.',
    input: { characters: value.text.length, words: cursor, paragraphs: blocks.length },
    fixed: { chunkWords: 500, chunkCount: chunks.length, splitParagraphCount, chunkWordCounts: chunks.map(wordCount) },
    paragraphs: { blockCount: blocks.length, retainedParagraphCount: blocks.length, maxBlockWords: Math.max(...blockSizes), blockWordCounts: blockSizes },
    limitations: 'A paragraph may contain unrelated requirements or exceed a model context window. This comparison uses no language model and does not identify or validate rules in pasted text.',
  };
}

async function exportStudy(request) {
  const input = object(await readJson(request), ['params', 'format', 'routeId']);
  const study = solve(params(input.params));
  if (!['json', 'csv', 'svg'].includes(input.format)) {
    throw new InputError(422, 'invalid_format', 'format must be json, csv, or svg.');
  }
  const routeId = Object.hasOwn(input, 'routeId') ? input.routeId : (study.selectedId ?? study.rows[0].id);
  if (typeof routeId !== 'string' || !study.rows.some(row => row.id === routeId)) {
    throw new InputError(422, 'invalid_route', 'routeId must identify a study candidate.');
  }
  const payloads = {
    json: () => [JSON.stringify(study, null, 2), 'application/json; charset=utf-8'],
    csv: () => [csv(study), 'text/csv; charset=utf-8'],
    svg: () => [planSVG(study, routeId), 'image/svg+xml; charset=utf-8'],
  };
  const [body, type] = payloads[input.format]();
  return new Response(body, { headers: {
    ...SECURITY_HEADERS,
    'content-type': type,
    'content-disposition': `attachment; filename="architectural-computation-study.${input.format}"`,
  } });
}

export async function handleApi(request) {
  try {
    const pathname = new URL(request.url).pathname;
    const methods = METHODS.get(pathname);
    if (!methods) return json({ error: { code: 'not_found', message: 'API endpoint not found.' } }, 404);
    if (!methods.includes(request.method)) {
      return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405, { allow: methods.join(', ') });
    }
    if (pathname === '/api/health') return json({ ok: true, service: 'architectural-computation', schema: SCHEMA });
    if (pathname === '/api/study') return json(solve());
    if (pathname === '/api/evaluate') return json(solve(params(await readJson(request))));
    if (pathname === '/api/context') {
      if (request.method === 'POST') return json(compareContext(await readJson(request)));
      return json({
        schema: SCHEMA,
        methodology: 'Authored fixture: a requirement and its qualifier share a paragraph placed near a 500-word boundary. The test reports literal retention of the qualifier; it uses no language model and makes no retrieval-accuracy claim.',
        experiments: contextExperiment(),
      });
    }
    return await exportStudy(request);
  } catch (error) {
    if (error instanceof InputError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'internal_error', message: 'The study could not be completed.' } }, 500);
  }
}
