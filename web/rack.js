const RACK_HP = 84;
const RACK_ROW = 128.5 / 5.08;
const RACK_VOICES = {
  plaits: "plaits",
  rings: "rings",
  clouds: "clouds",
  noise: "drum",
};
const AUDIO_PASS = {
  dual_vca: { in_a: ["out_a", "sum"], in_b: ["out_b", "sum"] },
  erica_mixer: { in1: ["out", "out2"], in2: ["out", "out2"], in3: ["out", "out2"], in4: ["out", "out2"] },
  delay: { in: ["out_l", "out_r", "mix"] },
  reverb: { in_l: ["out_l"], in_r: ["out_r"] },
};
const CABLE_COLORS = ["#e85d04", "#2a9d8f", "#e9c46a", "#9b5de5", "#00b4d8", "#ef476f"];

function seqHits() {
  const rows = [26.46, 43.58, 60.7, 77.82];
  const cols = [["cv", 19.69], ["gate", 50], ["mod", 79.97]];
  return rows.flatMap((y, index) => cols.map(([name, x]) => ({
    id: `${name}${index + 1}`,
    kind: "out",
    x,
    y,
    size: "md",
  })));
}

RACK_CATALOG.black_seq = {
  name: "Black Sequencer",
  hp: 16,
  src: "panels/fm/black_seq.svg",
  caps: false,
  fixed: true,
  hits: seqHits(),
  ports: seqHits().map((hit) => ({ id: hit.id, kind: "out" })),
  params: [],
};

function mixerHit(id, kind, x, y) {
  return { id, kind, x, y, size: "md" };
}
RACK_CATALOG.erica_mixer = {
  name: "Mixer",
  hp: 8,
  src: "panels/fm/mixer.svg",
  caps: true,
  hits: [
    mixerHit("in1", "in", 15.33, 16.4),
    { id: "mute1", kind: "toggle", x: 47, y: 16.4, size: "sm", shape: "rect", label: "Mute CH1" },
    mixerHit("ch1", "param", 78.36, 16.4),
    mixerHit("in2", "in", 15.33, 32.22),
    { id: "mute2", kind: "toggle", x: 47, y: 32.22, size: "sm", shape: "rect", label: "Mute CH2" },
    mixerHit("ch2", "param", 78.36, 32.22),
    mixerHit("in3", "in", 15.33, 48.03),
    { id: "mute3", kind: "toggle", x: 47, y: 48.03, size: "sm", shape: "rect", label: "Mute CH3" },
    mixerHit("ch3", "param", 78.36, 48.03),
    mixerHit("in4", "in", 15.33, 63.84),
    { id: "mute4", kind: "toggle", x: 47, y: 63.84, size: "sm", shape: "rect", label: "Mute CH4" },
    mixerHit("ch4", "param", 78.36, 63.84),
    mixerHit("out2", "out", 15.33, 79.66), mixerHit("out", "out", 78.36, 79.66),
  ],
  ports: ["in1", "in2", "in3", "in4"].map((id) => ({ id, kind: "in" })).concat([
    { id: "out", kind: "out" }, { id: "out2", kind: "out" },
  ]),
  params: ["ch1", "ch2", "ch3", "ch4", "mute1", "mute2", "mute3", "mute4"],
};
function rackScale() {
  const hp = Math.max(14, Math.min(24, Number(localStorage.getItem("blackseq.rackHp")) || 18));
  return { hp, row: Math.round(hp * RACK_ROW) };
}

function controlNames(type) {
  const spec = RACK_CATALOG[type];
  if (!spec) return [];
  const names = new Set(spec.params || []);
  (spec.hits || []).forEach((hit) => {
    if (hit.kind === "param" || hit.kind === "toggle") names.add(hit.id);
    if (hit.kind === "button" && hit.param) names.add(hit.param);
  });
  return [...names];
}

function defaultParam(type, name) {
  const hit = RACK_CATALOG[type]?.hits?.find((item) => item.id === name || item.param === name);
  if (hit?.kind === "toggle") return 0;
  if (type === "rings" && name === "model") return 0;
  if (type === "rings" && name === "polyphony") return 1;
  if (name === "level") return 0.8;
  if (name.endsWith("_att")) return 1;
  if (name === "range" || name === "split") return 1;
  if (name === "function" || name === "t_mode" || name === "x_mode") return 0;
  return 0.5;
}

function blankParams(type) {
  const params = {};
  controlNames(type).forEach((name) => {
    params[name] = defaultParam(type, name);
  });
  return params;
}

function openParkedAttenuverters(module, pairs) {
  if (!module) return;
  let changed = false;
  pairs.forEach(([jack, knob]) => {
    const flag = `opened_${knob}`;
    if (module.params[flag] || !cableInto(module.id, jack)) return;
    module.params[flag] = 1;
    if (Number(module.params[knob] ?? 0.5) === 0.5) {
      module.params[knob] = 1;
      changed = true;
    }
  });
  if (!changed) return;
  saveRack();
  if (!$("rack-view")?.hidden) renderRack();
}

function mixedControl(module, knob, jack, att, signals) {
  const base = Number(module.params[knob] ?? 0.5);
  const cv = inputVoltage(module.id, jack, signals);
  if (cv == null) return base;
  const depth = Number(module.params[att] ?? 1) * 2 - 1;
  return Math.max(0, Math.min(1, base + (cv / 5) * depth));
}

