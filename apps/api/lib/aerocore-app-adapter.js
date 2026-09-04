import crypto from 'node:crypto';

/**
 * RydeSync runtime bridge for AeroCore App Adapter v0.1.
 *
 * Canonical TypeScript source currently incubates in ACOS:
 *   packages/aerocore-app-adapter
 *   branch: feat/aerocore-app-adapter-v0
 *
 * This runtime bridge keeps RydeSync on its current zero-build Node runtime
 * while consuming the same locked wire contract. Remove this bridge once
 * @aerovista/app-adapter is published/extracted as an installable package.
 */

export class AeroCoreAdapterError extends Error {
  constructor(message, { status = 500, code = null, correlationId = null, body = null } = {}) {
    super(message);
    this.name = 'AeroCoreAdapterError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.body = body;
  }
}

function normalizeOrigin(value) {
  return String(value || '').replace(/\/$/, '');
}

function canonicalPath(value) {
  return new URL(value, 'https://adapter.invalid').pathname;
}

function rawBody(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

export function serviceHmac({ secret, method, path, timestamp, body = '' }) {
  const message = `${String(method).toUpperCase()}\n${canonicalPath(path)}\n${timestamp}\n${body}`;
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AeroCoreAdapterError(body?.error || `AeroCore request failed (${response.status})`, {
      status: response.status,
      code: body?.code ?? null,
      correlationId: body?.correlationId ?? response.headers.get('x-correlation-id'),
      body
    });
  }
  return body;
}

function withTimeout(fetchImpl, timeoutMs) {
  return async (url, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

export function buildAccountLoginUrl({ appId, loginUrl, returnTo, state }) {
  const login = new URL(loginUrl);
  login.searchParams.set('client_id', appId);
  login.searchParams.set('return_to', returnTo);
  login.searchParams.set('state', state);
  return login.toString();
}

export function createAeroCoreServerAdapter({
  appId,
  identityGatewayOrigin = 'https://identity-api.aerovista.us',
  identityGatewaySecret,
  timeoutMs = 2500,
  fetchImpl = fetch,
  now = () => new Date()
}) {
  if (!appId) throw new Error('AeroCore adapter requires appId');
  if (!identityGatewaySecret) throw new Error('AeroCore adapter requires identityGatewaySecret');

  const origin = normalizeOrigin(identityGatewayOrigin);
  const boundedFetch = withTimeout(fetchImpl, timeoutMs);

  async function call(path, { method = 'POST', body } = {}) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(normalizedPath, `${origin}/`);
    const serialized = rawBody(body);
    const timestamp = now().toISOString();
    const signature = serviceHmac({
      secret: identityGatewaySecret,
      method,
      path: url.toString(),
      timestamp,
      body: serialized
    });

    const headers = {
      accept: 'application/json',
      'x-av-service': String(appId).toUpperCase(),
      'x-av-timestamp': timestamp,
      'x-av-signature': signature
    };
    if (serialized) headers['content-type'] = 'application/json';

    const response = await boundedFetch(url, {
      method,
      headers,
      ...(serialized ? { body: serialized } : {})
    });
    return readJson(response);
  }

  return Object.freeze({
    appId,
    auth: Object.freeze({
      exchangeHandoff(code) {
        return call('/v1/handoff/exchange', { body: { code } });
      },
      resolveSession(sessionToken) {
        return call('/v1/session/resolve', { body: { sessionToken } });
      },
      revokeSession(sessionToken) {
        return call('/v1/session/revoke', { body: { sessionToken } });
      }
    }),
    identity: Object.freeze({
      can({ identityId, capability, resourceType = null, resourceId = null }) {
        return call('/v1/authorization/check', {
          body: { identityId, capability, resourceType, resourceId }
        });
      }
    }),
    services: Object.freeze({ call })
  });
}

export function createRydeSyncAeroCoreAdapter(config, overrides = {}) {
  return createAeroCoreServerAdapter({
    appId: config.identity.appId,
    identityGatewayOrigin: config.identity.identityGatewayOrigin,
    identityGatewaySecret: config.identity.serviceSecret,
    timeoutMs: config.identity.timeoutMs,
    ...overrides
  });
}
