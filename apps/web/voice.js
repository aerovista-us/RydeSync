function memberIdOf(peer) {
  return typeof peer === 'string' ? peer : peer?.id;
}

export function shouldInitiateOffer(selfMemberId, remoteMemberId) {
  return Boolean(selfMemberId && remoteMemberId && String(selfMemberId).localeCompare(String(remoteMemberId)) < 0);
}

function statsValues(report) {
  if (!report) return [];
  if (Array.isArray(report)) return report;
  if (typeof report.values === 'function') return [...report.values()];
  if (typeof report[Symbol.iterator] === 'function') {
    return [...report].map((entry) => Array.isArray(entry) ? entry[1] : entry);
  }
  return Object.values(report);
}

export function selectedIcePathFromStats(report) {
  const values = statsValues(report).filter(Boolean);
  const byId = new Map(values.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  const transport = values.find((entry) => entry.type === 'transport' && entry.selectedCandidatePairId);
  let pair = transport ? byId.get(transport.selectedCandidatePairId) : null;
  if (!pair) pair = values.find((entry) => entry.type === 'candidate-pair' && entry.selected);
  if (!pair) pair = values.find((entry) => entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded');
  if (!pair) return null;

  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);
  if (!local && !remote) return null;
  return [local?.candidateType, remote?.candidateType].includes('relay') ? 'turn-relay' : 'direct';
}

export class VoiceClient {
  constructor({ iceServers = [], send, onState = () => {}, onFloor = () => {}, managedFloor = false, getIceServers = null } = {}) {
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];
    this.managedFloor = managedFloor;
    this.getIceServers = getIceServers;
    this.generation = 0;
    this.enabling = false;
    this.pendingPeers = new Map();
    this.send = send;
    this.onState = onState;
    this.onFloor = onFloor;
    this.selfMemberId = null;
    this.stream = null;
    this.peers = new Map();
    this.audios = new Map();
    this.enabled = false;
    this.joined = false;
    this.floorMemberId = null;
    this.pressActive = false;
    this.turnExpiresAt = null;
    this.iceRefreshAfter = 0;
    this.connectionPaths = new Map();
  }

  #selectedPath() {
    const values = [...this.connectionPaths.values()];
    if (values.includes('turn-relay')) return 'turn-relay';
    if (values.includes('direct')) return 'direct';
    return null;
  }

  #emit(state, detail = null) {
    const payload = {
      state,
      detail,
      peerCount: this.peers.size,
      floorMemberId: this.floorMemberId,
      selectedPath: this.#selectedPath(),
      turnExpiresAt: this.turnExpiresAt
    };
    this.onState(payload);
    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('rydesync:voice-observability', { detail: payload }));
    }
  }

  #send(value) {
    try { return this.send?.(value) !== false;
    } catch { return false; }
  }

  #roomToken() {
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem('rydesync:last-session') || 'null');
      return typeof saved?.token === 'string' ? saved.token : null;
    } catch {
      return null;
    }
  }

  async #refreshIceServers({ force = false } = {}) {
    const now = Date.now();
    if (!force && this.iceRefreshAfter > now) return true;
    if (this.managedFloor) {
      if (typeof this.getIceServers !== 'function') return false;
      const generation = this.generation;
      const value = await this.getIceServers();
      if (generation !== this.generation) return false;
      if (!Array.isArray(value?.iceServers)) throw new Error('Authorized ICE configuration unavailable');
      this.iceServers = value.iceServers;
      this.iceRefreshAfter = now + 30000;
      return true;
    }
    const roomToken = this.#roomToken();
    if (!roomToken || typeof globalThis.fetch !== 'function') return false;

    try {
      const response = await fetch('/v1/voice/ice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomToken })
      });
      if (!response.ok) {
        this.iceRefreshAfter = now + 30_000;
        return false;
      }
      const body = await response.json();
      if (Array.isArray(body?.iceServers) && body.iceServers.length) this.iceServers = body.iceServers;
      this.turnExpiresAt = body?.expiresAt || null;
      const expires = Date.parse(this.turnExpiresAt || '');
      this.iceRefreshAfter = Number.isFinite(expires)
        ? Math.max(now + 30_000, expires - 60_000)
        : now + 300_000;
      this.#emit(this.enabled ? (this.joined ? 'ready' : 'connecting') : 'off');
      return true;
    } catch {
      this.iceRefreshAfter = now + 30_000;
      return false;
    }
  }

  async enable(selfMemberId) {
    if (this.enabled && this.stream) {
      this.selfMemberId = selfMemberId || this.selfMemberId;
      this.rejoin();
      return;
    }
    if (this.enabling) throw new Error('Microphone request already pending');
    const generation = ++this.generation;
    this.enabling = true;
    try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is not supported by this browser');
    if (!await this.#refreshIceServers({ force: true }) && this.managedFloor) throw new Error("Authorized ICE configuration unavailable");
    this.#emit('requesting');
    if (generation !== this.generation) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    for (const track of stream.getAudioTracks()) track.enabled = false;
    if (generation !== this.generation) { for (const track of stream.getTracks()) track.stop(); return; }
    this.stream = stream;
    if(this.managedFloor)for(const track of stream.getAudioTracks())track.addEventListener("ended",()=>{if(generation===this.generation)this.#emit("error","Microphone lost")},{once:true});
    this.selfMemberId = selfMemberId;
    this.enabled = true;
    this.joined = false;
    if (!this.#send({ type: 'voice.join', ...(this.managedFloor ? {floorProtocol:'lease-v1'} : {}) })) { this.disable({notify:false}); throw new Error('Voice signaling unavailable'); }
    this.#emit('connecting');
    } finally { if (generation === this.generation) this.enabling = false; }
  }

  rejoin() {
    if (!this.enabled || this.managedFloor) return;
    this.joined = false;
    this.#muteLocal();
    this.#refreshIceServers().finally(() => {
      if (!this.enabled) return;
      this.#send({ type: 'voice.join' });
      this.#emit('connecting');
    });
  }

  realtimeDisconnected() {
    if(this.managedFloor) { this.disable({notify:false}); return; }
    this.joined = false;
    this.floorMemberId = null;
    this.pressActive = false;
    this.#muteLocal();
    for (const id of [...this.peers.keys()]) this.#removePeer(id);
    if (this.enabled) this.#emit('reconnecting');
  }

  disable({ notify = true } = {}) {
    ++this.generation;
    this.enabling = false;
    this.pendingPeers.clear();
    this.pressActive = false;
    this.#muteLocal();
    if (notify && this.joined) this.#send({ type: 'voice.leave' });
    for (const id of [...this.peers.keys()]) this.#removePeer(id);
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.enabled = false;
    this.joined = false;
    this.floorMemberId = null;
    this.receiveMemberId = null;
    this.connectionPaths.clear();
    this.#emit('off');
    this.onFloor({ memberId: null, active: false });
  }

  pressStart() {
    if (this.managedFloor || !this.enabled || !this.joined || this.pressActive) return false;
    this.pressActive = true;
    this.#send({ type: 'voice.talk.start' });
    this.#emit('requesting_floor');
    return true;
  }

  pressStop() {
    if (this.managedFloor || (!this.pressActive && this.floorMemberId !== this.selfMemberId)) return false;
    this.pressActive = false;
    this.#muteLocal();
    if (this.joined) this.#send({ type: 'voice.talk.stop' });
    this.#emit(this.enabled ? 'ready' : 'off');
    return true;
  }

  // Only the CommLink lease controller may request a managed transmit.
  setManagedTransmit(active) {
    if (!this.managedFloor) throw new Error('Not a managed voice client');
    const tracks=this.stream?.getAudioTracks()||[];
    const maySend = active === true && this.enabled && this.joined && tracks.some(track=>track.readyState==='live');
    for (const track of tracks) track.enabled = maySend && track.readyState==='live';
    return maySend;
  }
  setManagedReceiver(memberId) {
    if (!this.managedFloor) return;
    this.receiveMemberId = memberId || null;
    for (const [id,audio] of this.audios) audio.muted = id !== this.receiveMemberId;
  }
  async handle(message) {
    if(this.managedFloor && !this.enabled) return false;
    switch (message?.type) {
      case 'voice.joined':
        this.joined = true;
        this.selfMemberId = message.memberId || this.selfMemberId;
        this.floorMemberId = message.floorMemberId || null;
        this.#applyFloor();
        for (const peer of message.peers || []) await this.#ensurePeer(memberIdOf(peer));
        this.#emit('ready');
        return true;
      case 'voice.peer.joined': {
        const remoteId = memberIdOf(message.member);
        if (remoteId && remoteId !== this.selfMemberId) await this.#ensurePeer(remoteId);
        return true;
      }
      case 'voice.peer.left':
        this.#removePeer(message.memberId);
        return true;
      case 'voice.signal':
        await this.#handleSignal(message);
        return true;
      case 'voice.floor':
        this.floorMemberId = message.memberId || null;
        this.#applyFloor();
        this.onFloor({ memberId: this.floorMemberId, member: message.member || null, active: Boolean(this.floorMemberId) });
        this.#emit(this.floorMemberId === this.selfMemberId ? 'talking' : this.floorMemberId ? 'listening' : 'ready');
        return true;
      case 'voice.floor.denied':
        this.pressActive = false;
        this.#muteLocal();
        this.floorMemberId = message.memberId || this.floorMemberId;
        this.#emit('busy', this.floorMemberId);
        return true;
      case 'voice.error':
        this.pressActive = false;
        this.#muteLocal();
        this.#emit('error', message.error?.message || 'Voice request rejected');
        return true;
      default:
        return false;
    }
  }

  #muteLocal() {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = false;
  }

  #applyFloor() {
    if (!this.stream || this.managedFloor) return;
    const maySend = this.joined && this.floorMemberId === this.selfMemberId && this.pressActive;
    for (const track of this.stream.getAudioTracks()) track.enabled = maySend;
  }

  async #observePeerPath(remoteId, pc) {
    if (!pc?.getStats) return;
    try {
      const path = selectedIcePathFromStats(await pc.getStats());
      if (!path) return;
      this.connectionPaths.set(remoteId, path);
      this.#emit('ready');
    } catch {
      // Observability must never interfere with an otherwise healthy voice path.
    }
  }

  async #ensurePeer(remoteId) {
    if (!remoteId || remoteId === this.selfMemberId || !this.stream) return null;
    if (this.peers.has(remoteId)) return this.peers.get(remoteId);
    if (this.pendingPeers.has(remoteId)) return this.pendingPeers.get(remoteId);
    const generation = this.generation;
    const pending = this.#createPeer(remoteId,generation);
    this.pendingPeers.set(remoteId,pending);
    try { return await pending; } finally { if(this.pendingPeers.get(remoteId)===pending)this.pendingPeers.delete(remoteId); }
  }
  async #createPeer(remoteId,generation) {
    await this.#refreshIceServers();
    if (generation !== this.generation || !this.stream || !this.enabled) return null;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(remoteId, pc);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    pc.onicecandidate = ({ candidate }) => {
      if (generation === this.generation && this.peers.get(remoteId)===pc && candidate) this.#send({ type: 'voice.signal', toMemberId: remoteId, candidate: candidate.toJSON?.() || candidate });
    };
    pc.ontrack = ({ streams }) => {
      const stream = streams?.[0];
      if (!stream || generation !== this.generation || this.peers.get(remoteId)!==pc) return;
      let audio = this.audios.get(remoteId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.dataset.rydesyncVoicePeer = remoteId;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        this.audios.set(remoteId, audio);
      }
      if (generation !== this.generation || this.peers.get(remoteId)!==pc) return;
      if(this.managedFloor)audio.muted=remoteId!==this.receiveMemberId;
      audio.srcObject = stream;
      audio.play().catch(() => this.#emit('gesture_required', remoteId));
    };
    pc.onconnectionstatechange = () => {
      if(this.peers.get(remoteId)!==pc)return;
      if (['failed', 'closed'].includes(pc.connectionState)) this.#removePeer(remoteId);
      else if (pc.connectionState === 'connected') {
        this.#emit('ready');
        this.#observePeerPath(remoteId, pc);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (['connected', 'completed'].includes(pc.iceConnectionState)) this.#observePeerPath(remoteId, pc);
    };

    if (shouldInitiateOffer(this.selfMemberId, remoteId)) {
      const offer = await pc.createOffer();
      if(generation!==this.generation || this.peers.get(remoteId)!==pc)return null;
      await pc.setLocalDescription(offer);
      if(generation!==this.generation || this.peers.get(remoteId)!==pc)return null;
      this.#send({ type: 'voice.signal', toMemberId: remoteId, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    }
    return pc;
  }

  async #handleSignal(message) {
    const remoteId = message.fromMemberId;
    const generation=this.generation;
    const pc = await this.#ensurePeer(remoteId);
    if (!pc || generation!==this.generation || this.peers.get(remoteId)!==pc) return;
    if (message.description) {
      await pc.setRemoteDescription(message.description);
      if(generation!==this.generation || this.peers.get(remoteId)!==pc)return;
      if (message.description.type === 'offer') {
        const answer = await pc.createAnswer();
        if(generation!==this.generation || this.peers.get(remoteId)!==pc)return;
        await pc.setLocalDescription(answer);
        if(generation!==this.generation || this.peers.get(remoteId)!==pc)return;
        this.#send({ type: 'voice.signal', toMemberId: remoteId, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }
    }
    if (message.candidate) {
      try { await pc.addIceCandidate(message.candidate); }
      catch (error) { if (pc.remoteDescription) throw error; }
    }
  }

  #removePeer(remoteId) {
    const pc = this.peers.get(remoteId);
    if (pc) {
      this.peers.delete(remoteId);
      try { pc.close(); } catch {}
    }
    this.connectionPaths.delete(remoteId);
    const audio = this.audios.get(remoteId);
    if (audio) {
      this.audios.delete(remoteId);
      audio.srcObject = null;
      audio.remove();
    }
    this.#emit(this.enabled ? 'ready' : 'off');
  }
}
