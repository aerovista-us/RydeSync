export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers
  });
  res.end(payload);
}

export async function readJson(req, { limitBytes = 32_768 } = {}) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

export function cleanText(value, { field, min = 1, max = 120, pattern } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_field', `${field} must be a string`);
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length < min || clean.length > max) {
    throw new HttpError(400, 'invalid_field', `${field} must be between ${min} and ${max} characters`);
  }
  if (pattern && !pattern.test(clean)) throw new HttpError(400, 'invalid_field', `${field} has an invalid format`);
  return clean;
}
