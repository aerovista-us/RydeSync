import crypto from 'node:crypto';

const VERSION = 1;
const COOKIE = '__session';
const STATE_COOKIE = 'rydesync_auth_state';

function secure(config) {
  try { return new URL(config.publicBaseUrl).protocol === 'https:'; }
  catch { return config.nodeEnv === 'production'; }
}

function key(config) {
  return crypto.createHmac('sha256', config.roomTokenSecret)
    .update('rydesync/browser-session/v1')
    .digest();
}

function parseCookies(header = '') {
  const out = new Map();
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    out.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return out;
}

function seal(payload, config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(config), iv);
  const plaintext = Buffer.from(JSON.stringify(payload));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

function open(token, config) {
  const [version, iv64, body64, tag64, extra] = String(token || '').split('.');
  if (version !== String(VERSION) || !iv64 || !body64 || !tag64 || extra) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(config), Buffer.from(iv64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(body64, 'base64url')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

export function issueBrowserSession({ principal, upstreamToken = null }, config, now = Date.now()) {
  const ttlSeconds = config.identity.browserSessionTtlSeconds ?? 900;
  const payload = {
    v: VERSION,
    aud: 'rydesync-browser',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds,
    principal: {
      identityId: principal.identityId,
      displayName: principal.displayName || null,
      email: principal.email || null,
      capabilities: Array.isArray(principal.capabilities) ? principal.capabilities : []
    },
    upstreamToken: typeof upstreamToken === 'string' && upstreamToken ? upstreamToken : null
  };
  return { token: seal(payload, config), ttlSeconds, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function browserSessionFromRequest(req, config, now = Date.now()) {
  const token = parseCookies(req.headers.cookie).get(COOKIE);
  if (!token) return null;
  const payload = open(token, config);
  if (!payload || payload.aud !== 'rydesync-browser' || payload.exp * 1000 <= now) return null;
  if (typeof payload.principal?.identityId !== 'string') return null;
  return payload;
}

export function browserSessionCookie(session, config) {
  const attrs = [
    `${COOKIE}=${session.token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${session.ttlSeconds}`
  ];
  if (secure(config)) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearBrowserSessionCookie(config) {
  const attrs = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure(config)) attrs.push('Secure');
  return attrs.join('; ');
}

export function authStateCookie(state, config, maxAge = 300) {
  const attrs = [`${STATE_COOKIE}=${encodeURIComponent(state)}`, 'Path=/auth/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure(config)) attrs.push('Secure');
  return attrs.join('; ');
}

export function authStateFromRequest(req) {
  const value = parseCookies(req.headers.cookie).get(STATE_COOKIE);
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
}

export function clearAuthStateCookie(config) {
  const attrs = [`${STATE_COOKIE}=`, 'Path=/auth/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure(config)) attrs.push('Secure');
  return attrs.join('; ');
}
