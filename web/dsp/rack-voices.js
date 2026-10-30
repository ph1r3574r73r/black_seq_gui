// Running voices for palette modules that are not Mutable Instruments wasm engines.
const RACK_VOICE_KINDS = {
  noise: "noise",
  dual_vca: "vca",
  ar: "env",
  adsr: "env",
  lfo: "lfo",
  mult: "mult",
  delay: "delay",
  reverb: "reverb",
  erica_mixer: "mixer",
  erica_output: "output",
};

const rackVoices = new Map();
let rackVoiceLoad = null;
let rackVoiceFailed = false;
const OUTPUT_MONITOR = 0.25;

function rackPanelJacks(type) {
  const seen = new Set();
  const inputs = [];
  const outputs = [];
  (RACK_CATALOG[type]?.hits || []).forEach((hit) => {
    if (hit.kind !== "in" && hit.kind !== "out") return;
    const key = `${hit.kind}:${hit.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    (hit.kind === "in" ? inputs : outputs).push(hit.id);
  });
  return { inputs, outputs };
}

function rackVoiceEnsure() {
  if (rackVoiceFailed || typeof audio !== "function") return null;
  if (!rackVoiceLoad) {
    const ctx = audio();
    rackVoiceLoad = ctx.audioWorklet.addModule("/dsp/rack-voice-worklet.js").catch((error) => {
      rackVoiceFailed = true;
      rackVoiceLoad = null;
      console.error(error);
    });
  }
  return rackVoiceLoad;
}

function rackVoiceParams(module, signals) {
  const params = new Float32Array(64);
  (RACK_CATALOG[module.type]?.params || []).forEach((name, index) => {
    const value = Number(module.params[name]);
    params[index] = Number.isFinite(value) ? value : 0.5;
  });
  const { inputs } = rackPanelJacks(module.type);
  inputs.forEach((port, index) => {
    const cable = cableInto(module.id, port);
    const audioSource = cable && cable.from.module !== 0 && rackJacks.has(`${cable.from.module}:${cable.from.port}`);
    params[40 + index] = cable ? 1 : 0;
    params[56 + index] = audioSource ? 1 : 0;
    if (cable && !audioSource) params[24 + index] = (inputVoltage(module.id, port, signals) || 0) / 5;
  });
  if (module.type === "ar") params[63] = 1;
  else if (module.type === "adsr") params[63] = 2;
  return params;
}

function rackVoiceNode(module) {
  let voice = rackVoices.get(module.id);
  if (voice && voice.type === module.type) return voice;
  if (voice) rackVoiceRelease(module.id);
  const ctx = audio();
  const { inputs, outputs } = rackPanelJacks(module.type);
  const node = new AudioWorkletNode(ctx, "rack-voice", {
    numberOfInputs: Math.max(1, inputs.length),
    numberOfOutputs: 1,
    outputChannelCount: [Math.max(1, outputs.length)],
  });
  const splitter = ctx.createChannelSplitter(Math.max(1, outputs.length));
  const monitor = ctx.createGain();
  monitor.gain.value = 0;
  node.connect(splitter);
  outputs.forEach((port, index) => {
    const raw = ctx.createGain();
    raw.gain.value = 1;
    splitter.connect(raw, index);
    registerRackJack(module.id, port, raw);
    raw.connect(monitor);
  });
  monitor.connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
  node.port.onmessage = (event) => {
    const levels = event.data && event.data.levels;
    if (!levels || !state.rack) return;
    if (!state.rack.levels) state.rack.levels = {};
    outputs.forEach((port, index) => {
      state.rack.levels[`${module.id}:${port}`] = (levels[index] || 0) * 5;
    });
  };
  node.port.postMessage({
    kind: RACK_VOICE_KINDS[module.type],
    inputs: inputs.length,
    outputs: outputs.length,
  });
  voice = { type: module.type, node, monitor, inputs, speak: module.type === "erica_output" };
  rackVoices.set(module.id, voice);
  return voice;
}

function rackVoicePush(module, signals) {
  const voice = rackVoices.get(module.id);
  if (!voice) return;
  voice.inputs.forEach((port, index) => connectRackInput(module.id, port, voice.node, index));
  voice.node.port.postMessage({ params: rackVoiceParams(module, signals) });
  // Keep the rack output open; Stop mutes via playbackBus so tails die immediately.
  if (voice.speak) voice.monitor.gain.value = OUTPUT_MONITOR;
}

function rackVoiceStop() {
  const now = typeof audio === "function" ? audio().currentTime : 0;
  rackVoices.forEach((voice) => {
    if (!voice.monitor) return;
    try {
      voice.monitor.gain.cancelScheduledValues(now);
      voice.monitor.gain.setValueAtTime(0, now);
    } catch (error) {
      voice.monitor.gain.value = 0;
    }
  });
}

function rackVoicePlay(module, signals) {
  if (!RACK_VOICE_KINDS[module.type]) return false;
  const pending = rackVoiceEnsure();
  if (!pending) return false;
  const generation = typeof audioGeneration === "number" ? audioGeneration : 0;
  pending.then(() => {
    if (rackVoiceFailed || !state.rack) return;
    if (typeof audioGeneration === "number" && generation !== audioGeneration && !state.playing) return;
    if (!state.rack.modules.some((item) => item.id === module.id && item.type === module.type)) return;
    rackVoiceNode(module);
    rackVoicePush(module, typeof heardNow === "function" ? heardNow(signals) : signals);
  });
  return true;
}

function rackVoiceRelease(id) {
  const voice = rackVoices.get(id);
  if (!voice) return;
  try { voice.node.disconnect(); } catch (error) { /* already gone */ }
  rackVoices.delete(id);
}

function rackVoiceRefresh(module, signals) {
  if (!module || !RACK_VOICE_KINDS[module.type]) return;
  if (!rackVoices.has(module.id)) {
    rackVoicePlay(module, signals);
    return;
  }
  rackVoicePush(module, typeof heardNow === "function" ? heardNow(signals) : signals);
}

function rackVoicesClear() {
  [...rackVoices.keys()].forEach(rackVoiceRelease);
}
