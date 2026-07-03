// SignalRoom — the Durable Object that relays one SDP offer + one answer
// between a host and a guest for a given <id>, then idles. It also pushes the
// rendezvous-owned ICE config to both peers before any SDP is exchanged. It is a
// dumb mailbox: it never parses SDP, it relays frames verbatim (see the protocol
// contract "Signaling messages" / "DO behaviour").
//
// One instance per <id> (worker.js uses idFromName(<id>)). Plain in-memory
// socket pair — no hibernation; if the instance evicts, the half-open handshake
// is dead anyway and the guest just retries with a fresh id.

const OPEN = 1; // WebSocket.readyState OPEN
const RENDEZVOUS_PROTOCOL_VERSION = 2;
const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';

export class SignalRoom {
  /**
   * @param {DurableObjectState} state
   * @param {unknown} env
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {WebSocket | null} */
    this.host = null;
    /** @type {WebSocket | null} */
    this.guest = null;
    // A guest may send its offer before the host has connected; buffer the raw
    // frame and flush it on host connect.
    /** @type {string | null} */
    this.pendingOffer = null;
  }

  /** @param {Request} request */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }
    const role = new URL(request.url).searchParams.get('role');
    if (role !== 'host' && role !== 'guest') {
      return new Response('role must be host or guest', { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.attach(role, server, iceConfigFromEnv(this.env));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * @param {'host' | 'guest'} role
   * @param {WebSocket} ws
   * @param {object} iceConfig
   */
  attach(role, ws, iceConfig) {
    if (role === 'host') {
      // Exactly one host per id. A second live host claim is rejected.
      if (this.host && this.host.readyState === OPEN) {
        safeSend(ws, { type: 'error', code: 'host-taken', message: 'this id already has a host' });
        safeClose(ws, 1008, 'host-taken');
        return;
      }
      this.host = ws;
    } else {
      this.guest = ws;
    }

    safeSend(ws, iceConfig);
    if (role === 'host' && this.pendingOffer) {
      safeSendRaw(ws, this.pendingOffer);
      this.pendingOffer = null;
    }

    ws.addEventListener('message', (evt) => this.onMessage(role, ws, evt));
    ws.addEventListener('close', () => this.onClose(role, ws));
    ws.addEventListener('error', () => this.onClose(role, ws));
  }

  /**
   * @param {'host' | 'guest'} role
   * @param {WebSocket} ws
   * @param {MessageEvent} evt
   */
  onMessage(role, ws, evt) {
    const raw = typeof evt.data === 'string' ? evt.data : null;
    if (raw === null) return; // never relay binary on the signaling channel
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return; // malformed JSON: drop silently
    }
    if (!frame || typeof frame.type !== 'string') return;

    if (role === 'guest' && frame.type === 'offer') {
      if (this.host && this.host.readyState === OPEN) {
        safeSendRaw(this.host, raw);
      } else {
        this.pendingOffer = raw; // deliver on host connect
      }
      return;
    }

    if (role === 'host' && frame.type === 'answer') {
      if (this.guest && this.guest.readyState === OPEN) {
        safeSendRaw(this.guest, raw);
      }
      return;
    }

    // Only the protocol frames above are accepted. The DO owns ICE config, so
    // clients may not override it; there is no candidate relay (non-trickle ICE).
  }

  /**
   * Either socket closing kills the half-open handshake: close the peer and
   * reset so the id can be claimed again.
   * @param {'host' | 'guest'} role
   * @param {WebSocket} ws
   */
  onClose(role, ws) {
    if (role === 'host' && this.host === ws) {
      this.host = null;
      this.pendingOffer = null;
      if (this.guest) {
        safeClose(this.guest, 1001, 'host-gone');
        this.guest = null;
      }
    } else if (role === 'guest' && this.guest === ws) {
      this.guest = null;
      if (this.host) {
        safeClose(this.host, 1001, 'guest-gone');
        this.host = null;
      }
    }
  }
}

// The rendezvous owns ICE config. juggler.studio is STUN-only by design: a
// public TURN relay would carry all peer traffic at uncapped hosted cost, so
// the DO never mints TURN credentials. Both peers get the same protocol-v2
// config frame before any SDP is exchanged.
function iceConfigFromEnv(env) {
  return {
    type: 'config',
    protocolVersion: RENDEZVOUS_PROTOCOL_VERSION,
    iceServers: [{ urls: env.STUN_URL || DEFAULT_STUN_URL }],
  };
}

/** @param {WebSocket} ws @param {object} obj */
function safeSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* socket already gone */
  }
}

/** @param {WebSocket} ws @param {string} raw */
function safeSendRaw(ws, raw) {
  try {
    ws.send(raw);
  } catch {
    /* socket already gone */
  }
}

/** @param {WebSocket} ws @param {number} code @param {string} reason */
function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    /* already closing/closed */
  }
}
