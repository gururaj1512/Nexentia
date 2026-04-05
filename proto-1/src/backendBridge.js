const http = require('http');
const https = require('https');
const { URL } = require('url');
const { EventEmitter } = require('events');

const backendBridgeEvents = new EventEmitter();
backendBridgeEvents.setMaxListeners(100);

const BRIDGE_PATH = '/internal/events';
const RETRY_DELAY_MS = 2500;

let activeBridge = null;

function emit(type, data = {}) {
  backendBridgeEvents.emit('bridge:event', { type, ts: Date.now(), ...data });
}

function toBridgeUrl(target) {
  const parsed = new URL(target);

  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported backend protocol: ${parsed.protocol}`);
  }

  parsed.pathname = BRIDGE_PATH;
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function scheduleReconnect(state, reason) {
  if (state.stopped || state.retryTimer) return;

  emit('RETRYING', {
    source: state.source,
    reason,
    inMs: RETRY_DELAY_MS,
  });

  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    state.connect();
  }, RETRY_DELAY_MS);
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;

  const payload = dataLines.join('\n');
  try {
    return { parsed: JSON.parse(payload), raw: payload };
  } catch (_) {
    return { parsed: null, raw: payload };
  }
}

function startBackendBridge(target) {
  stopBackendBridge();

  if (!target) {
    emit('DISABLED', { reason: 'No backend target configured' });
    return;
  }

  const bridgeUrl = toBridgeUrl(target);
  const isSecure = bridgeUrl.protocol === 'https:';
  const client = isSecure ? https : http;
  const source = `${bridgeUrl.protocol}//${bridgeUrl.host}`;

  const state = {
    source,
    stopped: false,
    retryTimer: null,
    req: null,
    connect: null,
  };

  state.connect = () => {
    if (state.stopped) return;

    emit('CONNECTING', { source, url: bridgeUrl.toString() });

    const req = client.request({
      hostname: bridgeUrl.hostname,
      port: bridgeUrl.port || (isSecure ? 443 : 80),
      method: 'GET',
      path: bridgeUrl.pathname,
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode !== 200) {
        emit('ERROR', {
          source,
          error: `Bridge status ${res.statusCode}`,
        });
        res.resume();
        scheduleReconnect(state, 'status-not-200');
        return;
      }

      let streamClosed = false;
      let buffer = '';

      emit('CONNECTED', {
        source,
        status: res.statusCode,
      });

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;

        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const message = parseSseBlock(block);
          if (!message) continue;

          if (message.parsed) {
            emit('MESSAGE', {
              source,
              payload: message.parsed,
            });
          } else {
            emit('MESSAGE_RAW', {
              source,
              payload: message.raw,
            });
          }
        }
      });

      const onStreamClosed = (reason) => {
        if (streamClosed || state.stopped) return;
        streamClosed = true;

        emit('DISCONNECTED', { source, reason });
        scheduleReconnect(state, reason);
      };

      res.on('end', () => onStreamClosed('stream-end'));
      res.on('close', () => onStreamClosed('stream-close'));
      res.on('error', (err) => {
        emit('ERROR', { source, error: err.message });
        onStreamClosed('stream-error');
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Bridge connection timed out'));
    });

    req.on('error', (err) => {
      if (state.stopped) return;
      emit('ERROR', { source, error: err.message });
      scheduleReconnect(state, 'request-error');
    });

    req.end();
    state.req = req;
  };

  activeBridge = state;
  state.connect();
}

function stopBackendBridge() {
  if (!activeBridge) return;

  activeBridge.stopped = true;

  if (activeBridge.retryTimer) {
    clearTimeout(activeBridge.retryTimer);
    activeBridge.retryTimer = null;
  }

  if (activeBridge.req) {
    activeBridge.req.destroy();
    activeBridge.req = null;
  }

  emit('STOPPED', { source: activeBridge.source });
  activeBridge = null;
}

module.exports = {
  backendBridgeEvents,
  startBackendBridge,
  stopBackendBridge,
};