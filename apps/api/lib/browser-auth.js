import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { mapAvIdentityPayload } from './identity.js';
import {
  authStateCookie,
  authStateFromRequest,
  browserSessionCookie,
  browserSessionFromRequest,
  clearAuthStateCookie,
  clearBrowserSessionCookie,
  issueBrowserSession
} from './browser-session.js';
import {
  AeroCoreAdapterError,
  buildAccountLoginUrl,
  createRydeSyncAeroCoreAdapter
} from './aerocore-app-adapter.js';

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
  return Boolean(
    config.identity.loginUrl
    && config.identity.identityGatewayOrigin
    && config.identity.serviceSecret
    && config.identity.appId
  );
}

export function beginBrowserLogin(res, config, url = null) {
  if (!browserLoginConfigured(config)) {
    throw new HttpError(503, 'login_not_configured', 'AeroVista sign-in handoff is not configured for RydeSync');
  }
  const state = crypto.randomBytes(24).toString('base64url');
  const next = safeNext(url?.searchParams?.get('next') || '/', config);
  const login = buildAccountLoginUrl({
    appId: config.identity.appId,
    loginUrl: config.identity.loginUrl,
    returnTo: callbackUrl(config, next),
    state
  });
  return redirect(res, login, { 'set-cookie': authStateCookie(state, config) });
}

function mapAdapterFailure(error) {
  if (error instanceof AeroCoreAdapterError) {
    if ([400, 401, 403, 409, 410].includes(error.status)) {
      return new HttpError(401, 'handoff_rejected', 'AeroVista rejected or expired this one-time sign-in handoff');
    }
    return new HttpError(503, 'handoff_unavailable', `AeroVista handoff exchange returned HTTP ${error.status}`);
  }
  if (error?.name === 'AbortError') {
    return new HttpError(503, 'handoff_unavailable', 'AeroVista sign-in handoff timed out');
  }
  return new HttpError(503, 'handoff_unavailable', 'AeroVista sign-in handoff is temporarily unavailable');
}

export async function completeBrowserLogin(req, res, url, config) {
  if (!browserLoginConfigured(config)) {
    throw new HttpError(503, 'login_not_configured', 'AeroVista sign-in handoff is not configured for RydeSync');
  }
  const state = url.searchParams.get('state');
  const expectedState = authStateFromRequest(req);
  if (!state || !expectedState || state !== expectedState) {
    throw new HttpError(400, 'invalid_auth_state', 'AeroVista sign-in state did not match this browser session');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new HttpError(400, 'missing_handoff_code', 'AeroVista sign-in did not return a handoff code');

  const next = safeNext(url.searchParams.get('next') || '/', config);
  let exchanged;
  let resolved;
  try {
    const av = createRydeSyncAeroCoreAdapter(config);
    exchanged = await av.auth.exchangeHandoff(code);
    if (typeof exchanged?.sessionToken !== 'string' || exchanged.sessionToken.length < 12) {
      throw new Error('AeroCore handoff response did not include sessionToken');
    }
    resolved = await av.auth.resolveSession(exchanged.sessionToken);
  } catch (error) {
    throw mapAdapterFailure(error);
  }

  if (!resolved?.authenticated || typeof resolved.identityId !== 'string' || resolved.identityId.length < 4) {
    throw new HttpError(401, 'handoff_rejected', 'AeroVista did not resolve an authenticated identity for this handoff');
  }

  const principal = mapAvIdentityPayload({ identity_id: resolved.identityId });
  const session = issueBrowserSession({ principal, upstreamToken: exchanged.sessionToken }, config);
  const destination = new URL(next, config.publicBaseUrl);
  destination.searchParams.set('signed_in', '1');
  return redirect(res, `${destination.pathname}${destination.search}`, {
    'set-cookie': [browserSessionCookie(session, config), clearAuthStateCookie(config)]
  });
}

export async function browserLogout(req, res, config) {
  const session = browserSessionFromRequest(req, config);
  if (session?.upstreamToken && browserLoginConfigured(config)) {
    try {
      const av = createRydeSyncAeroCoreAdapter(config);
      await av.auth.revokeSession(session.upstreamToken);
    } catch {
      // Logout must always clear the local browser session even when the
      // shared Identity service is temporarily unreachable.
    }
  }
  return redirect(res, '/', { 'set-cookie': [clearBrowserSessionCookie(config), clearAuthStateCookie(config)] });
}
