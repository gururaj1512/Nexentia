const { EventEmitter } = require('events');

const proxyEvents = new EventEmitter();
proxyEvents.setMaxListeners(50);

// SSE client registry
const clients = new Set();

function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch (_) {}
  }
}

proxyEvents.on('proxy:step', broadcast);

module.exports = { proxyEvents, addClient };
