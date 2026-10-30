const MI_VOICES = {
  tides: {
    file: "/dsp/tides.wasm",
    init: "tides_init",
    render: "tides_render",
    inputs: ["fm", "trig", "clock"],
    outputs: ["out1", "out2", "out3", "out4"],
    gain: 0.6,
    pairs: [["v_oct", "freq_att"], ["shape_cv", "shape_att"], ["slope_cv", "slope_att"], ["smooth_cv", "smooth_att"], ["shift_cv", "shift_att"], ["fm", "freq_att"]],
  },
  warps: {
    file: "/dsp/warps.wasm",
    init: "warps_init",
    render: "warps_render",
    inputs: ["carrier", "modulator"],
    outputs: ["out", "aux"],
    gain: 0.25,
    pairs: [],
  },
  peaks: {
    file: "/dsp/peaks.wasm",
    init: "peaks_init",
    render: "peaks_render",
    inputs: ["trig_a", "trig_b"],
    outputs: ["out_a", "out_b"],
    gain: 0.3,
    pairs: [],
  },
  marbles: {
    file: "/dsp/marbles.wasm",
    init: "marbles_init",
    render: "marbles_render",
    inputs: ["t_clock", "x_clock"],
    outputs: ["t1", "t2", "t3", "y", "x1", "x2", "x3"],
    gain: 0.2,
    pairs: [],
  },
  clouds: {
    file: "/dsp/clouds.wasm",
    init: "clouds_init",
    render: "clouds_render",
    inputs: ["in_l", "in_r"],
    outputs: ["out_l", "out_r"],
    gain: 0.3,
    pairs: [],
  },
};

const miVoices = new Map();
const miWasm = new Map();
const miLoads = new Map();
const miFailed = new Set();
let miPump = 0;

function miRead(module, port, signals) {
  const value = inputVoltage(module.id, port, signals);
  return value == null ? 0 : value;
}

function miPatched(module, port) {
  return cableInto(module.id, port) ? 1 : 0;
}

