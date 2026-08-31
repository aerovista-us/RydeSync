import crypto from 'node:crypto';

export function turnIsConfigured(config) {
  const voice = config?.voice || {};
  const urlsReady = Array.isArray(voice.turnUrls) && voice.turnUrls.length > 0;
  const sharedSecretReady = typeof voice.turnSharedSecret === 'string' && voice.turnSharedSecret.length >= 16;
  const legacyStaticReady = Boolean(voice.turnUsername && voice.turnCredential);
  return Boolean(urlsReady && (sharedSecretReady || legacyStaticReady));
}

function stunServer(config) {
  const urls = config?.voice?.stunUrls;
  return Array.isArray(urls) && urls.length ? { urls } : null;
}

export function issueTurnIceServers({ roomId, memberId }, config, now = Date.now()) {
  const voice = config?.voice || {};
  const iceServers = [];
  const stun = stunServer(config);
  if (stun) iceServers.push(stun);

  if (!turnIsConfigured(config)) {
    return {
      iceServers,
      turnConfigured: false,
      credentialMode: 'none',
      expiresAt: null
    };
  }

  if (voice.turnSharedSecret && voice.turnSharedSecret.length >= 16) {
    const ttlSeconds = Number(voice.turnCredentialTtlSeconds || 1800);
    const expiresAtSeconds = Math.floor(now / 1000) + ttlSeconds;
    const subject = `${roomId}:${memberId}`;
    const username = `${expiresAtSeconds}:${subject}`;
    const credential = crypto
      .createHmac('sha1', voice.turnSharedSecret)
      .update(username)
      .digest('base64');

    iceServers.push({
      urls: voice.turnUrls,
      username,
      credential
    });

    return {
      iceServers,
      turnConfigured: true,
      credentialMode: 'room-ephemeral',
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
    };
  }

  iceServers.push({
    urls: voice.turnUrls,
    username: voice.turnUsername,
    credential: voice.turnCredential
  });
  return {
    iceServers,
    turnConfigured: true,
    credentialMode: 'room-static-legacy',
    expiresAt: null
  };
}