function defaultRack() {
  const module = (id, type, x, params) => ({ id, type, x, y: 0, params });
  const plaits = (id, x, tweaks) => module(id, "plaits", x, { ...blankParams("plaits"), ...tweaks });
  // Plaits lead + Rings pads + Plaits bass + Peaks kick/snare (gate4 / mod4).
  return {
    version: 7,
    nextModule: 8,
    nextCable: 19,
    arm: null,
    edges: {},
    modules: [
      module(0, "black_seq", 0, {}),
      plaits(1, 16, { model: 0 / 23, harmonics: 0.4, timbre: 0.3, morph: 0.55 }),
      module(2, "rings", 28, {
        ...blankParams("rings"),
        model: 0,
        polyphony: 1,
        structure: 0.42,
        brightness: 0.55,
        damping: 0.62,
        position: 0.48,
      }),
      plaits(3, 42, { model: 2 / 23, freq: 0.36, harmonics: 0.22, timbre: 0.2, morph: 0.52 }),
      module(4, "peaks", 54, {
        ...blankParams("peaks"),
        function: 1,
        split: 1,
        p1: 0.35,
        p2: 0.55,
        p3: 0.4,
        p4: 0.62,
      }),
      module(5, "dual_vca", 62, { ...blankParams("dual_vca"), bias_a: 1, bias_b: 1 }),
      module(6, "erica_mixer", 72, {
        ...blankParams("erica_mixer"),
        ch1: 0.78,
        ch2: 0.7,
        ch3: 0.88,
        ch4: 0.82,
        mute1: 0,
        mute2: 0,
        mute3: 0,
        mute4: 0,
      }),
      { id: 7, type: "erica_output", x: 0, y: 1, params: { ...blankParams("erica_output"), level: 0.7 } },
    ],
    cables: [
      { id: 1, from: { module: 0, port: "cv1" }, to: { module: 1, port: "v_oct" } },
      { id: 2, from: { module: 0, port: "gate1" }, to: { module: 1, port: "trig" } },
      { id: 3, from: { module: 0, port: "mod1" }, to: { module: 1, port: "timbre_cv" } },
      { id: 4, from: { module: 1, port: "out" }, to: { module: 6, port: "in1" } },
      { id: 5, from: { module: 0, port: "cv2" }, to: { module: 2, port: "v_oct" } },
      { id: 6, from: { module: 0, port: "gate2" }, to: { module: 2, port: "trig" } },
      { id: 7, from: { module: 0, port: "mod2" }, to: { module: 2, port: "structure_cv" } },
      { id: 8, from: { module: 2, port: "out" }, to: { module: 6, port: "in2" } },
      { id: 9, from: { module: 0, port: "cv3" }, to: { module: 3, port: "v_oct" } },
      { id: 10, from: { module: 0, port: "gate3" }, to: { module: 3, port: "trig" } },
      { id: 11, from: { module: 0, port: "mod3" }, to: { module: 3, port: "morph_cv" } },
      { id: 12, from: { module: 3, port: "out" }, to: { module: 6, port: "in3" } },
      { id: 13, from: { module: 0, port: "gate4" }, to: { module: 4, port: "trig_a" } },
      { id: 14, from: { module: 0, port: "mod4" }, to: { module: 4, port: "trig_b" } },
      { id: 15, from: { module: 4, port: "out_a" }, to: { module: 5, port: "in_a" } },
      { id: 16, from: { module: 4, port: "out_b" }, to: { module: 5, port: "in_b" } },
      { id: 17, from: { module: 5, port: "sum" }, to: { module: 6, port: "in4" } },
      { id: 18, from: { module: 6, port: "out" }, to: { module: 7, port: "in_l" } },
    ],
  };
}

const MI_RENAME = { facets: "plaits", chimes: "rings", swell: "tides", lots: "marbles", twist: "warps", twin: "peaks" };

function packRack(modules) {
  const cursor = [0, 0];
  const ordered = [...modules].sort((a, b) => (a.y || 0) - (b.y || 0) || a.x - b.x);
  const seq = ordered.find((item) => item.type === "black_seq");
  const rest = ordered.filter((item) => item !== seq);
  (seq ? [seq, ...rest] : rest).forEach((item) => {
    const hp = RACK_CATALOG[item.type]?.hp || 8;
    let y = 0;
    while (y < 1 && cursor[y] + hp > RACK_HP) y += 1;
    item.x = cursor[y];
    item.y = y;
    cursor[y] += hp;
  });
}

function rememberRackLocal() {
  const { modules, cables, nextModule, nextCable, version } = state.rack;
  localStorage.setItem("blackseq.rack", JSON.stringify({
    version: Math.max(7, Number(version) || 7),
    modules,
    cables,
    nextModule,
    nextCable,
  }));
}

function releaseRackVoices() {
  (state.rack?.modules || []).forEach((module) => {
    if (typeof plaitsRelease === "function") plaitsRelease(module.id);
    if (typeof ringsRelease === "function") ringsRelease(module.id);
    if (typeof miRelease === "function") miRelease(module.id);
    if (typeof rackVoiceRelease === "function") rackVoiceRelease(module.id);
  });
}

function rackIsLean(modules) {
  return (modules || []).every((item) => item.type === "black_seq" || RACK_CATALOG[item.type]);
}