function miParams(module, signals, audioIns) {
  const params = new Float32Array(48);
  const p = module.params || {};
  const read = (port) => miRead(module, port, signals);
  const on = (port) => miPatched(module, port);
  const audio = (port) => (audioIns && audioIns[port] ? 1 : 0);
  if (module.type === "tides") {
    params[0] = Number(p.freq ?? 0.5);
    params[1] = Number(p.shape ?? 0.5);
    params[2] = Number(p.slope ?? 0.5);
    params[3] = Number(p.smoothness ?? 0.5);
    params[4] = Number(p.shift ?? 0.5);
    params[5] = Number(p.freq_att ?? 1);
    params[6] = Number(p.shape_att ?? 1);
    params[7] = Number(p.slope_att ?? 1);
    params[8] = Number(p.smooth_att ?? 1);
    params[9] = Number(p.shift_att ?? 1);
    params[10] = read("v_oct");
    params[11] = read("shape_cv");
    params[12] = read("slope_cv");
    params[13] = read("smooth_cv");
    params[14] = read("shift_cv");
    params[15] = audio("fm") ? 0 : read("fm");
    params[16] = audio("trig") ? 0 : (read("trig") > 1 ? 1 : 0);
    params[17] = audio("clock") ? 0 : (read("clock") > 1 ? 1 : 0);
    params[18] = on("v_oct");
    params[19] = on("shape_cv");
    params[20] = on("slope_cv");
    params[21] = on("smooth_cv");
    params[22] = on("shift_cv");
    params[23] = on("fm");
    params[24] = on("trig");
    params[25] = on("clock");
    params[26] = Math.round(Number(p.mode ?? 0.5) * 2);
    params[27] = Math.round(Number(p.range ?? 1) * 2);
    params[28] = [0, 1, 2, 3].includes(p.output) ? p.output : 0;
    params[29] = audio("fm");
    params[30] = audio("trig");
    params[31] = audio("clock");
  } else if (module.type === "warps") {
    params[0] = Number(p.algorithm ?? 0);
    params[1] = Number(p.timbre ?? 0.5);
    params[2] = Number(p.level1 ?? 0.8);
    params[3] = Number(p.level2 ?? 0.8);
    params[4] = read("algo_cv");
    params[5] = read("timbre_cv");
    params[6] = read("level1_cv");
    params[7] = read("level2_cv");
    params[8] = on("algo_cv");
    params[9] = on("timbre_cv");
    params[10] = on("level1_cv");
    params[11] = on("level2_cv");
    params[12] = on("carrier");
    params[13] = on("modulator");
    params[14] = audio("carrier");
    params[15] = audio("modulator");
    params[16] = Math.max(1, Math.min(3, Math.round(Number(p.shape ?? 1))));
  } else if (module.type === "peaks") {
    params[0] = Number(p.p1 ?? 0.5);
    params[1] = Number(p.p2 ?? 0.5);
    params[2] = Number(p.p3 ?? 0.5);
    params[3] = Number(p.p4 ?? 0.5);
    params[4] = audio("trig_a") ? 0 : read("trig_a");
    params[5] = audio("trig_b") ? 0 : read("trig_b");
    params[6] = Math.round(Number(p.function ?? 0) * 3);
    params[7] = Math.round(Number(p.split ?? 1));
    params[8] = on("trig_a");
    params[9] = on("trig_b");
    params[10] = audio("trig_a");
    params[11] = audio("trig_b");
  } else if (module.type === "marbles") {
    params[0] = Number(p.rate ?? 0.5);
    params[1] = Number(p.bias ?? 0.5);
    params[2] = Number(p.jitter ?? 0.5);
    params[3] = Number(p.spread ?? 0.5);
    params[4] = Number(p.x_bias ?? 0.5);
    params[5] = Number(p.steps ?? 0.5);
    params[6] = Number(p.deja_vu ?? 0);
    params[7] = Number(p.deja_vu_length ?? 0.5);
    params[8] = read("rate_cv");
    params[9] = read("bias_cv");
    params[10] = read("jitter_cv");
    params[11] = read("steps_cv");
    params[12] = read("x_spread_cv");
    params[13] = read("spread_cv");
    params[14] = read("x_bias_cv");
    params[15] = on("rate_cv");
    params[16] = on("bias_cv");
    params[17] = on("jitter_cv");
    params[18] = on("steps_cv");
    params[19] = on("x_spread_cv");
    params[20] = on("spread_cv");
    params[21] = on("x_bias_cv");
    params[22] = audio("t_clock") ? 0 : read("t_clock");
    params[23] = audio("x_clock") ? 0 : read("x_clock");
    params[24] = on("t_clock");
    params[25] = on("x_clock");
    params[26] = Math.round(Number(p.t_mode ?? 0) * 5);
    params[27] = Math.round(Number(p.x_mode ?? 0) * 2);
    params[28] = audio("t_clock");
    params[29] = audio("x_clock");
  } else if (module.type === "clouds") {
    params[0] = Number(p.position ?? 0.5);
    params[1] = Number(p.size ?? 0.5);
    params[2] = Number(p.pitch ?? 0.5);
    params[3] = Number(p.in_gain ?? 0.5);
    params[4] = Number(p.density ?? 0.5);
    params[5] = Number(p.texture ?? 0.5);
    params[6] = Number(p.blend ?? 0.5);
    params[7] = read("position_cv");
    params[8] = read("size_cv");
    params[9] = read("v_oct");
    params[10] = on("position_cv");
    params[11] = on("size_cv");
    params[12] = on("density_cv");
    params[13] = on("texture_cv");
    params[14] = on("v_oct");
    params[15] = on("blend_cv");
    params[16] = Math.round(Number(p.playback ?? 0) * 3);
    params[17] = read("freeze") > 1 ? 1 : 0;
    params[18] = on("in_l");
    params[19] = on("in_r");
    params[20] = read("density_cv");
    params[21] = read("texture_cv");
    params[22] = read("blend_cv");
    params[23] = read("trig") > 1 ? 1 : 0;
  }
  return params;
}

function miEnsureWasm(type) {
  if (miFailed.has(type)) return null;
  if (!miLoads.has(type)) {
    const spec = MI_VOICES[type];
    const ctx = audio();
    miLoads.set(type, Promise.all([
      ctx.audioWorklet.addModule("/dsp/mi-worklet.js"),
      fetch(spec.file).then((response) => {
        if (!response.ok) throw new Error(`${type} voice failed to load`);
        return response.arrayBuffer();
      }),
    ]).then(([, bytes]) => {
      miWasm.set(type, bytes);
    }).catch((error) => {
      miFailed.add(type);
      miLoads.delete(type);
      console.error(error);
    }));
  }
  return miLoads.get(type);
}

function miRelease(id) {
  const voice = miVoices.get(id);
  if (!voice) return;
  voice.node.disconnect();
  voice.speakers.forEach((speaker) => speaker.disconnect());
  unregisterRackJacks(id);
  miVoices.delete(id);
}

