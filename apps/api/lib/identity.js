import { HttpError } from './http.js';
import { browserSessionFromRequest } from './browser-session.js';
import { AeroCoreAdapterError, createRydeSyncAeroCoreAdapter } from './aerocore-app-adapter.js';

export class IdentityContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdentityContractError';
  }
}

const guest = (authState = 'anonymous', reason = null) => Object.freeze({
  kind: 'guest',
  authenticated: false,
  identityId: null,
  displayName: null,
  email: null,
  capabilities: [],
  capabilitiesFresh: false,
  authState,
  reason
});

function bearer(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(400, 'invalid_authorization', 'Authorization must use Bearer token format');
  return match[1].trim();
}

export function mapAvIdentityPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new IdentityContractError('Identity response must be an object');

  const identityId = payload.identity_id ?? payload.identityId ?? payload.identity?.id ?? null;
  if (typeof identityId !== 'string' || identityId.length < 4) {
    throw new IdentityContractError('Identity response did not include a canonical identity_id');
  }

  const displayName = payload.display_name ?? payload.displayName ?? payload.identity?.display_name ?? payload.name ?? null;
  const email = payload.email ?? payload.identity?.email ?? null;
  const rawCaps = payload.capabilities ?? payload.grants ?? payload.effective_capabilities ?? [];
  const capabilities = Array.isArray(rawCaps)
    ? rawCaps.filter((value) => typeof value === 'string')
    : [];

  return Object.freeze({
    kind: 'member',
    authenticated: true,
    identityId,
    displayName: typeof displayName === 'string' ? displayName : null,
    email: typeof email === 'string' ? email : null,
    capabilities: Object.freeze([...new Set(capabilities)]),
    capabilitiesFresh: true,
    authState: 'verified',
    reason: null
  });
}

export async function verifyWithAeroVista(token, config) {
  if (typeof config.identity.verifyToken === 'function') {
    const result = await config.identity.verifyToken(token);
    return result?.kind === 'member' ? Object.freeze({ ...result, capabilitiesFresh: result.capabilitiesFresh !== false }) : mapAvIdentityPayload(result);
  }

  if (!config.identity.baseUrl || !config.identity.verifyPath) {
    throw new IdentityContractError('Legacy bearer verification is not configured; use AeroVista Account sign-in');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.identity.timeoutMs);
  try {
    const response = await fetch(`${config.identity.baseUrl}${config.identity.verifyPath}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'x-aerovista-app': config.identity.appId
      },
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, 'identity_rejected', 'AeroVista Identity rejected this session');
    }
    if (!response.ok) {
      throw new IdentityContractError(`Identity gateway returned HTTP ${response.status}`);
    }
    return mapAvIdentityPayload(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function describeGatewaySession(token, config, expectedIdentityId = null) {
  if (!config.identity.identityGatewayOrigin || !config.identity.serviceSecret) {
    throw new IdentityContractError('AeroCore App Adapter service identity is not configured');
  }

  const av = createRydeSyncAeroCoreAdapter(config);
  let described;
  try {
    described = await av.identity.describe(token);
  } catch (error) {
    if (error instanceof AeroCoreAdapterError && [401, 403].includes(error.status)) {
      throw new HttpError(401, 'identity_rejected', 'AeroVista Identity rejected this session');
    }
    throw error;
  }

  if (!described?.authenticated) {
    throw new HttpError(401, 'identity_rejected', 'AeroVista Identity session is no longer authenticated');
  }
  const identity = described.identity;
  if (typeof identity?.identityId !== 'string' || identity.identityId.length < 4) {
    throw new IdentityContractError('Gateway descriptor did not include a canonical identityId');
  }
  if (identity.status !== 'active'
      || (identity.service && identity.service !== config.identity.appId)
      || (expectedIdentityId && expectedIdentityId !== identity.identityId)) {
    throw new HttpError(401, 'identity_rejected', 'AeroVista Identity session does not match this active app identity');
  }
  return identity;
}

async function verifyGatewaySession(token, config, expectedIdentityId = null) {
  const identity = await describeGatewaySession(token, config, expectedIdentityId);
  const av = createRydeSyncAeroCoreAdapter(config);

  const capabilities = [];
  for (const capability of config.identity.capabilitySnapshot ?? []) {
    const decision = await av.identity.can({ identityId: identity.identityId, capability });
    if (decision?.allowed === true) capabilities.push(capability);
  }

  return Object.freeze({
    kind: 'member',
    authenticated: true,
    identityId: identity.identityId,
    displayName: typeof identity.name === 'string' ? identity.name : null,
    email: typeof identity.email === 'string' ? identity.email : null,
    capabilities: Object.freeze(capabilities),
    capabilitiesFresh: true,
    authState: 'gateway_session',
    reason: null
  });
}

export async function resolveIdentity(req, config) {
  const token = bearer(req);
  if (token) {
    if (config.identity.mode === 'off') return guest('disabled', 'identity_disabled');
    try {
      return await verifyWithAeroVista(token, config);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) throw error;
      if (config.identity.mode === 'required') {
        throw new HttpError(503, 'identity_unavailable', 'AeroVista Identity is unavailable', {
          cause: error?.name || 'IdentityError'
        });
      }
      return guest('unavailable', error?.message || 'identity_unavailable');
    }
  }

  if (config.identity.mode === 'off') return guest('disabled', 'identity_disabled');
  const browserSession = browserSessionFromRequest(req, config);
  if (!browserSession) return guest();

  try {
    if (!browserSession.upstreamToken) {
      throw new HttpError(401, 'identity_rejected', 'Sign in again to verify this legacy browser session');
    }
    return await verifyGatewaySession(browserSession.upstreamToken, config, browserSession.principal.identityId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      if (config.identity.mode === 'required') throw error;
      return guest('expired', 'identity_rejected');
    }
    if (config.identity.mode === 'required') {
      throw new HttpError(503, 'identity_unavailable', 'AeroVista Identity is unavailable', {
        cause: error?.name || 'IdentityError'
      });
    }
    return guest('unavailable', error?.message || 'identity_unavailable');
  }
}

export function requireIdentity(principal) {
  if (!principal?.authenticated || principal.kind !== 'member') {
    throw new HttpError(401, 'auth_required', 'Sign in with AeroVista Identity to use this capability');
  }
  return principal;
}

export function requireCapability(principal, capability) {
  requireIdentity(principal);
  if (principal.capabilitiesFresh === false) {
    throw new HttpError(503, 'identity_unavailable', 'Live AeroVista authorization is required for this capability');
  }
  if (!principal.capabilities.includes(capability)) {
    throw new HttpError(403, 'capability_required', `Missing required capability: ${capability}`);
  }
  return principal;
}
