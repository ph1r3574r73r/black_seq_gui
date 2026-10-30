// Green, red, then orange on the panel. The firmware registers the orange
// bank first, then green, then red, which is also how its LEDs are colored.
function plaitsEngine(model) {
  const index = Math.min(23, Math.floor(Number(model || 0) * 24));
  const row = index % 8;
  const bank = Math.floor(index / 8);
  return [8, 16, 0][bank] + row;
}

const PLAITS_HEADROOM = 0.2;
const plaitsVoices = new Map();
const plaitsLast = new Map();
let plaitsWasm = null;
let plaitsModulePromise = null;
let plaitsFailed = false;

function plaitsEnsureWasm() {
  if (plaitsFailed) return null;
  if (!plaitsModulePromise) {
    const ctx = audio();
    plaitsModulePromise = Promise.all([
      ctx.audioWorklet.addModule("/dsp/plaits-worklet.js"),
      fetch("/dsp/plaits.wasm").then((response) => {
        if (!response.ok) throw new Error("Plaits voice failed to load");
        return response.arrayBuffer();
      }),
    ]).then(([, bytes]) => {
      plaitsWasm = bytes;
    }).catch((error) => {
      plaitsFailed = true;
      plaitsModulePromise = null;
      console.error(error);
    });
  }
  return plaitsModulePromise;
}

function plaitsRelease(id) {
  const voice = plaitsVoices.get(id);
  if (!voice) return;
  voice.node.disconnect();
  voice.out.disconnect();
  voice.aux.disconnect();
  unregisterRackJacks(id);
  plaitsVoices.delete(id);
  plaitsLast.delete(id);
}

function plaitsSync() {
  const live = new Set((state.rack?.modules || []).filter((module) => module.type === "plaits").map((module) => module.id));
  [...plaitsVoices.keys()].forEach((id) => {
    if (!live.has(id)) plaitsRelease(id);
  });
}

function plaitsEnsure(module) {
  const existing = plaitsVoices.get(module.id);
  if (existing) return existing;
  const ctx = audio();
  const node = new AudioWorkletNode(ctx, "plaits", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const splitter = ctx.createChannelSplitter(2);
  const rawOut = ctx.createGain();
  const rawAux = ctx.createGain();
  const out = ctx.createGain();
  const aux = ctx.createGain();
  rawOut.gain.value = 1;
  rawAux.gain.value = 1;
  out.gain.value = 0;
  aux.gain.value = 0;
  node.connect(splitter);
  splitter.connect(rawOut, 0);
  splitter.connect(rawAux, 1);
  rawOut.connect(out);
  rawAux.connect(aux);
  const dest = typeof playbackOut === "function" ? playbackOut() : ctx.destination;
  out.connect(dest);
  aux.connect(dest);
  registerRackJack(module.id, "out", rawOut);
  registerRackJack(module.id, "aux", rawAux);
  node.port.postMessage({ wasm: plaitsWasm.slice(0) });
  const voice = { node, out, aux };
  plaitsVoices.set(module.id, voice);
  return voice;
}

function plaitsParams(module, signals) {
  const params = new Float32Array(32);
  const read = (port) => {
    const value = inputVoltage(module.id, port, signals);
    return value == null ? 0 : value;
  };
  const patched = (port) => (cableInto(module.id, port) ? 1 : 0);
  const channel = sourceChannel(module);
  const gate = patched("trig") && read("trig") > 1 ? 1 : 0;
  params[0] = plaitsEngine(module.params.model);
  params[1] = Number(module.params.freq ?? 0.5);
  params[2] = Number(module.params.harmonics ?? 0.5);
  params[3] = Number(module.params.timbre ?? 0.5);
  params[4] = Number(module.params.morph ?? 0.5);
  params[5] = Number(module.params.timbre_att ?? 0.5);
  params[6] = Number(module.params.fm_att ?? 0.5);
  params[7] = Number(module.params.harm_att ?? 0.5);
  params[8] = read("v_oct");
  params[9] = read("fm");
  params[10] = read("harmonics_cv");
  params[11] = read("timbre_cv");
  params[12] = read("morph_cv");
  params[13] = read("level_cv");
  params[14] = gate;
  params[15] = gate && signals[`attack${channel}`] ? 1 : 0;
  params[16] = patched("fm");
  params[17] = patched("timbre_cv");
  params[18] = patched("morph_cv");
  params[19] = patched("harmonics_cv");
  params[20] = patched("level_cv");
  params[21] = patched("trig");
  params[22] = read("model_cv");
  params[23] = patched("model_cv");
  return params;
}

function plaitsPlay(module, signals, when) {
  if (plaitsFailed) return false;
  const pending = plaitsEnsureWasm();
  if (!pending) return false;
  const generation = typeof audioGeneration === "number" ? audioGeneration : 0;
  pending.then(() => {
    if (!plaitsWasm || !state.rack) return;
    if (typeof audioGeneration === "number" && generation !== audioGeneration && !state.playing) return;
    plaitsSync();
    if (!state.rack.modules.some((item) => item.id === module.id && item.type === "plaits")) return;
    const voice = plaitsEnsure(module);
    openParkedAttenuverters(module, [["timbre_cv", "timbre_att"], ["fm", "fm_att"], ["morph_cv", "harm_att"]]);
    const heard = typeof heardNow === "function" ? heardNow(signals) : signals;
    plaitsLast.set(module.id, heard);
    voice.node.port.postMessage({ params: plaitsParams(module, heard) });
    voice.out.gain.value = 0;
    voice.aux.gain.value = 0;
  });
  return true;
}

function plaitsRefresh(module) {
  if (!module || module.type !== "plaits" || !plaitsWasm) return;
  const signals = plaitsLast.get(module.id);
  const voice = plaitsVoices.get(module.id);
  if (!signals || !voice) return;
  voice.node.port.postMessage({ params: plaitsParams(module, signals) });
}

function plaitsStop() {
  if (!plaitsVoices.size) return;
  const now = audio().currentTime;
  plaitsVoices.forEach((voice) => {
    const params = new Float32Array(32);
    params[1] = 0.5;
    params[2] = 0.5;
    params[3] = 0.5;
    params[4] = 0.5;
    params[5] = 0.5;
    params[6] = 0.5;
    params[7] = 0.5;
    voice.node.port.postMessage({ params });
    voice.out.gain.setValueAtTime(0, now);
    voice.aux.gain.setValueAtTime(0, now);
  });
}