function miSync(type) {
  const live = new Set((state.rack?.modules || []).filter((module) => module.type === type).map((module) => module.id));
  [...miVoices.entries()].forEach(([id, voice]) => {
    if (voice.type === type && !live.has(id)) miRelease(id);
  });
}

function miEnsure(module) {
  const existing = miVoices.get(module.id);
  if (existing) return existing;
  const spec = MI_VOICES[module.type];
  const ctx = audio();
  const node = new AudioWorkletNode(ctx, "mi", {
    numberOfInputs: spec.inputs.length,
    numberOfOutputs: 1,
    outputChannelCount: [spec.outputs.length],
    channelCount: 1,
    channelCountMode: "explicit",
  });
  const splitter = ctx.createChannelSplitter(spec.outputs.length);
  node.connect(splitter);
  const speakers = spec.outputs.map((port, index) => {
    const raw = ctx.createGain();
    const speaker = ctx.createGain();
    raw.gain.value = 1;
    speaker.gain.value = 0;
    splitter.connect(raw, index);
    raw.connect(speaker);
    speaker.connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
    registerRackJack(module.id, port, raw);
    return speaker;
  });
  node.port.postMessage({
    wasm: miWasm.get(module.type).slice(0),
    init: spec.init,
    render: spec.render,
    inputs: spec.inputs.length,
    outputs: spec.outputs.length,
  });
  node.port.onmessage = (event) => {
    if (event.data?.error) console.error(event.data.error);
    if (!event.data?.levels || !state.rack) return;
    state.rack.levels = state.rack.levels || {};
    spec.outputs.forEach((port, index) => {
      state.rack.levels[`${module.id}:${port}`] = (event.data.levels[index] || 0) * 5;
    });
  };
  const voice = { type: module.type, node, speakers };
  miVoices.set(module.id, voice);
  return voice;
}

function miRoute(module) {
  const spec = MI_VOICES[module.type];
  const voice = miVoices.get(module.id);
  if (!spec || !voice) return {};
  const audioIns = {};
  spec.inputs.forEach((port, index) => {
    audioIns[port] = connectRackInput(module.id, port, voice.node, index);
  });
  return audioIns;
}

function miPlay(module, signals, when) {
  const spec = MI_VOICES[module.type];
  if (!spec || miFailed.has(module.type)) return false;
  const pending = miEnsureWasm(module.type);
  if (!pending) return false;
  pending.then(() => {
    if (!miWasm.get(module.type) || !state.rack) return;
    miSync(module.type);
    if (!state.rack.modules.some((item) => item.id === module.id && item.type === module.type)) return;
    const voice = miEnsure(module);
    if (spec.pairs.length) openParkedAttenuverters(module, spec.pairs);
    const heard = typeof heardNow === "function" ? heardNow(signals) : signals;
    const audioIns = miRoute(module);
    voice.node.port.postMessage({ params: miParams(module, heard, audioIns) });
    const now = audio().currentTime;
    spec.outputs.forEach((port, index) => {
      voice.speakers[index].gain.value = 0;
    });
    miStartPump();
  });
  return true;
}

function miRefresh(module, signals) {
  const spec = MI_VOICES[module?.type];
  const voice = module && miVoices.get(module.id);
  if (!spec || !voice || !signals) return;
  const audioIns = miRoute(module);
  voice.node.port.postMessage({ params: miParams(module, signals, audioIns) });
}

function miStop() {
  miVoices.forEach((voice) => {
    voice.speakers.forEach((speaker) => {
      speaker.gain.value = 0;
    });
  });
}

function miStartPump() {
  if (miPump) return;
  miPump = setInterval(() => {
    const ctx = typeof audio === "function" ? audio() : null;
    if (!ctx || ctx.state !== "running" || !state.rack) return;
    if (!state.playing) {
      if (typeof rackVoiceStop === "function") rackVoiceStop();
      return;
    }
    const live = typeof signalsAt === "function" ? signalsAt(ctx.currentTime) : null;
    const signals = live || state.rack.lastSignals;
    if (!signals) return;
    state.rack.modules.forEach((module) => {
      if (MI_VOICES[module.type]) miRefresh(module, signals);
      else if (module.type === "plaits" && typeof plaitsRefresh === "function") {
        plaitsLast.set(module.id, signals);
        plaitsRefresh(module);
      } else if (module.type === "rings" && typeof ringsRefresh === "function") {
        ringsLast.set(module.id, signals);
        ringsRefresh(module);
      } else if (typeof rackVoiceRefresh === "function") rackVoiceRefresh(module, signals);
    });
  }, 30);
}
