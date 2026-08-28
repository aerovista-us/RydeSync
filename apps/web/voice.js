function memberIdOf(peer) {
  return typeof peer === 'string' ? peer : peer?.id;
}

export function shouldInitiateOffer(selfMemberId, remoteMemberId) {
  return Boolean(selfMemberId && remoteMemberId && String(selfMemberId).localeCompare(String(remoteMemberId)) < 0);
}

export class VoiceClient {
  constructor({ iceServers = [], send, onState = () => {}, onFloor = () => {} } = {}) {
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];
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
  }

  #emit(state, detail = null) {
    this.onState({ state, detail, peerCount: this.peers.size, floorMemberId: this.floorMemberId });
  }

  #send(value) {
    try { return this.send?.(value) !== false; }
    catch { return false; }
  }

  async enable(selfMemberId) {
    if (this.enabled && this.stream) {
      this.selfMemberId = selfMemberId || this.selfMemberId;
      this.rejoin();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is not supported by this browser');
    this.#emit('requesting');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    for (const track of this.stream.getAudioTracks()) track.enabled = false;
    this.selfMemberId = selfMemberId;
    this.enabled = true;
    this.joined = false;
    this.#send({ type: 'voice.join' });
    this.#emit('connecting');
  }

  rejoin() {
    if (!this.enabled) return;
    this.joined = false;
    this.#muteLocal();
    this.#send({ type: 'voice.join' });
    this.#emit('connecting');
  }

  realtimeDisconnected() {
    this.joined = false;
    this.floorMemberId = null;
    this.pressActive = false;
    this.#muteLocal();
    for (const id of [...this.peers.keys()]) this.#removePeer(id);
    if (this.enabled) this.#emit('reconnecting');
  }

  disable({ notify = true } = {}) {
    this.pressActive = false;
    this.#muteLocal();
    if (notify && this.joined) this.#send({ type: 'voice.leave' });
    for (const id of [...this.peers.keys()]) this.#removePeer(id);
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.enabled = false;
    this.joined = false;
    this.floorMemberId = null;
    this.#emit('off');
    this.onFloor({ memberId: null, active: false });
  }

  pressStart() {
    if (!this.enabled || !this.joined || this.pressActive) return false;
    this.pressActive = true;
    this.#send({ type: 'voice.talk.start' });
    this.#emit('requesting_floor');
    return true;
  }

  pressStop() {
    if (!this.pressActive && this.floorMemberId !== this.selfMemberId) return false;
    this.pressActive = false;
    this.#muteLocal();
    if (this.joined) this.#send({ type: 'voice.talk.stop' });
    this.#emit(this.enabled ? 'ready' : 'off');
    return true;
  }

  async handle(message) {
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
    if (!this.stream) return;
    const maySend = this.joined && this.floorMemberId === this.selfMemberId && this.pressActive;
    for (const track of this.stream.getAudioTracks()) track.enabled = maySend;
  }

  async #ensurePeer(remoteId) {
    if (!remoteId || remoteId === this.selfMemberId || !this.stream) return null;
    if (this.peers.has(remoteId)) return this.peers.get(remoteId);

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(remoteId, pc);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.#send({ type: 'voice.signal', toMemberId: remoteId, candidate: candidate.toJSON?.() || candidate });
    };
    pc.ontrack = ({ streams }) => {
      const stream = streams?.[0];
      if (!stream) return;
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
      audio.srcObject = stream;
      audio.play().catch(() => this.#emit('gesture_required', remoteId));
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.#removePeer(remoteId);
      else if (pc.connectionState === 'connected') this.#emit('ready');
    };

    if (shouldInitiateOffer(this.selfMemberId, remoteId)) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.#send({ type: 'voice.signal', toMemberId: remoteId, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    }
    return pc;
  }

  async #handleSignal(message) {
    const remoteId = message.fromMemberId;
    const pc = await this.#ensurePeer(remoteId);
    if (!pc) return;
    if (message.description) {
      await pc.setRemoteDescription(message.description);
      if (message.description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
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
    const audio = this.audios.get(remoteId);
    if (audio) {
      this.audios.delete(remoteId);
      audio.srcObject = null;
      audio.remove();
    }
    this.#emit(this.enabled ? 'ready' : 'off');
  }
}
