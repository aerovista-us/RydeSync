import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, body]);
}

function closePayload(code, reason = '') {
  const reasonBuffer = Buffer.from(String(reason).slice(0, 120), 'utf8');
  const payload = Buffer.allocUnsafe(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  return payload;
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, head = Buffer.alloc(0), { maxMessageBytes = 32_768 } = {}) {
    super();
    this.socket = socket;
    this.maxMessageBytes = maxMessageBytes;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.closeSent = false;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('end', () => this.#finish());
    socket.on('close', () => this.#finish());
    socket.on('error', (error) => {
      if (!this.closed && this.listenerCount('error') > 0) this.emit('error', error);
      this.#finish();
    });

    if (head.length) this.#onData(head);
  }

  sendJson(value) {
    if (this.closed || !this.socket.writable) return false;
    const payload = Buffer.from(JSON.stringify(value), 'utf8');
    if (payload.length > this.maxMessageBytes) throw new Error('Outbound WebSocket message is too large');
    this.socket.write(frame(0x1, payload));
    return true;
  }

  ping(payload = Buffer.alloc(0)) {
    if (this.closed || !this.socket.writable) return false;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (body.length > 125) throw new Error('WebSocket ping payload is too large');
    this.socket.write(frame(0x9, body));
    return true;
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    if (!this.closeSent && this.socket.writable) {
      this.closeSent = true;
      this.socket.write(frame(0x8, closePayload(code, reason)));
    }
    this.socket.end();
  }

  terminate() {
    if (this.closed) return;
    this.socket.destroy();
  }

  #finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
    this.removeAllListeners('message');
  }

  #protocolError(reason) {
    this.close(1002, reason);
  }

  #onData(chunk) {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;

    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const rsv = first & 0x70;
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (rsv) return this.#protocolError('RSV bits are not supported');
      if (!fin) return this.#protocolError('Fragmented frames are not supported');
      if (!masked) return this.#protocolError('Client frames must be masked');

      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const longLength = this.buffer.readBigUInt64BE(2);
        if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) return this.close(1009, 'Message too large');
        length = Number(longLength);
        offset = 10;
      }

      const isControl = opcode >= 0x8;
      if (isControl && length > 125) return this.#protocolError('Control frame too large');
      if (!isControl && length > this.maxMessageBytes) return this.close(1009, 'Message too large');

      const total = offset + 4 + length;
      if (this.buffer.length < total) return;

      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, total));
      this.buffer = this.buffer.subarray(total);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];

      if (opcode === 0x1) {
        let text;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
        } catch {
          return this.close(1007, 'Invalid UTF-8');
        }
        this.emit('message', text);
      } else if (opcode === 0x8) {
        if (!this.closeSent && this.socket.writable) {
          this.closeSent = true;
          this.socket.write(frame(0x8, payload.length ? payload : closePayload(1000)));
        }
        this.socket.end();
        return;
      } else if (opcode === 0x9) {
        if (this.socket.writable) this.socket.write(frame(0xA, payload));
      } else if (opcode === 0xA) {
        this.emit('pong', payload);
      } else {
        return this.#protocolError('Unsupported opcode');
      }
    }
  }
}

function rejectUpgrade(socket, status, message) {
  if (!socket.writable) return socket.destroy();
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
    body
  );
  socket.destroySoon?.();
  if (!socket.destroySoon) socket.end();
}

export function acceptWebSocket(req, socket, head, options = {}) {
  if (req.method !== 'GET') {
    rejectUpgrade(socket, '405 Method Not Allowed', 'WebSocket upgrade requires GET');
    return null;
  }
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const connection = String(req.headers.connection || '').toLowerCase();
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (upgrade !== 'websocket' || !connection.split(',').map((v) => v.trim()).includes('upgrade')) {
    rejectUpgrade(socket, '400 Bad Request', 'Invalid WebSocket upgrade headers');
    return null;
  }
  if (version !== '13' || typeof key !== 'string' || !key.trim()) {
    rejectUpgrade(socket, '426 Upgrade Required', 'WebSocket version 13 is required');
    return null;
  }

  const accept = crypto.createHash('sha1').update(`${key.trim()}${WS_GUID}`).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return new WebSocketConnection(socket, head, options);
}
