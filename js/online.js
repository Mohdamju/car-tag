import { CONFIG } from './config.js';
import { GameState, fillSlots } from './game.js';

// Online play over WebRTC data channels (PeerJS). One player hosts and runs the
// authoritative simulation; guests send their controls and render the host's
// snapshots. Signalling (room-code lookup) uses the free PeerJS cloud server
// unless ?peerhost=... points at a self-hosted `peerjs-server`.
//
// Messages (JSON):
//   guest -> host : hello{name}  in{c:[throttle,brake,steer,boost,drift]}  ping{ts}
//   host -> guest : welcome{slot} reject{reason} lobby{players} start{names}
//                   snap{...}  ev{ev:{e,...}}  pong{ts}  bye{reason}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O to avoid confusion with 1 / 0
const CODE_LENGTH = 4;
const CONNECT_TIMEOUT = 12000;

export function onlineSupported() {
  return typeof window.Peer === 'function' && typeof window.RTCPeerConnection === 'function';
}

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function cleanName(name, fallback) {
  const n = String(name || '')
    .replace(/[^\p{L}\p{N} _.\-!?]/gu, '')
    .trim()
    .slice(0, 12);
  return n || fallback;
}

/** PeerJS options; a self-hosted signalling server can be selected with URL params. */
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 0 };
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = Number(q.get('peerport') || 443);
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') !== '0';
  }
  return opts;
}

