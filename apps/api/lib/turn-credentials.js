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

export function issueTurnIceServers({ roomId, memberId, roomExpiresAt = null }, config, now = Date.now()) {
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
    const ttlSeconds = Number(voice.turnCredentialTtlSeconds || 21_600);
    const ttlExpiresAtSeconds = Math.floor(now / 1000) + ttlSeconds;
    const roomExpiresAtMs = Number(roomExpiresAt);
    const roomExpiresAtSeconds = Number.isFinite(roomExpiresAtMs) && roomExpiresAtMs > now
      ? Math.floor(roomExpiresAtMs / 1000)
      : null;
    // Relay credentials should stay valid for an active long-running Ryde, but
    // never extend beyond the room's own server-side lifetime when known.
    const expiresAtSeconds = roomExpiresAtSeconds
      ? Math.min(ttlExpiresAtSeconds, roomExpiresAtSeconds)
      : ttlExpiresAtSeconds;
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