function adoptRack(saved) {
  const usable = saved && Array.isArray(saved.modules) && saved.modules.some((item) => item.type === "black_seq");
  // Hard cut: unknown types or pre-v7 factory → Plaits/Rings/Plaits/Peaks.
  if (!usable || !rackIsLean(saved.modules) || (Number(saved.version) || 0) < 7) saved = defaultRack();
  else {
    saved.modules.forEach((item) => {
      if (MI_RENAME[item.type]) item.type = MI_RENAME[item.type];
    });
    if (!rackIsLean(saved.modules)) saved = defaultRack();
  }
  releaseRackVoices();
  state.rack = saved;
  state.rack.version = Math.max(7, Number(saved.version) || 7);
  (state.rack.modules || []).forEach((module) => {
    if (module.type !== "erica_mixer") return;
    for (let index = 1; index <= 4; index += 1) {
      if (module.params[`mute${index}`] == null) module.params[`mute${index}`] = 0;
    }
  });
  packRack(state.rack.modules);
  state.rack.levels = {};
  state.rack.modules = state.rack.modules.filter((item) => item.type === "black_seq" || RACK_CATALOG[item.type]);
  if (!state.rack.modules.some((item) => item.id === 0)) {
    state.rack.modules.unshift({ id: 0, type: "black_seq", x: 0, y: 0, params: {} });
  }
  const known = new Set(state.rack.modules.map((item) => item.id));
  state.rack.cables = (state.rack.cables || []).filter((cable) => {
    if (!known.has(cable.from?.module) || !known.has(cable.to?.module)) return false;
    const from = state.rack.modules.find((item) => item.id === cable.from.module);
    const to = state.rack.modules.find((item) => item.id === cable.to.module);
    const outs = RACK_CATALOG[from.type]?.ports || [];
    const ins = RACK_CATALOG[to.type]?.ports || [];
    return outs.some((port) => port.kind === "out" && port.id === cable.from.port)
      && ins.some((port) => port.kind === "in" && port.id === cable.to.port);
  });
  state.rack.arm = null;
  state.rack.edges = {};
  state.rack.cues = [];
  rememberRackLocal();
  if (typeof clearSongRackEdit === "function") clearSongRackEdit();
  if (!$("rack-view")?.hidden) renderRack();
}

function loadRack() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("blackseq.rack") || "null");
  } catch (error) {
    saved = null;
  }
  adoptRack(saved);
}

function saveRack() {
  rememberRackLocal();
  if (typeof noteSongRack === "function") noteSongRack();
}

var rackPresetCache = {};

function readRackPresets() {
  return rackPresetCache;
}

function rackSnapshot() {
  const modules = state.rack.modules.map((module) => ({
    id: module.id,
    type: module.type,
    x: module.x,
    y: module.y || 0,
    params: { ...blankParams(module.type), ...(module.params || {}) },
  }));
  return JSON.parse(JSON.stringify({
    modules,
    cables: state.rack.cables,
    nextModule: state.rack.nextModule,
    nextCable: state.rack.nextCable,
  }));
}