export class OnlineSession {
  /**
   * @param {import('./game.js').Game} game
   * @param {{onLobby: Function, onStatus: Function, onClosed: Function}} ui
   */
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.peer = null;
    this.isHost = false;
    this.code = '';
    this.name = '';
    this.slot = -1;
    this.players = []; // host: [{slot, name, conn}]  guest: [{slot, name}]
    this.hostConn = null;
    this.botCount = 4; // host's setting; guests mirror the host's effective value
    this.closed = false;
    this._snapAcc = 0;
    this._lastInput = '';
    this._inputTimer = null;
  }

  // ----- Host ---------------------------------------------------------------

  /** Create a room. Resolves with the room code. */
  host(name) {
    this.isHost = true;
    this.name = cleanName(name, 'Host');
    this.slot = 0;
    this.players = [{ slot: 0, name: this.name, conn: null }];
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryOpen = () => {
        attempts++;
        this.code = randomCode();
        const peer = new window.Peer(CONFIG.NET_ROOM_PREFIX + this.code, peerOptions());
        this.peer = peer;
        let opened = false;
        peer.on('open', () => {
          opened = true;
          resolve(this.code);
          this._emitLobby();
        });
        peer.on('connection', (conn) => this._onGuestConnection(conn));
        peer.on('error', (err) => {
          if (!opened && err.type === 'unavailable-id' && attempts < 5) {
            peer.destroy();
            tryOpen();
          } else if (!opened) {
            reject(new Error(describePeerError(err)));
          } else if (err.type !== 'peer-unavailable') {
            this.ui.onStatus(describePeerError(err));
          }
        });
        peer.on('disconnected', () => {
          // Lost the signalling server; existing data channels keep working. Try to re-register.
          if (!this.closed && !peer.destroyed) peer.reconnect();
        });
      };
      tryOpen();
    });
  }

  _onGuestConnection(conn) {
    conn.on('data', (msg) => this._onHostMessage(conn, msg));
    conn.on('close', () => this._onGuestLeft(conn));
    conn.on('error', () => this._onGuestLeft(conn));
  }

  _onHostMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (this.players.some((p) => p.conn === conn)) return;
      if (this.game.isRunning) {
        this._send(conn, { t: 'reject', reason: 'A match is already in progress. Try again when it ends.' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      if (this.players.length >= CONFIG.MAX_ONLINE_PLAYERS) {
        this._send(conn, { t: 'reject', reason: 'This room is full (6 players).' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      let slot = 1;
      while (this.players.some((p) => p.slot === slot)) slot++;
      const player = { slot, name: cleanName(msg.name, `Player ${slot + 1}`), conn };
      this.players.push(player);
      this.players.sort((a, b) => a.slot - b.slot);
      this._send(conn, { t: 'welcome', slot, code: this.code });
      this._emitLobby();
      return;
    }
    const player = this.players.find((p) => p.conn === conn);
    if (!player) return;
    if (msg.t === 'in') this.game.setRemoteControls(player.slot, msg.c);
    else if (msg.t === 'ping') this._send(conn, { t: 'pong', ts: msg.ts });
  }

  _onGuestLeft(conn) {
    const idx = this.players.findIndex((p) => p.conn === conn);
    if (idx < 0) return;
    const [player] = this.players.splice(idx, 1);
    if (this.game.isRunning || this.game.state === GameState.ENDED) {
      this.game.convertToBot(player.slot);
      this.game.hud.pushFeed(`${player.name} left - a bot took over`, '#9fb0d6');
    }
    this._emitLobby();
  }

  /** Bots that will actually join: the host's setting, limited by free seats (min 2 cars). */
  get effectiveBots() {
    const free = CONFIG.TOTAL_CARS - this.players.length;
    return Math.min(free, Math.max(this.botCount, 2 - this.players.length));
  }

  setBotCount(n) {
    this.botCount = n;
    this._emitLobby();
  }

  /** Host: start (or restart) a match for everyone in the room. */
  startMatch() {
    if (!this.isHost) return;
    const humans = [];
    for (let i = 0; i < CONFIG.TOTAL_CARS; i++) {
      const p = this.players.find((pl) => pl.slot === i);
      if (!p) humans.push(null);
      else if (i === 0) humans.push({ kind: 'local', name: p.name, device: 'kb-all' });
      else humans.push({ kind: 'remote', name: p.name });
    }
    const slots = fillSlots(humans, this.effectiveBots);
    const names = slots.map((s) => (s.kind === 'local' || s.kind === 'remote' ? s.name : null));
    const kinds = slots.map((s) => (s.kind === 'bot' ? 'b' : s.kind === 'empty' ? 'e' : 'h'));
    this._broadcast({ t: 'start', names, kinds });
    this.game.session = this;
    this.game.startMatch({ mode: 'host', slots });
    this._snapAcc = 1; // send the first snapshot immediately
  }

  /** Called by Game.update every frame while hosting. */
  hostTick(dt) {
    this._snapAcc += dt;
    if (this._snapAcc < 1 / CONFIG.NET_SNAPSHOT_HZ) return;
    this._snapAcc = 0;
    if (this.game.state === GameState.MENU) return;
    if (this.players.length > 1) this._broadcast(this.game.makeSnapshot());
  }

  sendEvent(ev) {
    if (this.isHost) this._broadcast({ t: 'ev', ev }); // nested so event fields never clash with `t`
  }

  _emitLobby() {
    const list = this.players.map((p) => ({ slot: p.slot, name: p.name }));
    if (this.isHost) this._broadcast({ t: 'lobby', players: list, bots: this.effectiveBots });
    this.ui.onLobby(list, this);
  }

  // ----- Guest --------------------------------------------------------------

  /** Join a room by code. Resolves once the host has accepted us. */
  join(code, name) {
    this.isHost = false;
    this.code = String(code || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, CODE_LENGTH);
    this.name = cleanName(name, 'Guest');
    return new Promise((resolve, reject) => {
      if (this.code.length !== CODE_LENGTH) {
        reject(new Error(`Room codes are ${CODE_LENGTH} letters.`));
        return;
      }
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.close(false);
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('Could not reach that room. Check the code and try again.'), CONNECT_TIMEOUT);

      const peer = new window.Peer(undefined, peerOptions());
      this.peer = peer;
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') fail(`No room with code ${this.code}. Check the code with the host.`);
        else if (!settled) fail(describePeerError(err));
        else this.ui.onStatus(describePeerError(err));
      });
      peer.on('open', () => {
        const conn = peer.connect(CONFIG.NET_ROOM_PREFIX + this.code, { serialization: 'json', reliable: true });
        this.hostConn = conn;
        conn.on('open', () => this._send(conn, { t: 'hello', name: this.name }));
        conn.on('data', (msg) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 'welcome') {
            this.slot = msg.slot;
            settled = true;
            clearTimeout(timer);
            this._startInputLoop();
            resolve(this.code);
          } else if (msg.t === 'reject') {
            fail(msg.reason || 'The host refused the connection.');
          } else {
            this._onGuestMessage(msg);
          }
        });
        conn.on('close', () => {
          if (!settled) fail('The host closed the connection.');
          else this._hostGone('The host left the room.');
        });
        conn.on('error', () => {
          if (settled) this._hostGone('Lost connection to the host.');
        });
      });
    });
  }

  _onGuestMessage(msg) {
    switch (msg.t) {
      case 'lobby':
        this.players = Array.isArray(msg.players) ? msg.players : [];
        if (Number.isInteger(msg.bots)) this.botCount = msg.bots;
        this.ui.onLobby(this.players, this);
        break;
      case 'start': {
        const slots = [];
        for (let i = 0; i < CONFIG.TOTAL_CARS; i++) {
          const name = msg.names && msg.names[i];
          const kind = msg.kinds && msg.kinds[i];
          if (i === this.slot) slots.push({ kind: 'local', name: this.name, device: 'kb-all' });
          else if (kind === 'e') slots.push({ kind: 'empty' });
          else if (kind === 'b' || !name) slots.push({ kind: 'bot' });
          else slots.push({ kind: 'remote', name: cleanName(name, `Player ${i + 1}`) });
        }
        this.game.session = this;
        this.game.startMatch({ mode: 'client', slots });
        this.ui.onMatchStart();
        break;
      }
      case 'snap':
        this.game.applySnapshot(msg);
        break;
      case 'ev':
        this.game.applyEvent(msg.ev);
        break;
      case 'pong': {
        const rtt = performance.now() - msg.ts;
        if (rtt >= 0 && rtt < 5000) this.game.net.latency = this.game.net.latency * 0.7 + (rtt / 2000) * 0.3;
        break;
      }
      case 'bye':
        this._hostGone(msg.reason || 'The host closed the room.');
        break;
      default:
        break;
    }
  }

  /** Guests stream their controls to the host (on change, and as a keep-alive). */
  _startInputLoop() {
    const period = 1000 / CONFIG.NET_INPUT_HZ;
    let keepAlive = 0;
    let pingAcc = 0;
    this._inputTimer = setInterval(() => {
      if (!this.hostConn || !this.hostConn.open) return;
      const view = this.game.views[0];
      const c = view && this.game.isRunning ? view.car.controls : null;
      const arr = c ? [c.throttle, c.brake, c.steer, c.boost ? 1 : 0, c.drift ? 1 : 0] : [0, 0, 0, 0, 0];
      const key = arr.join(',');
      keepAlive += period;
      if (key !== this._lastInput || keepAlive >= 250) {
        this._send(this.hostConn, { t: 'in', c: arr });
        this._lastInput = key;
        keepAlive = 0;
      }
      pingAcc += period;
      if (pingAcc >= 1000) {
        pingAcc = 0;
        this._send(this.hostConn, { t: 'ping', ts: performance.now() });
      }
    }, period);
  }

  _hostGone(reason) {
    if (this.closed) return;
    this.close(false);
    this.ui.onClosed(reason);
  }

  // ----- Shared ---------------------------------------------------------------

  _send(conn, msg) {
    try {
      if (conn && conn.open) conn.send(msg);
    } catch (e) {
      /* channel closing; ignore */
    }
  }

  _broadcast(msg) {
    for (const p of this.players) if (p.conn) this._send(p.conn, msg);
  }

  /** Leave / close the room. */
  close(notify = true) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._inputTimer);
    if (this.isHost && notify) this._broadcast({ t: 'bye', reason: 'The host closed the room.' });
    const peer = this.peer;
    // Give the goodbye message a moment to flush before tearing the connection down.
    setTimeout(() => {
      try {
        if (peer && !peer.destroyed) peer.destroy();
      } catch (e) {
        /* ignore */
      }
    }, notify ? 200 : 0);
    if (this.game.session === this) this.game.session = null;
  }
}

function describePeerError(err) {
  switch (err && err.type) {
    case 'browser-incompatible':
      return 'This browser does not support online play (WebRTC).';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking server. Check your internet connection.';
    case 'unavailable-id':
      return 'Could not create a room. Please try again.';
    case 'peer-unavailable':
      return 'That room does not exist.';
    case 'webrtc':
      return 'A direct connection could not be made (strict network or firewall).';
    default:
      return (err && err.message) || 'Online error.';
  }
}
