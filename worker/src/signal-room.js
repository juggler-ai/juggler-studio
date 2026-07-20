// SignalRoom — the Durable Object that relays one SDP offer + one answer
// between a host and a guest for a given <id>, then idles. It also pushes the
// rendezvous-owned ICE config to both peers before any SDP is exchanged. It is a
// dumb mailbox: it never parses SDP, it relays frames verbatim (see the protocol
// contract "Signaling messages" / "DO behaviour").
//
// One instance per <id> (worker.js uses idFromName(<id>)). Sockets are accepted
// via the WebSocket Hibernation API (state.acceptWebSocket), so an idle room —
// which is its steady state, a host holding a long-lived signaling socket that
// stays silent between guest offers — is evicted from memory and stops billing
// Durable Object duration until the next frame arrives. Because hibernation
// discards instance memory, NO peer state lives in instance fields: peers are
// recovered from state.getWebSockets(role), the socket's role from
// state.getTags(ws), and a guest's early offer from state.storage so it survives
// an eviction between guest-connect and host-connect.

const OPEN = 1; // WebSocket.readyState OPEN
const RENDEZVOUS_PROTOCOL_VERSION = 2;
const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';
const PENDING_OFFER_KEY = 'pendingOffer';

export class SignalRoom {
  /**
   * @param {DurableObjectState} state
   * @param {unknown} env
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
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

    // Exactly one host per id. A second live host claim is rejected on an
    // ephemeral (non-hibernatable) socket that we close immediately, so it is
    // never tagged 'host' and never counts as the room's host.
    if (role === 'host' && this.openHost()) {
      server.accept();
      safeSend(server, { type: 'error', code: 'host-taken', message: 'this id already has a host' });
      safeClose(server, 1008, 'host-taken');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Hibernatable accept: the room can evict from memory while this socket stays
    // open, and only wakes (and bills) when a frame actually arrives.
    this.state.acceptWebSocket(server, [role]);

    safeSend(server, iceConfigFromEnv(this.env));
    if (role === 'host') {
      // A guest may have sent its offer before the host connected; flush it.
      const pendingOffer = await this.state.storage.get(PENDING_OFFER_KEY);
      if (pendingOffer) {
        safeSendRaw(server, pendingOffer);
        await this.state.storage.delete(PENDING_OFFER_KEY);
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Hibernation delivers frames here instead of an 'message' listener. The
   * socket's role is recovered from its tag, and the peer from getWebSockets —
   * neither survives eviction as an instance field.
   * @param {WebSocket} ws
   * @param {string | ArrayBuffer} message
   */
  async webSocketMessage(ws, message) {
    const role = this.state.getTags(ws)[0];
    const raw = typeof message === 'string' ? message : null;
    if (raw === null) return; // never relay binary on the signaling channel
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return; // malformed JSON: drop silently
    }
    if (!frame || typeof frame.type !== 'string') return;

    if (role === 'guest' && frame.type === 'offer') {
      const host = this.openHost();
      if (host) {
        safeSendRaw(host, raw);
      } else {
        await this.state.storage.put(PENDING_OFFER_KEY, raw); // deliver on host connect
      }
      return;
    }

    if (role === 'host' && frame.type === 'answer') {
      const guest = this.openGuest();
      if (guest) {
        safeSendRaw(guest, raw);
      }
      return;
    }

    // Only the protocol frames above are accepted. The DO owns ICE config, so
    // clients may not override it; there is no candidate relay (non-trickle ICE).
  }

  /**
   * @param {WebSocket} ws
   * @param {number} code
   * @param {string} reason
   * @param {boolean} wasClean
   */
  async webSocketClose(ws, code, reason, wasClean) {
    await this.onDisconnect(ws);
  }

  /**
   * @param {WebSocket} ws
   * @param {unknown} error
   */
  async webSocketError(ws, error) {
    await this.onDisconnect(ws);
  }

  /**
   * Host death kills any connected guest (its half-open handshake can never
   * complete, and the id becomes claimable again). Guest death is deliberately
   * NOT symmetric: a guest closes its socket after every COMPLETED exchange
   * (bootstrap's exchangeSdp closes as soon as the answer arrives), so kicking
   * the host here would bounce the host's long-lived signaling socket through
   * its reconnect backoff on every guest page load. The host socket is built
   * to serve repeated offers (a guest reload just sends a fresh one), so leave
   * it alone and only drop any offer the guest left buffered.
   * @param {WebSocket} ws
   */
  async onDisconnect(ws) {
    const role = this.state.getTags(ws)[0];
    // Complete the close handshake from our side: workerd does not auto-echo a
    // client-initiated close, and a never-acknowledged close leaves the
    // client's socket stuck in CLOSING — Firefox then finalizes it at the next
    // page-load transition (the bootstrap's document.open() injection) with a
    // noisy "connection ... was interrupted while the page was loading"
    // console warning. No-op if the socket is already fully closed.
    safeClose(ws, 1000, 'bye');
    if (role === 'host') {
      await this.state.storage.delete(PENDING_OFFER_KEY);
      // The host is gone; any guest's half-open handshake can never complete.
      for (const guest of this.state.getWebSockets('guest')) {
        safeClose(guest, 1001, 'host-gone');
      }
    } else if (role === 'guest') {
      // Any offer this guest left buffered is stale — if a host connected
      // later it would build an answer (and a peer connection) for nobody.
      await this.state.storage.delete(PENDING_OFFER_KEY);
    }
  }

  /** @returns {WebSocket | undefined} the live host socket, if any */
  openHost() {
    return this.state.getWebSockets('host').find((ws) => ws.readyState === OPEN);
  }

  /** @returns {WebSocket | undefined} the live guest socket, if any */
  openGuest() {
    return this.state.getWebSockets('guest').find((ws) => ws.readyState === OPEN);
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
