import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { mapAvIdentityPayload } from './identity.js';
import {
  authStateCookie,
  authStateFromRequest,
  browserSessionCookie,
  clearAuthStateCookie,
  clearBrowserSessionCookie,
  issueBrowserSession
} from './browser-session.js';

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  res.end();
}

function safeNext(value, config) {
  if (!value || typeof value !== 'string') return '/';
  try {
    const base = new URL(config.publicBaseUrl);
    const target = new URL(value, base);
    if (target.origin !== base.origin) return '/';
    return `${target.pathname}${target.search}` || '/';
  } catch {
    return '/';
  }
}

function callbackUrl(config, next = '/') {
  const callback = new URL('/auth/callback', config.publicBaseUrl);
  const normalized = safeNext(next, config);
  if (normalized !== '/') callback.searchParams.set('next', normalized);
  return callback.toString();
}

export function browserLoginConfigured(config) {
  return Boolean(config.identity.loginUrl && config.identity.handoffExchangeUrl);
}

export function beginBrowserLogin(res, config, url = null) {
  if (!browserLoginConfigured(config)) {
    throw new HttpError(503, 'login_not_configured', 'AeroVista sign-in handoff is not configured for RydeSync');
  }
  const state = crypto.randomBytes(24).toString('base64url');
  const next = safeNext(url?.searchParams?.get('next') || '/', config);
  const login = new URL(config.identity.loginUrl);
  login.searchParams.set(config.identity.handoffReturnParam, callbackUrl(config, next));
  login.searchParams.set(config.identity.handoffStateParam, state);
  if (config.identity.handoffAudienceParam && config.identity.handoffAudience) {
    login.searchParams.set(config.identity.handoffAudienceParam, config.identity.handoffAudience);
  }
  return redirect(res, login.toString(), { 'set-cookie': authStateCookie(state, config) });
}

function extractPrincipalPayload(body) {
  if (!body || typeof body !== 'object') return body;
  if (body.principal && typeof body.principal === 'object') return body.principal;
  if (body.identity && typeof body.identity === 'object') {
    return {
      ...body,
      identity: body.identity,
      identity_id: body.identity_id ?? body.identityId ?? body.identity.id
    };
  }
  return body;
}

function extractUpstreamToken(body) {
  for (const value of [body?.session_token, body?.sessionToken, body?.access_token, body?.accessToken, body?.token]) {
    if (typeof value === 'string' && value.length >= 12) return value;
  }
  return null;
}

export async function completeBrowserLogin(req, res, url, config) {
  if (!browserLoginConfigured(config)) {
    throw new HttpError(503, 'login_not_configured', 'AeroVista sign-in handoff is not configured for RydeSync');
  }
  const state = url.searchParams.get(config.identity.handoffStateParam);
  const expectedState = authStateFromRequest(req);
  if (!state || !expectedState || state !== expectedState) {
    throw new HttpError(400, 'invalid_auth_state', 'AeroVista sign-in state did not match this browser session');
  }
  const code = url.searchParams.get(config.identity.handoffCodeParam);
  if (!code) throw new HttpError(400, 'missing_handoff_code', 'AeroVista sign-in did not return a handoff code');

  const next = safeNext(url.searchParams.get('next') || '/', config);
  const redirectUri = callbackUrl(config, next);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.identity.timeoutMs);
  let response;
  try {
    response = await fetch(config.identity.handoffExchangeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-aerovista-app': config.identity.appId
      },
      body: JSON.stringify({
        code,
        state,
        audience: config.identity.handoffAudience,
        redirect_uri: redirectUri
      }),
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    throw new HttpError(503, 'handoff_unavailable', timedOut
      ? 'AeroVista sign-in handoff timed out'
      : 'AeroVista sign-in handoff is temporarily unavailable');
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 410) {
    throw new HttpError(401, 'handoff_rejected', 'AeroVista rejected or expired this one-time sign-in handoff');
  }
  if (!response.ok) throw new HttpError(503, 'handoff_unavailable', `AeroVista handoff exchange returned HTTP ${response.status}`);

  const body = await response.json();
  const principal = mapAvIdentityPayload(extractPrincipalPayload(body));
  const session = issueBrowserSession({ principal, upstreamToken: extractUpstreamToken(body) }, config);
  const destination = new URL(next, config.publicBaseUrl);
  destination.searchParams.set('signed_in', '1');
  return redirect(res, `${destination.pathname}${destination.search}`, {
    'set-cookie': [browserSessionCookie(session, config), clearAuthStateCookie(config)]
  });
}

export function browserLogout(res, config) {
  return redirect(res, '/', { 'set-cookie': [clearBrowserSessionCookie(config), clearAuthStateCookie(config)] });
}
