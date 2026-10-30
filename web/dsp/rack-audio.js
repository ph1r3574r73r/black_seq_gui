// Persistent audio taps so one module can feed another's input.
const rackJacks = new Map();

function registerRackJack(moduleId, port, node) {
  rackJacks.set(`${moduleId}:${port}`, node);
}

function unregisterRackJacks(moduleId) {
  const prefix = `${moduleId}:`;
  [...rackJacks.keys()].forEach((key) => {
    if (key.startsWith(prefix)) rackJacks.delete(key);
  });
}

function connectRackInput(moduleId, port, node, index) {
  const cable = typeof cableInto === "function" ? cableInto(moduleId, port) : null;
  const source = cable && cable.from.module !== 0 ? rackJacks.get(`${cable.from.module}:${cable.from.port}`) : null;
  if (!node._rackIn) node._rackIn = [];
  const previous = node._rackIn[index];
  if (previous === (source || null)) return Boolean(source);
  if (previous) {
    try { previous.disconnect(node, 0, index); } catch (error) { /* already gone */ }
  }
  node._rackIn[index] = null;
  if (!source) return false;
  try {
    source.connect(node, 0, index);
    node._rackIn[index] = source;
    return true;
  } catch (error) {
    return false;
  }
}
