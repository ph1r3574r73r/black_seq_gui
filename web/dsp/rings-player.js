function ringsChoice(value, allowed, fallback) {
  const number = Number(value);
  return allowed.includes(number) ? number : fallback;
}

const RINGS_HEADROOM = 0.35;
const ringsVoices = new Map();
const ringsLast = new Map();
let ringsWasm = null;
let ringsModulePromise = null;
let ringsFailed = false;

function ringsEnsureWasm() {
  if (ringsFailed) return null;
  if (!ringsModulePromise) {
    const ctx = audio();
    ringsModulePromise = Promise.all([
      ctx.audioWorklet.addModule("/dsp/rings-worklet.js"),
      fetch("/dsp/rings.wasm").then((response) => {
        if (!response.ok) throw new Error("Rings voice failed to load");
        return response.arrayBuffer();
      }),
    ]).then(([, bytes]) => {
      ringsWasm = bytes;
    }).catch((error) => {
      ringsFailed = true;
      ringsModulePromise = null;
      console.error(error);
    });
  }
  return ringsModulePromise;
}

function ringsRelease(id) {
  const voice = ringsVoices.get(id);
  if (!voice) return;
  voice.node.disconnect();
  voice.out.disconnect();
  voice.aux.disconnect();
  unregisterRackJacks(id);
  ringsVoices.delete(id);
  ringsLast.delete(id);
}

function ringsSync() {
  const live = new Set((state.rack?.modules || []).filter((module) => module.type === "rings").map((module) => module.id));
  [...ringsVoices.keys()].forEach((id) => {
    if (!live.has(id)) ringsRelease(id);
  });
}

function ringsEnsure(module) {
  const existing = ringsVoices.get(module.id);
  if (existing) return existing;
  const ctx = audio();
  const node = new AudioWorkletNode(ctx, "rings", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 1,
    channelCountMode: "explicit",
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
  node.port.postMessage({ wasm: ringsWasm.slice(0) });
  node.port.onmessage = (event) => {
    if (event.data?.error) console.error(event.data.error);
  };
  const voice = { node, out, aux };
  ringsVoices.set(module.id, voice);
  return voice;
}

function ringsParams(module, signals) {
  const params = new Float32Array(32);
  const read = (port) => {
    const value = inputVoltage(module.id, port, signals);
    return value == null ? 0 : value;
  };
  const patched = (port) => (cableInto(module.id, port) ? 1 : 0);
  params[0] = ringsChoice(module.params.model, [0, 1, 2, 3, 4, 5], 0);
  params[1] = ringsChoice(module.params.polyphony, [1, 2, 3, 4], 1);
  params[2] = Number(module.params.freq ?? 0.5);
  params[3] = Number(module.params.structure ?? 0.5);
  params[4] = Number(module.params.brightness ?? 0.5);
  params[5] = Number(module.params.damping ?? 0.5);
  params[6] = Number(module.params.position ?? 0.5);
  params[7] = Number(module.params.freq_att ?? 0.5);
  params[8] = Number(module.params.structure_att ?? 0.5);
  params[9] = Number(module.params.brightness_att ?? 0.5);
  params[10] = Number(module.params.damping_att ?? 0.5);
  params[11] = Number(module.params.position_att ?? 0.5);
  params[12] = read("v_oct");
  params[13] = read("freq_cv");
  params[14] = read("structure_cv");
  params[15] = read("brightness_cv");
  params[16] = read("damping_cv");
  params[17] = read("position_cv");
  params[18] = patched("trig") && read("trig") > 1 ? 1 : 0;
  params[19] = patched("v_oct");
  params[20] = patched("freq_cv");
  params[21] = patched("structure_cv");
  params[22] = patched("brightness_cv");
  params[23] = patched("damping_cv");
  params[24] = patched("position_cv");
  params[25] = patched("trig");
  params[26] = patched("in");
  return params;
}

function ringsPlay(module, signals, when) {
  if (ringsFailed) return false;
  const pending = ringsEnsureWasm();
  if (!pending) return false;
  const generation = typeof audioGeneration === "number" ? audioGeneration : 0;
  pending.then(() => {
    if (!ringsWasm || !state.rack) return;
    if (typeof audioGeneration === "number" && generation !== audioGeneration && !state.playing) return;
    ringsSync();
    if (!state.rack.modules.some((item) => item.id === module.id && item.type === "rings")) return;
    const voice = ringsEnsure(module);
    connectRackInput(module.id, "in", voice.node, 0);
    const heard = typeof heardNow === "function" ? heardNow(signals) : signals;
    ringsLast.set(module.id, heard);
    voice.node.port.postMessage({ params: ringsParams(module, heard) });
    openParkedAttenuverters(module, [
      ["freq_cv", "freq_att"],
      ["structure_cv", "structure_att"],
      ["brightness_cv", "brightness_att"],
      ["damping_cv", "damping_att"],
      ["position_cv", "position_att"],
    ]);
    voice.out.gain.value = 0;
    voice.aux.gain.value = 0;
  });
  return true;
}

function ringsRefresh(module) {
  if (!module || module.type !== "rings" || !ringsWasm) return;
  const signals = ringsLast.get(module.id);
  const voice = ringsVoices.get(module.id);
  if (!signals || !voice) return;
  connectRackInput(module.id, "in", voice.node, 0);
  voice.node.port.postMessage({ params: ringsParams(module, signals) });
}

function ringsStop() {
  if (!ringsVoices.size) return;
  const now = audio().currentTime;
  ringsVoices.forEach((voice) => {
    const params = new Float32Array(32);
    params[1] = 1;
    params[2] = 0.5;
    voice.node.port.postMessage({ params });
    voice.out.gain.setValueAtTime(0, now);
    voice.aux.gain.setValueAtTime(0, now);
  });
}