function renderRackPresets(selected) {
  const menu = $("rack-preset");
  if (!menu || document.activeElement === menu) return;
  const presets = readRackPresets();
  const current = selected || menu.value;
  menu.innerHTML = `<option value="">Current</option>${Object.keys(presets).sort().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  menu.value = presets[current] ? current : "";
  const remove = $("rack-preset-delete");
  if (remove) remove.disabled = !menu.value;
}

async function rememberPreset(name) {
  const rack = rackSnapshot();
  const previous = rackPresetCache[name];
  rackPresetCache[name] = rack;
  renderRackPresets(name);
  const field = $("rack-preset-name");
  if (field) field.value = name;
  if (typeof storeRackPreset !== "function") return;
  try {
    await storeRackPreset(name, rack);
  } catch (error) {
    if (previous) rackPresetCache[name] = previous;
    else delete rackPresetCache[name];
    renderRackPresets(previous ? name : "");
    setStatus(error.message, "error");
  }
}

function applyRackPreset(name) {
  const stored = readRackPresets()[name];
  if (!stored || !Array.isArray(stored.modules)) return;
  const preset = JSON.parse(JSON.stringify(stored));
  state.rack.modules.forEach((module) => {
      if (typeof plaitsRelease === "function") plaitsRelease(module.id);
      if (typeof ringsRelease === "function") ringsRelease(module.id);
      if (typeof miRelease === "function") miRelease(module.id);
      if (typeof rackVoiceRelease === "function") rackVoiceRelease(module.id);
    });
  state.rack.modules = preset.modules;
  state.rack.cables = preset.cables || [];
  state.rack.nextModule = preset.nextModule || 1;
  state.rack.nextCable = preset.nextCable || 1;
  state.rack.arm = null;
  state.rack.selected = null;
  saveRack();
  renderRack();
}

function selectRackModule(id) {
  state.rack.selected = id;
  document.querySelectorAll("#rack-bay .module").forEach((card) => {
    card.classList.toggle("selected", Number(card.dataset.moduleId) === id);
  });
}

function moduleById(id) {
  return state.rack.modules.find((item) => item.id === id) || null;
}

function cableInto(moduleId, port) {
  return state.rack.cables.find((cable) => cable.to.module === moduleId && cable.to.port === port) || null;
}

function portSignal(id) {
  if (/trig|gate|sync|reset|clock|clk|inhibit|accent|rst|freeze/.test(id)) return "gate";
  if (/^(in\d*|out\d*|out_[lr]|aux|saw|sq|tri|sine|pulse|lp|bp|hp|wet|mix|mix_out|line_[lr]|carrier|modulator|sum|out_[ab]|in_[ablr]|noise)$/.test(id)) return "audio";
  return "cv";
}

function occupied(x, hp, y, ignore) {
  return state.rack.modules.some((item) => {
    if (item.id === ignore || item.y !== y) return false;
    const width = RACK_CATALOG[item.type].hp;
    return x < item.x + width && item.x < x + hp;
  });
}

function freeSlot(hp) {
  for (const y of [0, 1]) {
    for (let x = 0; x <= RACK_HP - hp; x += 1) {
      if (!occupied(x, hp, y)) return { x, y };
    }
  }
  return null;
}

function renderPalette() {
  const palette = $("rack-palette");
  if (!palette) return;
  palette.innerHTML = RACK_PALETTE.map((group) => `
    <h3>${group.label}</h3>
    ${group.types.filter((type) => RACK_CATALOG[type]).map((type) => {
      const spec = RACK_CATALOG[type];
      return `<button type="button" data-rack-add="${type}">${spec.name}<span>${spec.hp}HP</span></button>`;
    }).join("")}
  `).join("");
}

function renderRack() {
  if (!state.rack) loadRack();
  renderPalette();
  const bay = $("rack-bay");
  if (!bay) return;
  const scale = rackScale();
  bay.style.setProperty("--hp", `${scale.hp}px`);
  bay.style.setProperty("--row-h", `${scale.row}px`);
  $("rack-case")?.style.setProperty("--hp", `${scale.hp}px`);
  $("rack-case")?.style.setProperty("--row-h", `${scale.row}px`);
  const zoom = $("rack-zoom");
  if (zoom) zoom.textContent = `${Math.round(scale.hp / 18 * 100)}%`;
  const cards = state.rack.modules.map((module) => {
    const spec = RACK_CATALOG[module.type];
    const controls = spec.hits.map((hit) => {
      const style = `left:${hit.x}%;top:${hit.y}%`;
      if (hit.kind === "param") {
        const value = Number(module.params[hit.id] ?? 0.5);
        const turn = (value - 0.5) * 270;
        return `<span class="hit" style="${style}"><button type="button" class="knob size-${hit.size || "md"}" style="transform:rotate(${turn}deg)" data-rack-knob="${hit.id}" data-rack-module="${module.id}" aria-label="${hit.label || hit.id}"></button></span>`;
      }
      if (hit.kind === "button") {
        return `<span class="hit" style="${style}"><button type="button" class="mi-button size-${hit.size || "md"}" data-rack-button="${hit.param}" data-rack-step="${hit.step}" data-rack-max="${hit.max}" data-rack-module="${module.id}" aria-label="${hit.label || hit.id}"></button></span>`;
      }
      if (hit.kind === "toggle") {
        let on = Number(module.params[hit.id] ?? 0) >= 0.5;
        if (module.type === "erica_mixer" && /^mute[1-4]$/.test(hit.id) && state.mix) {
          on = Boolean(state.mix[Number(hit.id.slice(4)) - 1]?.mute);
          module.params[hit.id] = on ? 1 : 0;
        }
        const shape = hit.shape === "rect" ? " rect" : "";
        return `<span class="hit" style="${style}"><button type="button" class="panel-toggle${shape}${on ? " on" : ""}" data-rack-toggle="${hit.id}" data-rack-module="${module.id}" aria-pressed="${on}" aria-label="${hit.label || hit.id}"></button></span>`;
      }
      if (hit.kind === "led") {
        let on = false;
        let color = "";
        let blink = false;
        if (hit.group === "model") {
          const perBank = 8;
          const total = perBank * 3;
          const selected = Math.min(total - 1, Math.floor(Number(module.params.model ?? 0) * total));
          on = Number(hit.index) === selected % perBank;
          color = ["green", "red", "orange"][Math.floor(selected / perBank)];
        } else if (hit.group === "tides-mode" || hit.group === "tides-range") {
          const mode = Math.round(Number(module.params.mode ?? 0.5) * 2);
          const range = Math.round(Number(module.params.range ?? 1) * 2);
          const index = hit.group === "tides-mode" ? mode : range;
          color = ["green", "orange", "red"][index] || "green";
          on = true;
        } else if (hit.group === "peaks") {
          const fn = Math.round(Number(module.params.function ?? 0) * 3);
          const split = Math.round(Number(module.params.split ?? 1));
          if (hit.index === 0) on = split === 1;
          else on = hit.index === fn + 1;
          color = on ? "green" : "";
        } else if (hit.group === "warps-osc") {
          on = !cableInto(module.id, "carrier");
          color = on ? "green" : "";
        } else if (hit.group === "rings-poly" || hit.group === "rings-mode") {
          const poly = ringsChoice(module.params.polyphony, [1, 2, 3, 4], 1);
          const model = ringsChoice(module.params.model, [0, 1, 2, 3, 4, 5], 0);
          if (hit.group === "rings-poly") {
            color = poly >= 4 ? "red" : poly === 1 ? "green" : "orange";
            blink = poly === 3;
          } else {
            color = ["green", "orange", "red"][Math.abs(model) % 3];
            blink = model >= 3;
          }
          on = true;
        }
        return `<span class="hit" style="${style}"><i class="led${hit.size === "lg" ? " lg" : ""}${on ? ` on ${color}` : ""}${blink ? " blink" : ""}"></i></span>`;
      }
      if (hit.kind !== "in" && hit.kind !== "out") return "";
      const armed = state.rack.arm && state.rack.arm.module === module.id && state.rack.arm.port === hit.id;
      const patched = hit.kind === "in"
        ? cableInto(module.id, hit.id)
        : state.rack.cables.some((cable) => cable.from.module === module.id && cable.from.port === hit.id);
      const signal = portSignal(hit.id);
      return `<span class="hit" style="${style}"><button type="button" class="jack ${spec.caps ? "cap" : "ghost"} ${signal}-${hit.kind === "in" ? "in" : "out"} size-${hit.size || "md"}${armed ? " armed" : ""}${patched ? " patched" : ""}" data-jack="${module.id}:${hit.kind}:${hit.id}" data-rack-module="${module.id}" data-rack-port="${hit.id}" data-rack-dir="${hit.kind === "in" ? "in" : "out"}" aria-label="${spec.name} ${hit.label || hit.id}"></button></span>`;
    }).join("");
    const selected = state.rack.selected === module.id ? " selected" : "";
    const remove = spec.fixed ? "" : `<button type="button" class="module-remove" data-rack-remove="${module.id}" aria-label="Remove ${spec.name}">×</button>`;
    return `<article class="module plate-layout${spec.fixed ? " fixed" : ""}${selected}" data-module-id="${module.id}" style="left:${module.x * scale.hp}px;top:${module.y * (scale.row + 12)}px;width:${spec.hp * scale.hp}px;height:${scale.row}px">
      <img class="module-faceplate" alt="" src="${spec.src}">
      ${controls}
      ${remove}
    </article>`;
  }).join("");
  bay.innerHTML = `<div class="rail bay-gap"></div><svg id="rack-cables" class="cables"></svg>${cards}`;
  renderRackPresets();
  requestAnimationFrame(drawCables);
}

function drawCables() {
  const svg = $("rack-cables");
  const bay = $("rack-bay");
  if (!svg || !bay) return;
  const box = bay.getBoundingClientRect();
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("viewBox", `0 0 ${bay.clientWidth} ${bay.clientHeight}`);
  svg.setAttribute("width", String(bay.clientWidth));
  svg.setAttribute("height", String(bay.clientHeight));
  svg.innerHTML = state.rack.cables.map((cable, index) => {
    const from = document.querySelector(`[data-jack="${cable.from.module}:out:${cable.from.port}"]`);
    const to = document.querySelector(`[data-jack="${cable.to.module}:in:${cable.to.port}"]`);
    if (!from || !to) return "";
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = a.left - box.left + a.width / 2;
    const y1 = a.top - box.top + a.height / 2;
    const x2 = b.left - box.left + b.width / 2;
    const y2 = b.top - box.top + b.height / 2;
    const hang = Math.min(90, 24 + Math.hypot(x2 - x1, y2 - y1) * 0.18);
    const d = `M ${x1} ${y1} C ${x1} ${y1 + hang}, ${x2} ${y2 + hang}, ${x2} ${y2}`;
    const color = CABLE_COLORS[index % CABLE_COLORS.length];
    return `<g class="cable-group" data-cable="${cable.id}"><path class="cable-hit" d="${d}"/><path class="cable-shadow" d="${d}"/><path class="cable-body" d="${d}" stroke="${color}"/><path class="cable-sheen" d="${d}"/></g>`;
  }).join("");
}

function addRackModule(type) {
  const spec = RACK_CATALOG[type];
  if (!spec || spec.fixed) return;
  const slot = freeSlot(spec.hp);
  if (!slot) return;
  state.rack.modules.push({ id: state.rack.nextModule, type, x: slot.x, y: slot.y, params: blankParams(type) });
  state.rack.nextModule += 1;
  saveRack();
  renderRack();
}

function connectRack(from, to) {
  state.rack.cables = state.rack.cables.filter((cable) => !(cable.to.module === to.module && cable.to.port === to.port));
  state.rack.cables.push({ id: state.rack.nextCable, from, to });
  state.rack.nextCable += 1;
  state.rack.arm = null;
  saveRack();
  renderRack();
}

function inputVoltage(moduleId, port, signals) {
  const cable = cableInto(moduleId, port);
  if (!cable) return null;
  if (cable.from.module === 0) return Number(signals[cable.from.port] || 0);
  const level = state.rack.levels && state.rack.levels[`${cable.from.module}:${cable.from.port}`];
  return level == null ? 0 : level;
}

function pathGain(moduleId, port, signals, seen) {
  const key = `${moduleId}:${port}`;
  if (seen.has(key)) return 0;
  seen.add(key);
  let best = 0;
  state.rack.cables.forEach((cable) => {
    if (cable.from.module !== moduleId || cable.from.port !== port) return;
    const dest = moduleById(cable.to.module);
    if (!dest) return;
    if (dest.type === "erica_output" && (cable.to.port === "in_l" || cable.to.port === "in_r")) {
      best = Math.max(best, Number(dest.params.level ?? 0.8));
      return;
    }
    const onward = (AUDIO_PASS[dest.type] || {})[cable.to.port] || [];
    let gain = 1;
    if (dest.type === "erica_mixer") {
      const knob = { in1: "ch1", in2: "ch2", in3: "ch3", in4: "ch4" }[cable.to.port];
      gain = knob ? Math.max(0, Math.min(1, Number(dest.params[knob] ?? 0))) : 0;
    } else if (dest.type === "dual_vca") {
      const side = cable.to.port === "in_b" ? "b" : "a";
      const cv = inputVoltage(dest.id, `cv_${side}`, signals);
      gain = Math.max(0, Math.min(1, Number(dest.params[`bias_${side}`] ?? 0) + (cv == null ? 1 : cv / 5)));
    }
    onward.forEach((next) => {
      best = Math.max(best, gain * pathGain(dest.id, next, signals, new Set(seen)));
    });
  });
  return best;
}

function pitchName(type) {
  const ports = RACK_CATALOG[type]?.ports || [];
  return ["v_oct", "pitch"].find((name) => ports.some((port) => port.id === name && port.kind === "in")) || null;
}

function trigName(type) {
  const ports = RACK_CATALOG[type]?.ports || [];
  return ["trig", "gate"].find((name) => ports.some((port) => port.id === name && port.kind === "in")) || null;
}

function sourceChannel(module) {
  const cable = cableInto(module.id, pitchName(module.type) || "") || cableInto(module.id, trigName(module.type) || "");
  if (!cable || cable.from.module !== 0) return 0;
  return Number(String(cable.from.port).replace(/\D/g, "")) || 0;
}

function gateRise(module, signals) {
  const trig = trigName(module.type);
  const patched = trig && cableInto(module.id, trig);
  const channel = sourceChannel(module);
  const high = patched ? (inputVoltage(module.id, trig, signals) || 0) > 1 : (signals[`gate${channel}`] || 0) > 1;
  const key = `${module.id}:${patched ? trig : `ch${channel}`}`;
  const was = Boolean(state.rack.edges[key]);
  state.rack.edges[key] = high;
  return high && (!was || Boolean(signals[`attack${channel}`]));
}

function voiceOf(type) {
  if (AUDIO_PASS[type] || type === "erica_output" || type === "black_seq" || type === "tides" || type === "marbles" || type === "peaks") return null;
  if (RACK_VOICES[type]) return RACK_VOICES[type];
  if (pitchName(type)) return "plaits";
  return null;
}

function playPatched(module, signals, when, frequency, mod, voice, damping, structure, position) {
  const spec = RACK_CATALOG[module.type];
  const outs = spec.ports.filter((port) => port.kind === "out" && portSignal(port.id) === "audio");
  const live = outs.map((port) => ({ port: port.id, gain: pathGain(module.id, port.id, signals, new Set()) })).filter((item) => item.gain > 0);
  if (!live.length) return;
  const channel = sourceChannel(module);
  if (!channel) return;
  if (!gateRise(module, signals)) return;
  const nudge = signals[`nudge${channel}`] || 0;
  const ratios = signals[`ratios${channel}`];
  const pieces = ratios?.length || Math.max(1, signals[`ratchet${channel}`] || 1);
  const duration = Math.max(0.02, (signals[`slice${channel}`] || signals[`dur${channel}`] || 0.1));
  const glide = signals[`glide${channel}`] || 0;
  const fromCv = signals[`from${channel}`];
  const toCv = signals[`to${channel}`];
  const fromFreq = glide > 0 && fromCv != null && toCv != null ? frequency * (2 ** (fromCv - toCv)) : 0;
  const waves = { saw: "sawtooth", sq: "square", tri: "triangle", sine: "sine", pulse: "square", out: "sawtooth" };
  for (let piece = 0; piece < pieces; piece += 1) {
    const ratio = ratios ? ratios[piece] || 1 : 1;
    const freq = frequency * ratio;
    const at = when + nudge + piece * duration;
    const glideFrom = piece === 0 && fromFreq ? fromFreq : 0;
    const glideTime = piece === 0 ? glide : 0;
    if (voice === "vco") {
      live.forEach((item) => {
        const type = waves[item.port] || "sawtooth";
        vcoVoice(audio(), at, type, freq, mod, duration * 0.9, 0.07 * item.gain, glideFrom, glideTime);
      });
    } else if (voice === "rings") ringsVoice(audio(), at, freq, mod, duration, 0.07 * Math.max(...live.map((item) => item.gain)), damping, structure, position);
    else if (voice === "clouds") cloudsVoice(audio(), at, freq, mod, duration, 0.07 * Math.max(...live.map((item) => item.gain)));
    else if (voice === "drum") drumVoice(audio(), at, module.type === "noise" ? 72 : 36 + mod * 24, mod, 0.1 * Math.max(...live.map((item) => item.gain)));
    else plaitsVoice(audio(), at, freq, mod, duration, 0.07 * Math.max(...live.map((item) => item.gain)), glideFrom, glideTime);
  }
}

function rackPlay(signals, when) {
  if (!state.rack) loadRack();
  state.rack.lastSignals = signals;
  if (typeof cuePerformance === "function") cuePerformance(signals, when);
  state.rack.modules.forEach((module) => {
    if (module.type === "plaits" && typeof plaitsPlay === "function" && plaitsPlay(module, signals, when)) return;
    if (module.type === "rings" && typeof ringsPlay === "function" && ringsPlay(module, signals, when)) return;
    if (typeof miPlay === "function" && miPlay(module, signals, when)) return;
    if (typeof rackVoicePlay === "function" && rackVoicePlay(module, signals, when)) return;
    const voice = voiceOf(module.type);
    if (!voice) return;
    const pitch = pitchName(module.type);
    const oct = pitch ? inputVoltage(module.id, pitch, signals) : 0;
    let frequency = Math.max(20, Math.min(8000, 130.81 * 2 ** (oct || 0)));
    if (module.type === "plaits" || module.type === "rings" || module.type === "clouds") {
      const tune = Number(module.params[module.type === "clouds" ? "pitch" : "freq"] ?? 0.5);
      frequency *= 2 ** ((tune - 0.5) * 4);
    }
    let modPort = "timbre_cv";
    let knob = "timbre";
    let structure = 0.5;
    let position = 0.5;
    if (module.type === "rings") {
      openParkedAttenuverters(module, [
        ["freq_cv", "freq_att"],
        ["structure_cv", "structure_att"],
        ["brightness_cv", "brightness_att"],
        ["damping_cv", "damping_att"],
        ["position_cv", "position_att"],
      ]);
      const freqCv = inputVoltage(module.id, "freq_cv", signals);
      const freqDepth = Number(module.params.freq_att ?? 1) * 2 - 1;
      if (freqCv) frequency *= 2 ** (freqCv * freqDepth);
      modPort = "brightness_cv";
      knob = "brightness";
      structure = mixedControl(module, "structure", "structure_cv", "structure_att", signals);
      position = mixedControl(module, "position", "position_cv", "position_att", signals);
    } else if (module.type === "clouds") {
      modPort = "texture_cv";
      knob = "texture";
    } else if (module.type === "vco" || module.type === "erica_vco3") {
      const fm = inputVoltage(module.id, "fm", signals);
      const fmDepth = Number(module.params.fm_amt ?? 0.5);
      if (fm) frequency *= 2 ** (fm * 0.25 * fmDepth);
      modPort = "pwm";
      knob = "pwm_amt";
    } else if (module.type === "erica_bassline") {
      modPort = "cutoff_cv";
      knob = "cutoff";
    }
    const base = Number(module.params[knob] ?? 0.5);
    const cv = inputVoltage(module.id, modPort, signals);
    let mixed = cv == null ? base : Math.max(0, Math.min(1, base + cv / 10));
    if (module.type === "rings") mixed = mixedControl(module, "brightness", "brightness_cv", "brightness_att", signals);
    if (module.type === "erica_bassline" && (inputVoltage(module.id, "accent_gate", signals) || 0) > 1) {
      mixed = Math.min(1, mixed + 0.35);
    }
    let damping = 0.5;
    if (module.type === "rings") damping = mixedControl(module, "damping", "damping_cv", "damping_att", signals);
    playPatched(module, signals, when, frequency, mixed * 2 - 1, voice, damping, structure, position);
  });
}

function ringsMode(module, name, held) {
  if (!module) return;
  if (name === "polyphony") {
    let poly = ringsChoice(module.params.polyphony, [1, 2, 3, 4], 1);
    if (held) poly = 3;
    else if (poly === 1) poly = 2;
    else if (poly === 2 || poly === 3) poly = 4;
    else poly = 1;
    module.params.polyphony = poly;
  } else {
    let model = ringsChoice(module.params.model, [0, 1, 2, 3, 4, 5], 0);
    if (held) model = model >= 3 ? model - 3 : model + 3;
    else if (model >= 3) model -= 3;
    else model = (model + 1) % 3;
    module.params.model = model;
  }
  saveRack();
  renderRack();
  if (typeof ringsRefresh === "function") ringsRefresh(module);
}

let ringsHold = null;
let rackDrag = null;
loadRack();
$("rack-view")?.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-rack-button]");
  if (!button) return;
  const module = moduleById(Number(button.dataset.rackModule));
  if (module?.type !== "rings") return;
  ringsHold = { module, name: button.dataset.rackButton, at: performance.now() };
  button.setPointerCapture?.(event.pointerId);
});
$("rack-view")?.addEventListener("pointerup", () => {
  if (!ringsHold) return;
  const held = performance.now() - ringsHold.at >= 450;
  const press = ringsHold;
  ringsHold = null;
  ringsMode(press.module, press.name, held);
});
$("rack-view")?.addEventListener("click", (event) => {
  const add = event.target.closest("[data-rack-add]");
  if (add) {
    addRackModule(add.dataset.rackAdd);
    return;
  }
  const toggle = event.target.closest("[data-rack-toggle]");
  if (toggle) {
    const module = moduleById(Number(toggle.dataset.rackModule));
    const name = toggle.dataset.rackToggle;
    if (!module || !name) return;
    module.params[name] = Number(module.params[name] ?? 0) >= 0.5 ? 0 : 1;
    if (module.type === "erica_mixer" && /^mute[1-4]$/.test(name) && state.mix) {
      const channel = Number(name.slice(4)) - 1;
      state.mix[channel].mute = Number(module.params[name]) >= 0.5;
      const mixBtn = document.querySelector(`[data-mute="${channel}"]`);
      if (mixBtn) {
        mixBtn.classList.toggle("on", state.mix[channel].mute);
        mixBtn.setAttribute("aria-pressed", String(state.mix[channel].mute));
        mixBtn.closest(".daw-row")?.classList.toggle("muted", state.mix[channel].mute);
      }
    }
    saveRack();
    renderRack();
    if (typeof rackVoiceRefresh === "function") rackVoiceRefresh(module, state.rack.lastSignals);
    return;
  }
  const stepButton = event.target.closest("[data-rack-button]");
  if (stepButton) {
    const module = moduleById(Number(stepButton.dataset.rackModule));
    const name = stepButton.dataset.rackButton;
    if (module?.type === "rings" && (name === "polyphony" || name === "model")) return;
    const max = Math.max(2, Number(stepButton.dataset.rackMax) || 2);
    const step = Number(stepButton.dataset.rackStep) || 1;
    const current = Math.min(max - 1, Math.floor(Number(module?.params[name] ?? 0) * max));
    const next = (current + step + max) % max;
    module.params[name] = next / (max - 1);
    saveRack();
    renderRack();
    if (typeof plaitsRefresh === "function") plaitsRefresh(module);
    if (typeof ringsRefresh === "function") ringsRefresh(module);
    if (typeof miRefresh === "function") miRefresh(module, state.rack.lastSignals);
    if (typeof rackVoiceRefresh === "function") rackVoiceRefresh(module, state.rack.lastSignals);
    return;
  }
  const remove = event.target.closest("[data-rack-remove]");
  if (remove) {
    const id = Number(remove.dataset.rackRemove);
    state.rack.modules = state.rack.modules.filter((item) => item.id !== id);
    state.rack.cables = state.rack.cables.filter((cable) => cable.from.module !== id && cable.to.module !== id);
    if (typeof plaitsRelease === "function") plaitsRelease(id);
    if (typeof ringsRelease === "function") ringsRelease(id);
    if (typeof miRelease === "function") miRelease(id);
    if (typeof rackVoiceRelease === "function") rackVoiceRelease(id);
    state.rack.selected = null;
    saveRack();
    renderRack();
    return;
  }
  const cable = event.target.closest("[data-cable]");
  if (cable) {
    const id = Number(cable.dataset.cable);
    state.rack.cables = state.rack.cables.filter((item) => item.id !== id);
    state.rack.arm = null;
    saveRack();
    renderRack();
    return;
  }
  const jack = event.target.closest("[data-rack-port]");
  if (!jack) return;
  const moduleId = Number(jack.dataset.rackModule);
  const port = jack.dataset.rackPort;
  const direction = jack.dataset.rackDir;
  if (direction === "out") {
    const same = state.rack.arm && state.rack.arm.module === moduleId && state.rack.arm.port === port;
    state.rack.arm = same ? null : { module: moduleId, port };
    renderRack();
    return;
  }
  if (state.rack.arm && state.rack.arm.module !== moduleId) connectRack(state.rack.arm, { module: moduleId, port });
  else if (!state.rack.arm && cableInto(moduleId, port)) {
    state.rack.cables = state.rack.cables.filter((item) => !(item.to.module === moduleId && item.to.port === port));
    saveRack();
    renderRack();
  }
});
$("rack-clear")?.addEventListener("click", () => {
  state.rack.cables = [];
  state.rack.arm = null;
  saveRack();
  renderRack();
});
$("rack-preset")?.addEventListener("change", () => {
  const name = $("rack-preset").value;
  const remove = $("rack-preset-delete");
  if (remove) remove.disabled = !name;
  const field = $("rack-preset-name");
  if (field) field.value = name;
  if (name) applyRackPreset(name);
});
$("rack-preset-save")?.addEventListener("click", () => {
  const field = $("rack-preset-name");
  const name = (field?.value || $("rack-preset")?.value || "").trim().slice(0, 24);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$/.test(name)) {
    field?.focus();
    return;
  }
  rememberPreset(name);
});
$("rack-preset-delete")?.addEventListener("click", () => {
  const name = $("rack-preset")?.value;
  if (!name) return;
  delete rackPresetCache[name];
  if (typeof removeRackPreset === "function") {
    removeRackPreset(name).catch((error) => setStatus(error.message, "error"));
  }
  const field = $("rack-preset-name");
  if (field) field.value = "";
  renderRackPresets();
});
function setRackZoom(next) {
  localStorage.setItem("blackseq.rackHp", String(Math.max(14, Math.min(24, next))));
  renderRack();
}
$("rack-zoom-out")?.addEventListener("click", () => setRackZoom(rackScale().hp - 2));
$("rack-zoom-in")?.addEventListener("click", () => setRackZoom(rackScale().hp + 2));
$("rack-bay")?.addEventListener("pointerdown", (event) => {
  const knob = event.target.closest("[data-rack-knob]");
  if (knob) {
    const module = moduleById(Number(knob.dataset.rackModule));
    if (event.altKey && typeof beginCcLearn === "function" && module) {
      beginCcLearn({
        kind: "rack",
        moduleId: module.id,
        param: knob.dataset.rackKnob,
        label: `${RACK_CATALOG[module.type]?.name || module.type} ${knob.dataset.rackKnob}`,
      });
      event.preventDefault();
      return;
    }
    rackDrag = { kind: "knob", module, param: knob.dataset.rackKnob, y: event.clientY, value: Number(module?.params[knob.dataset.rackKnob] ?? 0.5) };
    event.preventDefault();
    return;
  }
  if (event.target.closest("[data-rack-port], [data-rack-remove], [data-cable], [data-rack-button], [data-rack-toggle]")) return;
  const card = event.target.closest("[data-module-id]");
  const module = card && moduleById(Number(card.dataset.moduleId));
  if (!card) {
    selectRackModule(null);
    return;
  }
  if (!module || RACK_CATALOG[module.type].fixed) return;
  rackDrag = { kind: "move", module, x: event.clientX, y: event.clientY, originX: module.x, originY: module.y, card, moved: false };
});
window.addEventListener("pointermove", (event) => {
  if (!rackDrag) return;
  if (rackDrag.kind === "knob" && rackDrag.module) {
    const value = Math.max(0, Math.min(1, rackDrag.value + (rackDrag.y - event.clientY) / 140));
    rackDrag.module.params[rackDrag.param] = value;
    const knob = event.target.ownerDocument.querySelector(`[data-rack-module="${rackDrag.module.id}"][data-rack-knob="${rackDrag.param}"]`);
    if (knob) knob.style.transform = `rotate(${(value - 0.5) * 270}deg)`;
    if (rackDrag.module.type === "plaits" && typeof plaitsRefresh === "function") plaitsRefresh(rackDrag.module);
    if (rackDrag.module.type === "rings" && typeof ringsRefresh === "function") ringsRefresh(rackDrag.module);
    if (typeof miRefresh === "function") miRefresh(rackDrag.module, state.rack.lastSignals);
    if (typeof rackVoiceRefresh === "function") rackVoiceRefresh(rackDrag.module, state.rack.lastSignals);
    return;
  }
  if (rackDrag.kind !== "move") return;
  if (Math.abs(event.clientX - rackDrag.x) + Math.abs(event.clientY - rackDrag.y) > 3) rackDrag.moved = true;
  const scale = rackScale();
  const dx = Math.round((event.clientX - rackDrag.x) / scale.hp);
  const row = event.clientY - rackDrag.y > scale.row / 2 ? 1 : event.clientY - rackDrag.y < -scale.row / 2 ? 0 : rackDrag.originY;
  const hp = RACK_CATALOG[rackDrag.module.type].hp;
  let x = Math.max(0, Math.min(RACK_HP - hp, rackDrag.originX + dx));
  if (occupied(x, hp, row, rackDrag.module.id)) return;
  rackDrag.module.x = x;
  rackDrag.module.y = row;
  rackDrag.card.style.left = `${x * scale.hp}px`;
  rackDrag.card.style.top = `${row * (scale.row + 12)}px`;
  drawCables();
});
window.addEventListener("pointerup", () => {
  if (!rackDrag) return;
  const drag = rackDrag;
  rackDrag = null;
  if (drag.kind === "move" && !drag.moved) selectRackModule(drag.module.id);
  else saveRack();
});
window.addEventListener("resize", () => {
  if (!$("rack-view")?.hidden) drawCables();
});
