const FUNCTIONS = [
  ["notes", "Notes"],
  ["quantize", "Scale"],
  ["direction", "Direction"],
  ["gate", "Gate"],
  ["probability", "Probability"],
  ["ratchet", "Ratchet"],
  ["repeat", "Repeat"],
  ["glide", "Glide"],
  ["shuffle", "Shuffle"],
  ["timing", "Timing"],
  ["arp", "Arp"],
  ["mod", "Mod"],
];

const PROBABILITY = ["Always", "1/8", "1/7", "1/6", "1/5", "1/4", "1/3", "1/2", "2/3", "3/4", "7/8", "10%", "25%", "50%", "75%", "90%"];
const DIRECTIONS = [
  ["forward", "Forward"],
  ["backward", "Backward"],
  ["pingpong", "Ping-pong"],
  ["pingpong-ends", "Ping-pong, repeat the ends"],
  ["random", "Random"],
];
const LFO_SHAPES = ["Sine", "Triangle", "Ramp up", "Ramp down", "Square", "Triple decay saw", "Random", "Noise"];
const STEP_WAVES = ["Sine", "Triangle", "Saw up", "Saw down", "Square"];
const MOD_MODES = [
  ["stepped", "CV", "One value per step, from −100 to 100."],
  ["slide", "CV slide", "The same values, joined by a ramp."],
  ["notes", "CV note", "A second note. +C4 on the module is four octaves up."],
  ["decay", "Decay Env", "Time is 0–100. 100 lasts two steps. Level is the step level."],
  ["asr", "ASR Env", "Release is 0–100 and starts when the gate closes."],
  ["adsr", "ADSR Env", "Attack, decay, sustain, release, and level."],
  ["lfo", "LFO", "Rate, shape, level 0–100, and sync."],
  ["step-lfo", "Step LFO", "Wave and level on each step. Level is 0–100."],
  ["triggers", "Trigger", "A trigger on the steps you turn on."],
];

function perf(track) {
  if (!track.performance) {
    track.performance = {
      direction: "forward",
      first: 1,
      last: 64,
      root: null,
      probability: Array(64).fill("Always"),
      ratchet: Array(64).fill(0),
      repeat: Array(64).fill(0),
      repeatMerge: Array(64).fill(false),
      glideMaster: 0,
      glide: Array(64).fill(0),
      shuffle: 0,
      shuffleStep: ["+", "+", "+", "+"],
      timing: Array(64).fill(0),
      arp: Array(64).fill("Off"),
      modMode: "stepped",
      modVolt: Array(64).fill(0),
      modNote: Array(64).fill(0),
      decay: Array(64).fill(0),
      release: Array(64).fill(0),
      wave: Array(64).fill("Sine"),
      triggers: [true, ...Array(63).fill(false)],
      lfoLevel: Array(64).fill(0),
    };
  }
  return track.performance;
}

function rotateMask(mask, root) {
  let out = 0;
  for (let degree = 0; degree < 12; degree += 1) {
    if (mask & (1 << degree)) out |= 1 << ((degree + root) % 12);
  }
  return out & 0xfff;
}

function inferRoot(name, mask) {
  const scale = scaleByName(name);
  if (!scale) return 0;
  for (let root = 0; root < 12; root += 1) {
    if (rotateMask(scale.mask, root) === (mask & 0xfff)) return root;
  }
  return 0;
}

function functionOptions(selected, trackIndex) {
  const used = new Set(state.lanes[trackIndex]);
  return FUNCTIONS.map(([id, name]) => {
    const disabled = used.has(id) && id !== selected ? " disabled" : "";
    return `<option value="${id}"${id === selected ? " selected" : ""}${disabled}>${name}</option>`;
  }).join("");
}

const IS_APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "")
  || /Mac OS|iPhone|iPad|iPod/.test(navigator.userAgent || "");

function altClickLabel() {
  // Option on Apple keyboards; Alt elsewhere. event.altKey covers both.
  return IS_APPLE ? "Option-click" : "Alt-click";
}

const HINTS = {
  notes: "Scale opens scale settings. Clear and ±12 edit the notes on this channel.",
  quantize: "Input scale sets which notes you can enter. Root shifts that scale. Output can rewrite notes. NONE keeps the cents grid.",
  direction: "Play order and the first/last step window. Dimmed steps are outside the window.",
  gate: "Length is 0–100, stored on the card. 100 holds into the next step.",
  probability: "Pick a fraction or percent, then click or drag across steps.",
  ratchet: "2–8 repeats inside the step. Off is a single gate. Arpeggios need a ratchet.",
  glide: "Master glide is 0–100. Drag a step to set its glide.",
  shuffle: "Amount is for the whole track. Each of the four beat groups is off, late, or early.",
  timing: "Drag a step early or late. Track shuffle shows up here too.",
  arp: "Choose up or down and a scale, then paint steps. An arpeggio plays only on a ratcheted step.",
  mod: "Modulation output for this channel.",
};

function functionHint(fn) {
  if (fn === "repeat") {
    return `The step plays 2–8 times. ${altClickLabel()} a step for + hold — one gate across those repeats, same as pressing the encoder on the module.`;
  }
  return HINTS[fn] || "";
}

const WAVE_FACE = { Sine: "SI", Triangle: "TR", "Saw up": "SU", "Saw down": "SD", Square: "SQ" };
const COUNT_OPTIONS = [["0", "Off"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"]];

function openLane(trackIndex, fn) {
  const lanes = state.lanes[trackIndex];
  if (!lanes.includes(fn)) lanes.push(fn);
  state.laneOpen[trackIndex] = true;
  state.track = trackIndex;
  $("daw-rows").dataset.signature = "";
  syncInspector();
  if (fn === "notes") scrollRollIntoView();
  document.querySelector(`[data-lane-fn="${fn}"][data-lane-track="${trackIndex}"]`)?.scrollIntoView({ block: "nearest" });
}

function toggleLanes(index) {
  const lanes = state.lanes[index];
  if (state.laneOpen[index] && lanes.length) {
    state.laneOpen[index] = false;
  } else {
    if (!lanes.length) lanes.push("notes");
    state.laneOpen[index] = true;
  }
  state.track = index;
  $("daw-rows").dataset.signature = "";
  syncInspector();
  if (state.laneOpen[index] && lanes.includes("notes")) scrollRollIntoView();
}

function renderedLanes(index) {
  if (!state.laneOpen[index]) return "";
  return state.lanes[index].map((fn, lane) => `${laneChunk(index, lane)}${laneExtra(fn, index)}`).join("");
}

function laneExtra(fn, index) {
  if (fn === "notes") return notesLane(index);
  const mode = state.pattern.tracks[index].performance?.modMode || "stepped";
  if (fn === "mod" && mode === "notes") return modNotesLane(index);
  return "";
}

function laneChunk(index, lane) {
  const fn = state.lanes[index][lane];
  const full = state.lanes[index].length >= FUNCTIONS.length;
  const modMode = state.pattern.tracks[index].performance?.modMode || "stepped";
  // CV note: host is only the Output select; the piano roll expands in laneExtra.
  const slim = fn === "mod" && modMode === "notes" ? " lane-host-slim" : "";
  return `
    <div class="daw-row lane-host${slim}" data-lane-fn="${fn}" data-lane-track="${index}" style="--track:${TRACK_COLORS[index]}">
      <div class="head lane-label">
        <select data-lane-pick="${index}" data-lane-index="${lane}" aria-label="CH${index + 1} function" title="${escapeHtml(functionHint(fn))}">${functionOptions(fn, index)}</select>
        <button type="button" class="icon" data-add-lane="${index}" aria-label="Add another lane" title="Add a lane"${full ? " disabled" : ""}>+</button>
        <button type="button" class="icon close-lane" data-close-lane="${index}" data-lane-index="${lane}" aria-label="Close lane">×</button>
      </div>
      <div class="lane tool-lane">${laneTools(fn, index)}${laneBody(fn, index)}</div>
    </div>`;
}

function clearLaneButton(fn, index) {
  return `<button type="button" data-clear-lane="${fn}" data-track="${index}" title="Reset this lane to defaults">Clear</button>`;
}

function laneTools(fn, index) {
  const track = state.pattern.tracks[index];
  if (fn === "notes") {
    return `<div class="tool-bar">
      <button type="button" data-tool="quantize" data-track="${index}" title="Open Scale settings">Scale</button>
      ${clearLaneButton(fn, index)}
      <button type="button" data-tool="down" data-track="${index}" title="Transpose down one octave">−12</button>
      <button type="button" data-tool="up" data-track="${index}" title="Transpose up one octave">+12</button>
      <label title="Fine tune selected step">¢ <input data-cents="${index}" type="number" step="1"></label>
      <label title="Track CV offset">CV ${noteName(track.cvCents)} <input data-cv="${index}" type="number" step="100" value="${track.cvCents}"></label>
    </div>`;
  }
  if (fn === "quantize") {
    const root = inferRoot(track.inputScale, track.scaleMask);
    return `<div class="tool-bar">
      <label>Input <select data-input-scale="${index}">${scaleOptions(track.inputScale)}</select></label>
      <label>Root <select data-root="${index}">${NAMES.map((name, degree) => `<option value="${degree}"${degree === root ? " selected" : ""}>${name}</option>`).join("")}</select></label>
      <label>Output <select data-output-scale="${index}">${scaleOptions(track.outputScale)}</select></label>
      <button type="button" data-rewrite="${index}">Rewrite notes</button>
    </div>`;
  }
  if (fn === "direction") {
    const data = track.performance;
    const direction = data?.direction || "forward";
    const first = data?.first || 1;
    const last = data?.last || state.playLength || 64;
    return `<div class="tool-bar">
      <label>Play <select data-direction="${index}">${DIRECTIONS.map(([id, name]) => `<option value="${id}"${id === direction ? " selected" : ""}>${name}</option>`).join("")}</select></label>
      <label>First <input data-range="first" data-track="${index}" type="number" min="1" max="64" value="${first}"></label>
      <label>Last <input data-range="last" data-track="${index}" type="number" min="1" max="64" value="${last}"></label>
    </div>`;
  }
  if (fn === "gate") {
    return `<div class="tool-bar"><span class="tool-readout" data-readout="gate-index-${index}">Step 1 · off</span>${clearLaneButton(fn, index)}</div>`;
  }
  if (fn === "probability") return brushBar(index, "probability", "Chance", PROBABILITY.map((name) => [name, name]), clearLaneButton(fn, index));
  if (fn === "ratchet") return brushBar(index, "ratchet", "Count", COUNT_OPTIONS, clearLaneButton(fn, index));
  if (fn === "repeat") {
    return brushBar(
      index,
      "repeat",
      "Count",
      COUNT_OPTIONS,
      `${clearLaneButton(fn, index)}<span class="tool-note" title="${altClickLabel()} a step for hold (+), same as pressing the encoder on the module">${IS_APPLE ? "⌥" : "Alt"}+ hold</span>`,
    );
  }
  if (fn === "glide") {
    return `<div class="tool-bar"><label>Master <input data-glide-master="${index}" type="number" min="0" max="100" step="1" value="${track.performance?.glideMaster || 0}"></label><span class="tool-readout" data-tool-readout="glide-${index}"></span>${clearLaneButton(fn, index)}</div>`;
  }
  if (fn === "shuffle") return shuffleBar(index);
  if (fn === "timing") {
    return `<div class="tool-bar"><span class="tool-readout" data-tool-readout="timing-${index}"></span>${clearLaneButton(fn, index)}</div>`;
  }
  if (fn === "arp") return arpBar(index);
  if (fn === "mod") return modTools(index);
  return "";
}

function emptyPick(key) {
  if (key === "probability") return "Always";
  if (key === "triggers") return false;
  if (key === "wave") return "Sine";
  if (key === "ratchet" || key === "repeat") return 0;
  return "Off";
}

function brushBar(index, key, label, options, extra = "") {
  const current = String(state.brush[key]);
  const choices = options.map(([value, name]) => `<option value="${escapeHtml(String(value))}"${String(value) === current ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
  return `<div class="tool-bar"><label>${label} <select data-brush="${key}" aria-label="${label}">${choices}</select></label>${extra}<span class="tool-readout" data-tool-readout="${key}-${index}"></span></div>`;
}

function arpScales() {
  const names = (state.library?.scales || []).map((scale) => scale.name).filter((name) => name && name !== "NONE");
  return names.length ? names : ["CHROMATIC"];
}

function arpBar(index) {
  const scales = arpScales();
  if (!scales.includes(state.brush.arpScale)) state.brush.arpScale = scales[0];
  const seg = [["off", "Off"], ["up", "Up"], ["down", "Down"]].map(([value, name]) => (
    `<button type="button" data-brush="arpDir" data-value="${value}" class="${state.brush.arpDir === value ? "on" : ""}">${name}</button>`
  )).join("");
  const options = scales.map((name) => `<option${name === state.brush.arpScale ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
  const hasRatchet = (state.pattern.tracks[index].performance?.ratchet || []).some((count) => Number(count) > 0);
  const cue = hasRatchet
    ? ""
    : `<span class="tool-note warn" title="Open the Ratchet lane and paint a count on steps that should arpeggiate">Needs Ratchet</span>`;
  return `<div class="tool-bar">
    <div class="seg" role="group" aria-label="Arpeggio direction">${seg}</div>
    <label>Scale <select data-brush="arpScale" aria-label="Arpeggio scale">${options}</select></label>
    ${cue}
    <span class="tool-readout" data-tool-readout="arp-${index}"></span>
    ${clearLaneButton("arp", index)}
  </div>`;
}

function shuffleBar(index) {
  const steps = state.pattern.tracks[index].performance?.shuffleStep || ["+", "+", "+", "+"];
  const amount = state.pattern.tracks[index].performance?.shuffle || 0;
  const buttons = steps.map((value, step) => {
    const late = value === "+";
    const early = value === "−" || value === "-";
    const title = late ? "late" : early ? "early" : "off";
    const face = late ? "late" : early ? "early" : "off";
    return `<button type="button" data-shuffle-step="${index}" data-step="${step}" class="${title === "off" ? "" : "on"}" title="Beat group ${step + 1}: ${title}. Click to cycle.">${step + 1} ${face}</button>`;
  }).join("");
  return `<div class="tool-bar">
    <label>Amount <input data-shuffle="${index}" type="range" min="0" max="50" step="1" value="${amount}"></label>
    <div class="seg" role="group" aria-label="Four-step shuffle groups">${buttons}</div>
    ${clearLaneButton("shuffle", index)}
  </div>`;
}

function directionBody(index) {
  const data = state.pattern.tracks[index].performance || {};
  const first = Math.max(1, Math.min(64, Number(data.first) || 1));
  const last = Math.max(first, Math.min(64, Number(data.last) || state.playLength || 64));
  const zoom = state.zoom;
  const left = (first - 1) * zoom;
  const width = Math.max(zoom, (last - first + 1) * zoom);
  const right = Math.max(0, 64 * zoom - left - width);
  return `<div class="range-lane" data-range-track="${index}" style="width:${64 * zoom}px">
    <div class="range-dim" style="left:0;width:${left}px"></div>
    <div class="range-window" style="left:${left}px;width:${width}px"></div>
    <div class="range-dim" style="left:${left + width}px;width:${right}px"></div>
    <span class="range-label">Steps ${first}–${last}</span>
  </div>`;
}

function modTools(index) {
  const mode = state.pattern.tracks[index].performance?.modMode || "stepped";
  const info = MOD_MODES.find((item) => item[0] === mode) || MOD_MODES[0];
  const select = `<label>Output <select data-mod-mode="${index}" title="${escapeHtml(info[2])}">${MOD_MODES.map(([id, name]) => `<option value="${id}"${id === mode ? " selected" : ""}>${name}</option>`).join("")}</select></label>`;
  const clear = clearLaneButton("mod", index);
  if (mode === "lfo") {
    const footer = state.pattern.tracks[index].footer;
    const shape = Math.max(0, Math.min(LFO_SHAPES.length - 1, Math.round(readF32(footer, state.schema.lfoShapeOffset) * 7)));
    const sync = (footer[state.schema.lfoSyncOffset] || 0) !== 0;
    const level = Math.round(readF32(footer, state.schema.lfoLevelOffset) * 100);
    return `<div class="tool-bar">${select}
      <label>Rate <input data-float="${state.schema.lfoRateOffset}" data-track="${index}" type="number" min="0" max="1" step="0.01"></label>
      <label>Shape <select data-lfo-shape="${index}">${LFO_SHAPES.map((name, slot) => `<option value="${slot}"${slot === shape ? " selected" : ""}>${name}</option>`).join("")}</select></label>
      <label>Level <input data-lfo-amount="${index}" type="number" min="0" max="100" step="1" value="${level}"></label>
      <label class="check"><input data-lfo-sync="${index}" type="checkbox"${sync ? " checked" : ""}> Sync</label>
      ${clear}
    </div>`;
  }
  if (mode === "step-lfo") {
    return `<div class="tool-bar">${select}${brushSelect("wave", "Wave", STEP_WAVES.map((name) => [name, name]))}<span class="tool-readout" data-tool-readout="wave-${index}"></span>${clear}</div>`;
  }
  if (mode === "triggers") {
    const on = state.brush.triggers;
    return `<div class="tool-bar">${select}<div class="seg" role="group" aria-label="Trigger brush"><button type="button" data-brush="triggers" data-value="on" class="${on ? "on" : ""}">On</button><button type="button" data-brush="triggers" data-value="off" class="${on ? "" : "on"}">Off</button></div><span class="tool-readout" data-tool-readout="triggers-${index}"></span>${clear}</div>`;
  }
  if (mode === "adsr") return `<div class="tool-bar">${select}${clear}</div>`;
  if (mode === "stepped" || mode === "slide") {
    const volt = state.pattern.tracks[index].performance?.modVolt?.[state.step] || 0;
    return `<div class="tool-bar">${select}<span class="tool-readout" data-readout="volt-${index}">${voltReadout(state.step, volt)}</span>${clear}</div>`;
  }
  if (mode === "decay" || mode === "asr") {
    const key = mode === "asr" ? "release" : "decay";
    const name = mode === "asr" ? "Release" : "Decay";
    const value = state.pattern.tracks[index].performance?.[key]?.[state.step] || 0;
    return `<div class="tool-bar">${select}<span class="tool-readout" data-readout="${key}-${index}">${timeReadout(name, state.step, value / 50)}</span>${clear}</div>`;
  }
  if (mode === "notes") return `<div class="tool-bar">${select}${clear}</div>`;
  return `<div class="tool-bar">${select}${clear}</div>`;
}

function voltReadout(step, value) {
  const number = Math.round(Number(value) || 0);
  return `Step ${step + 1} · ${number > 0 ? "+" : ""}${number}`;
}

function timeReadout(name, step, value) {
  const time = Math.round((Number(value) || 0) * 4) / 4;
  const words = {
    0: "instant",
    0.25: "¼ step",
    0.5: "½ step",
    0.75: "¾ step",
    1: "1 step",
    1.25: "1¼ steps",
    1.5: "1½ steps",
    1.75: "1¾ steps",
    2: "2 steps",
  };
  return `${name} · Step ${step + 1} · ${words[time] || `${time} steps`}`;
}

function brushSelect(key, label, options) {
  const current = String(state.brush[key]);
  const choices = options.map(([value, name]) => `<option value="${escapeHtml(String(value))}"${String(value) === current ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
  return `<label>${label} <select data-brush="${key}" aria-label="${label}">${choices}</select></label>`;
}

function encoderSliders(index) {
  const names = ["A", "D", "S", "R", "Lvl"];
  const titles = ["Attack", "Decay", "Sustain", "Release", "Level"];
  return `<div class="mod-controls">${state.schema.adsrOffsets.map((offset, slot) => `
    <label title="${titles[slot]}">${names[slot]} <input data-float="${offset}" data-track="${index}" type="range" min="0" max="1" step="0.01" aria-label="${titles[slot]}"></label>
  `).join("")}</div>`;
}

function laneBody(fn, index) {
  if (fn === "gate") return `<canvas class="bars" data-kind="gate-index" data-track="${index}" aria-label="CH${index + 1} gate length"></canvas>`;
  if (fn === "probability") return pickRow(index, "probability");
  if (fn === "ratchet") return pickRow(index, "ratchet");
  if (fn === "repeat") return pickRow(index, "repeat");
  if (fn === "glide") return `<canvas class="bars" data-kind="glide" data-track="${index}" aria-label="CH${index + 1} glide"></canvas>`;
  if (fn === "timing") return `<canvas class="bars" data-kind="timing" data-track="${index}" aria-label="CH${index + 1} microtiming"></canvas>`;
  if (fn === "arp") return pickRow(index, "arp");
  if (fn === "direction") return directionBody(index);
  if (fn === "quantize") return `<div class="degrees" data-degrees="${index}" title="Lit degrees are in the input scale"></div>`;
  if (fn === "mod") return modBody(index);
  return "";
}

function notesLane(index) {
  return rollLane(index, "notes", String(index), `CH${index + 1} piano roll`, 280);
}

function modNotesLane(index) {
  // Secondary CV-note roll — start compact; drag the resize handle to grow.
  return rollLane(index, "mod-note", `m${index}`, `CH${index + 1} note CV`, 160);
}

function rollLane(index, kind, scrollId, label, rollH = 280) {
  return `<div class="daw-row notes-row" data-lane-fn="${kind}" data-lane-track="${index}" style="--track:${TRACK_COLORS[index]}; --roll-h: ${rollH}px">
      <div class="head key-scroll" data-keys="${scrollId}">${keyMarkup()}</div>
      <div class="lane note-scroll" data-note-scroll="${scrollId}">
        <canvas class="grid" data-kind="${kind}" data-track="${index}" aria-label="${label}"></canvas>
      </div>
      <div class="roll-resize" data-roll-resize="${scrollId}" title="Drag to resize piano roll"></div>
    </div>`;
}

function scrollModRoll(index) {
  const scroller = document.querySelector(`[data-note-scroll="m${index}"]`);
  if (!scroller) return;
  const notes = (state.pattern.tracks[index].performance?.modNote || []).filter((note) => note);
  const center = notes.length ? Math.round(notes.reduce((sum, note) => sum + note, 0) / notes.length / 100) : 60;
  scroller.scrollTop = Math.max(0, (HIGH - center) * CELL_H - 80);
}

function paintMod(step, cents) {
  perf(currentTrack()).modNote[step] = cents;
  state.step = step;
  markPerformance();
  draw();
}

function pickValues(track, key) {
  const stored = track.performance?.[key];
  if (stored) return stored;
  if (key === "triggers") return [true, ...Array(63).fill(false)];
  if (key === "ratchet" || key === "repeat") return Array(64).fill(0);
  if (key === "wave") return Array(64).fill("Sine");
  if (key === "arp") return Array(64).fill("Off");
  return Array(64).fill("Always");
}

function pickRow(index, key) {
  const values = pickValues(state.pattern.tracks[index], key);
  return `<div class="step-picks" data-pick="${key}" data-track="${index}">${values.map((value, step) => pickButton(key, value, step, index)).join("")}</div>`;
}

function pickButton(key, value, step, trackIndex) {
  const face = pickFace(key, value, step, trackIndex);
  const meter = key === "probability" && value && value !== "Always"
    ? `<span class="meter" style="height:${Math.round(probabilityAmount(value) * 100)}%"></span>` : "";
  const label = face ? `<span class="cell-label">${escapeHtml(face)}</span>` : "";
  const current = step === state.step ? " current" : "";
  const beyond = step >= state.playLength ? " beyond" : "";
  const merged = key === "repeat" && Number(value) && state.pattern.tracks[trackIndex]?.performance?.repeatMerge?.[step];
  return `<button type="button" class="${pickClass(key, value)}${merged ? " merged" : ""}${current}${beyond}" data-step="${step}" data-value-key="${escapeHtml(String(value))}" title="${escapeHtml(pickTitle(key, value, step, trackIndex))}">${meter}${label}</button>`;
}

function pickClass(key, value) {
  const text = String(value);
  if (key === "arp") {
    if (text.startsWith("+")) return "set";
    if (text.startsWith("−") || text.startsWith("-")) return "arp-down";
    return "";
  }
  if (key === "triggers") return value ? "set" : "";
  if (key === "probability") return value && value !== "Always" ? "metered" : "";
  if (key === "ratchet" || key === "repeat") return Number(value) ? "set" : "";
  if (key === "wave") return "set";
  return "";
}

function pickFace(key, value, step = 0, trackIndex = state.track) {
  const text = String(value ?? "");
  if (key === "arp") {
    if (text.startsWith("+")) return "▲";
    if (text.startsWith("−") || text.startsWith("-")) return "▼";
    return "";
  }
  if (key === "ratchet") return Number(value) ? String(value) : "";
  if (key === "repeat") {
    const count = Number(value);
    if (!count) return "";
    const merged = state.pattern.tracks[trackIndex]?.performance?.repeatMerge?.[step];
    return merged ? `${count}+` : String(count);
  }
  if (key === "wave") return WAVE_FACE[text] || text.slice(0, 2);
  if (key === "probability" && text && text !== "Always" && state.zoom >= 24) return text.replace("%", "");
  return "";
}

function probabilityAmount(value) {
  const text = String(value);
  if (text === "Always") return 1;
  if (text.endsWith("%")) return Number.parseFloat(text) / 100;
  const [num, den] = text.split("/").map(Number);
  return den ? num / den : 0;
}

function pickLabel(key, value, step = 0, trackIndex = state.track) {
  if (key === "arp") return arpPhrase(value);
  if (key === "triggers") return value ? "On" : "Off";
  if (key === "ratchet") return Number(value) ? String(value) : "Off";
  if (key === "repeat") {
    const count = Number(value);
    if (!count) return "Off";
    const merged = state.pattern.tracks[trackIndex]?.performance?.repeatMerge?.[step];
    return merged ? `${count}+ hold` : String(count);
  }
  return String(value || "Always");
}

function pickTitle(key, value, step, trackIndex) {
  if (key === "repeat") {
    const count = Number(value);
    if (!count) return `Step ${step + 1}: Off`;
    const merged = state.pattern.tracks[trackIndex]?.performance?.repeatMerge?.[step];
    return merged
      ? `Step ${step + 1}: ${count}+ (one held gate). ${altClickLabel()} to toggle`
      : `Step ${step + 1}: ${count}. ${altClickLabel()} for hold (+)`;
  }
  return `Step ${step + 1}: ${pickLabel(key, value, step, trackIndex)}`;
}

function arpPhrase(value) {
  const text = String(value || "Off");
  if (text === "Off") return "Off";
  const down = text.startsWith("−") || text.startsWith("-");
  return `${down ? "Down" : "Up"} · ${text.slice(1)}`;
}

function modBody(index) {
  const mode = state.pattern.tracks[index].performance?.modMode || "stepped";
  if (mode === "stepped" || mode === "slide") {
    return `<canvas class="bars" data-kind="volt" data-track="${index}" aria-label="CH${index + 1} modulation voltage"></canvas>`;
  }
  // CV note: piano roll expands below via laneExtra — keep this host row empty.
  if (mode === "notes") return "";
  if (mode === "decay") {
    return `<canvas class="tails" data-kind="decay" data-track="${index}" title="Drag right from a step. 100 lasts two steps." aria-label="Decay time, 0 to 100"></canvas>`;
  }
  if (mode === "asr") {
    return `<canvas class="tails" data-kind="release" data-track="${index}" title="Flat line is the gate; drag from where it ends. 100 lasts two steps." aria-label="Release time, 0 to 100"></canvas>`;
  }
  if (mode === "adsr") {
    return `<div class="mod-adsr" title="Attack, decay, sustain, release, level — each 0 to full">${encoderSliders(index)}<svg class="envelope" data-envelope="${index}" viewBox="0 0 120 48" aria-label="ADSR envelope"></svg></div>`;
  }
  if (mode === "lfo") return `<canvas class="wave" data-kind="lfo" data-track="${index}" aria-label="LFO wave"></canvas>`;
  if (mode === "step-lfo") {
    return `${pickRow(index, "wave")}<canvas class="bars" data-kind="lfo-level" data-track="${index}" title="Level 0–100, shared with note level" aria-label="Step LFO level, 0 to 100"></canvas>`;
  }
  if (mode === "triggers") {
    return pickRow(index, "triggers");
  }
  return "";
}

function paintFunctionCanvases() {
  document.querySelectorAll("canvas[data-kind=volt]").forEach((canvas) => {
    const slide = state.pattern.tracks[Number(canvas.dataset.track)].performance?.modMode === "slide";
    paintSeries(canvas, (track, step) => ((track.performance?.modVolt[step] || 0) + 100) / 200, TRACK_COLORS[Number(canvas.dataset.track)], slide ? "slide" : "bipolar");
  });
  document.querySelectorAll("canvas[data-kind=glide]").forEach((canvas) => paintSeries(canvas, (track, step) => (track.performance?.glide[step] || 0) / 100, TRACK_COLORS[Number(canvas.dataset.track)]));
  document.querySelectorAll("canvas[data-kind=decay]").forEach((canvas) => paintTails(canvas, "decay"));
  document.querySelectorAll("canvas[data-kind=release]").forEach((canvas) => paintTails(canvas, "release"));
  document.querySelectorAll("canvas[data-kind=timing]").forEach((canvas) => paintSeries(canvas, (track, step) => ((track.performance?.timing[step] || 0) + 50) / 100, TRACK_COLORS[Number(canvas.dataset.track)], "bipolar"));
  document.querySelectorAll("canvas[data-kind=lfo-level]").forEach((canvas) => paintSeries(canvas, (track, step) => (track.steps[step][state.schema.levelOffset] || 0) / 100, TRACK_COLORS[Number(canvas.dataset.track)]));
  document.querySelectorAll("canvas[data-kind=lfo]").forEach((canvas) => paintLfo(canvas, Number(canvas.dataset.track)));
  refreshPicks();
}

function paintSeries(canvas, read, color, mode) {
  const height = Math.max(24, Math.round(canvas.clientHeight) || 44);
  const ctx = sizeCanvas(canvas, height, true);
  ctx.fillStyle = CANVAS;
  ctx.fillRect(0, 0, 64 * state.zoom, height);
  const track = state.pattern.tracks[Number(canvas.dataset.track)];
  if (mode === "bipolar") {
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(0, height / 2, 64 * state.zoom, 1);
  }
  if (mode === "slide") {
    ctx.beginPath();
    for (let step = 0; step < 64; step += 1) {
      const y = height - read(track, step) * (height - 4) - 2;
      const x = step * state.zoom + state.zoom / 2;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.stroke();
    return;
  }
  for (let step = 0; step < 64; step += 1) {
    const amount = Math.max(0, Math.min(1, read(track, step)));
    ctx.fillStyle = color;
    ctx.globalAlpha = step >= state.playLength ? 0.35 : 1;
    if (mode === "bipolar") {
      const y = height - amount * (height - 4) - 2;
      const mid = height / 2;
      ctx.fillRect(step * state.zoom + 1, Math.min(y, mid), Math.max(1, state.zoom - 2), Math.max(1, Math.abs(mid - y)));
    } else {
      const bar = amount * (height - 4);
      ctx.fillRect(step * state.zoom + 1, height - bar - 2, Math.max(1, state.zoom - 2), bar);
    }
  }
  ctx.globalAlpha = 1;
}

function writeTail(kind, trackIndex, step, event, canvas) {
  const data = perf(state.pattern.tracks[trackIndex]);
  const time = tailLength(event, canvas, step);
  data[kind][step] = Math.round(time * 50);
  state.step = step;
  markPerformance();
  const readout = document.querySelector(`[data-readout="${kind}-${trackIndex}"]`);
  if (readout) readout.textContent = timeReadout(kind === "release" ? "Release" : "Decay", step, time);
}

function beginFunctionDrag(event, canvas) {
  const kind = canvas.dataset.kind;
  const known = ["volt", "glide", "decay", "release", "timing", "lfo-level"];
  if (!known.includes(kind)) return false;
  const hit = canvasStep(event, canvas);
  if (!hit) return false;
  state.track = Number(canvas.dataset.track);
  pushUndo();
  if (kind === "decay" || kind === "release") {
    state.gesture = { fn: kind, track: state.track, step: hit.step };
    writeTail(kind, state.track, hit.step, event, canvas);
    draw();
    return true;
  }
  state.gesture = { fn: kind, track: state.track };
  writeFunctionValue(kind, state.track, hit.step, event, canvas);
  return true;
}

function moveFunctionDrag(event) {
  const canvas = document.querySelector(`canvas[data-kind="${state.gesture.fn}"][data-track="${state.gesture.track}"]`);
  if (!canvas) return;
  if (state.gesture.fn === "decay" || state.gesture.fn === "release") {
    writeTail(state.gesture.fn, state.gesture.track, state.gesture.step, event, canvas);
    draw();
    return;
  }
  const hit = barValue(event, canvas, 1000);
  if (!hit) return;
  writeFunctionValue(state.gesture.fn, state.gesture.track, hit.step, event, canvas);
  draw();
}

function writeFunctionValue(kind, trackIndex, step, event, canvas) {
  const track = state.pattern.tracks[trackIndex];
  const data = perf(track);
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
  if (kind === "volt") data.modVolt[step] = Math.round(ratio * 200 - 100);
  if (kind === "glide") data.glide[step] = Math.round(ratio * 100);
  if (kind === "timing") data.timing[step] = Math.round(ratio * 100 - 50);
  if (kind === "lfo-level") track.steps[step][state.schema.levelOffset] = Math.round(ratio * 100);
  state.step = step;
  markPerformance();
  const readout = document.querySelector(`[data-readout="volt-${trackIndex}"]`);
  if (readout && kind === "volt") readout.textContent = voltReadout(step, data.modVolt[step]);
}

function brushValue(key) {
  if (key === "arp") {
    if (state.brush.arpDir === "off") return "Off";
    return `${state.brush.arpDir === "down" ? "−" : "+"}${state.brush.arpScale}`;
  }
  if (key === "triggers") return Boolean(state.brush.triggers);
  if (key === "ratchet" || key === "repeat") return Number(state.brush[key]);
  return state.brush[key];
}

function stylePick(button, key, value, step, trackIndex = state.track) {
  const face = pickFace(key, value, step, trackIndex);
  const meter = key === "probability" && value && value !== "Always"
    ? `<span class="meter" style="height:${Math.round(probabilityAmount(value) * 100)}%"></span>` : "";
  const label = face ? `<span class="cell-label">${escapeHtml(face)}</span>` : "";
  const current = step === state.step ? " current" : "";
  const beyond = step >= state.playLength ? " beyond" : "";
  const merged = key === "repeat" && Number(value) && state.pattern.tracks[trackIndex]?.performance?.repeatMerge?.[step];
  button.className = `${pickClass(key, value)}${merged ? " merged" : ""}${current}${beyond}`.trim();
  button.dataset.valueKey = String(value);
  button.title = pickTitle(key, value, step, trackIndex);
  button.innerHTML = `${meter}${label}`;
}

function applyBrush(box, step, value) {
  const key = box.dataset.pick;
  const trackIndex = Number(box.dataset.track);
  const data = perf(state.pattern.tracks[trackIndex]);
  const written = value === undefined ? brushValue(key) : value;
  if (data[key][step] !== written) {
    data[key][step] = written;
    if (key === "repeat" && !Number(written)) data.repeatMerge[step] = false;
    markPerformance();
  }
  state.step = step;
  state.track = trackIndex;
  const button = box.querySelector(`:scope > button[data-step="${step}"]`);
  if (button) stylePick(button, key, data[key][step], step, trackIndex);
  box.querySelectorAll(":scope > button.current").forEach((node) => {
    if (node !== button) node.classList.remove("current");
  });
  const readout = document.querySelector(`[data-tool-readout="${key}-${trackIndex}"]`);
  if (readout) readout.textContent = toolReadout(key, trackIndex, step);
}

function clearPickLane(key, trackIndex) {
  const data = perf(state.pattern.tracks[trackIndex]);
  data[key] = Array(64).fill(emptyPick(key));
  if (key === "repeat") data.repeatMerge = Array(64).fill(false);
  if (key === "triggers") data.triggers = [true, ...Array(63).fill(false)];
}

function clearLane(fn, trackIndex) {
  if (!state.pattern) return;
  state.track = trackIndex;
  const track = state.pattern.tracks[trackIndex];
  const data = perf(track);
  if (fn === "notes") {
    clearNotes();
    return;
  }
  pushUndo();
  if (fn === "gate") {
    track.steps.forEach((step) => writeU32(step, state.schema.gateOffset, 50));
  } else if (fn === "probability" || fn === "ratchet" || fn === "repeat" || fn === "arp") {
    clearPickLane(fn, trackIndex);
  } else if (fn === "glide") {
    data.glideMaster = 0;
    data.glide = Array(64).fill(0);
  } else if (fn === "shuffle") {
    data.shuffle = 0;
    data.shuffleStep = ["+", "+", "+", "+"];
  } else if (fn === "timing") {
    data.timing = Array(64).fill(0);
  } else if (fn === "mod") {
    clearModLane(track, data);
  }
  markPerformance();
  $("daw-rows").dataset.signature = "";
  syncInspector();
  draw();
  renderPads();
}

function clearModLane(track, data) {
  const mode = data.modMode || "stepped";
  const footer = track.footer;
  if (mode === "stepped" || mode === "slide") data.modVolt = Array(64).fill(0);
  else if (mode === "notes") data.modNote = Array(64).fill(0);
  else if (mode === "decay") data.decay = Array(64).fill(0);
  else if (mode === "asr") data.release = Array(64).fill(0);
  else if (mode === "adsr") {
    const defaults = [0, 0.1, 0.5, 0.1, 1];
    state.schema.adsrOffsets.forEach((offset, slot) => writeF32(footer, offset, defaults[slot]));
  } else if (mode === "lfo") {
    writeF32(footer, state.schema.lfoRateOffset, 0);
    writeF32(footer, state.schema.lfoShapeOffset, 0);
    writeF32(footer, state.schema.lfoLevelOffset, 1);
    footer[state.schema.lfoSyncOffset] = 0;
  } else if (mode === "step-lfo") {
    data.wave = Array(64).fill("Sine");
    track.steps.forEach((step) => {
      step[state.schema.levelOffset] = 100;
    });
  } else if (mode === "triggers") {
    clearPickLane("triggers", state.track);
  }
}

function toolReadout(key, index, step) {
  const track = state.pattern.tracks[index];
  if (!track) return "";
  if (key === "glide") return `Step ${step + 1} · ${Math.round(track.performance?.glide?.[step] || 0)}`;
  if (key === "timing") {
    const value = track.performance?.timing?.[step] || 0;
    if (!value) return `Step ${step + 1} · 0`;
    return `Step ${step + 1} · ${value > 0 ? "+" : "−"}${Math.abs(value)}`;
  }
  return `Step ${step + 1} · ${pickLabel(key, pickValues(track, key)[step], step, index)}`;
}

function refreshReadouts() {
  document.querySelectorAll("[data-tool-readout]").forEach((node) => {
    const match = node.dataset.toolReadout.match(/^(.*)-(\d+)$/);
    if (!match) return;
    node.textContent = toolReadout(match[1], Number(match[2]), state.step);
  });
}

function refreshPicks() {
  if (!state.pattern) return;
  document.querySelectorAll("[data-pick]").forEach((box) => {
    const key = box.dataset.pick;
    const values = pickValues(state.pattern.tracks[Number(box.dataset.track)], key);
    box.querySelectorAll(":scope > button[data-step]").forEach((button) => {
      const step = Number(button.dataset.step);
      const value = values[step];
      const current = step === state.step;
      const beyond = step >= state.playLength;
      if (button.dataset.valueKey === String(value) && button.classList.contains("current") === current && button.classList.contains("beyond") === beyond) return;
      stylePick(button, key, value, step);
    });
  });
  if (!state.playing) refreshReadouts();
}

function bindFunctionLanes() {
  const root = $("daw-rows");
  if (!root || root.dataset.functionsBound) return;
  root.dataset.functionsBound = "1";
  root.addEventListener("click", (event) => {
    const disclose = event.target.closest("[data-disclose]");
    if (disclose && state.pattern) {
      toggleLanes(Number(disclose.dataset.disclose));
      return;
    }
    const brushButton = event.target.closest("[data-brush][data-value]");
    if (brushButton) {
      const key = brushButton.dataset.brush;
      state.brush[key] = key === "triggers" ? brushButton.dataset.value === "on" : brushButton.dataset.value;
      brushButton.parentElement.querySelectorAll("[data-value]").forEach((node) => node.classList.toggle("on", node === brushButton));
      return;
    }
    const add = event.target.closest("[data-add-lane]");
    if (add && state.pattern) {
      const index = Number(add.dataset.addLane);
      const lanes = state.lanes[index];
      const next = FUNCTIONS.find(([id]) => !lanes.includes(id));
      if (next) openLane(index, next[0]);
      return;
    }
    const close = event.target.closest("[data-close-lane]");
    if (close) {
      const index = Number(close.dataset.closeLane);
      state.lanes[index].splice(Number(close.dataset.laneIndex), 1);
      if (!state.lanes[index].length) state.laneOpen[index] = false;
      root.dataset.signature = "";
      syncInspector();
      return;
    }
    const clear = event.target.closest("[data-clear-lane]");
    if (clear && state.pattern) {
      clearLane(clear.dataset.clearLane, Number(clear.dataset.track));
      return;
    }
    const rewrite = event.target.closest("[data-rewrite]");
    if (rewrite) {
      state.track = Number(rewrite.dataset.rewrite);
      rewriteNotes(currentTrack());
      return;
    }
    const shuffleStep = event.target.closest("[data-shuffle-step]");
    if (shuffleStep) {
      const data = perf(state.pattern.tracks[Number(shuffleStep.dataset.shuffleStep)]);
      const order = ["off", "+", "−"];
      const step = Number(shuffleStep.dataset.step);
      const current = data.shuffleStep[step] === "-" ? "−" : data.shuffleStep[step];
      pushUndo();
      data.shuffleStep[step] = order[(Math.max(0, order.indexOf(current)) + 1) % order.length];
      spreadShuffle(data);
      const value = data.shuffleStep[step];
      const face = value === "+" ? "late" : value === "−" ? "early" : "off";
      shuffleStep.textContent = `${step + 1} ${face}`;
      shuffleStep.classList.toggle("on", value !== "off");
      shuffleStep.title = `Beat group ${step + 1}: ${face}. Click to cycle.`;
      markPerformance();
      return;
    }
  });
  root.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-pick] button[data-step]");
    if (!button || (event.button !== 0 && event.button !== 2) || !state.pattern) return;
    const box = button.closest("[data-pick]");
    if (!box) return;
    event.preventDefault();
    pushUndo();
    const step = Number(button.dataset.step);
    const trackIndex = Number(box.dataset.track);
    // Alt-click on Repeat toggles the hardware "+" hold-across-repeats mark.
    if (event.button === 0 && event.altKey && box.dataset.pick === "repeat") {
      const data = perf(state.pattern.tracks[trackIndex]);
      if (!Number(data.repeat[step])) data.repeat[step] = Number(state.brush.repeat) || 2;
      data.repeatMerge[step] = !data.repeatMerge[step];
      state.step = step;
      state.track = trackIndex;
      stylePick(button, "repeat", data.repeat[step], step, trackIndex);
      const readout = document.querySelector(`[data-tool-readout="repeat-${trackIndex}"]`);
      if (readout) readout.textContent = toolReadout("repeat", trackIndex, step);
      markPerformance();
      return;
    }
    const erase = event.button === 2;
    state.gesture = { kind: "pick", key: box.dataset.pick, track: trackIndex, step, erase, pointerId: event.pointerId };
    box.setPointerCapture?.(event.pointerId);
    applyBrush(box, step, erase ? emptyPick(box.dataset.pick) : undefined);
  });
  root.addEventListener("contextmenu", (event) => {
    if (event.target.closest("[data-pick]")) event.preventDefault();
  });
  root.addEventListener("pointerover", (event) => {
    if (state.gesture?.kind === "pick") return;
    const button = event.target.closest("[data-pick] button[data-step]");
    if (!button) return;
    const box = button.closest("[data-pick]");
    const node = document.querySelector(`[data-tool-readout="${box.dataset.pick}-${box.dataset.track}"]`);
    if (node) node.textContent = toolReadout(box.dataset.pick, Number(box.dataset.track), Number(button.dataset.step));
  });
  root.addEventListener("pointerout", (event) => {
    const box = event.target.closest?.("[data-pick]");
    if (!box || box.contains(event.relatedTarget) || state.gesture?.kind === "pick") return;
    const node = document.querySelector(`[data-tool-readout="${box.dataset.pick}-${box.dataset.track}"]`);
    if (node) node.textContent = toolReadout(box.dataset.pick, Number(box.dataset.track), state.step);
  });
  const endPick = (event) => {
    if (state.gesture?.kind !== "pick") return;
    if (event?.pointerId != null && state.gesture.pointerId != null && event.pointerId !== state.gesture.pointerId) return;
    state.gesture = null;
    placeChrome();
  };
  window.addEventListener("pointerup", endPick);
  window.addEventListener("pointercancel", endPick);
  window.addEventListener("pointermove", (event) => {
    if (state.gesture?.kind !== "pick") return;
    if (!event.buttons) {
      endPick(event);
      return;
    }
    const box = document.querySelector(`[data-pick="${state.gesture.key}"][data-track="${state.gesture.track}"]`);
    if (!box) return;
    const rect = box.getBoundingClientRect();
    if (event.clientY < rect.top - 8 || event.clientY > rect.bottom + 8) return;
    const step = Math.floor((event.clientX - rect.left) / state.zoom);
    if (step < 0 || step > 63 || step === state.gesture.step) return;
    state.gesture.step = step;
    applyBrush(box, step, state.gesture.erase ? emptyPick(state.gesture.key) : undefined);
  });
  root.addEventListener("change", (event) => {
    const brush = event.target.closest("select[data-brush]");
    if (brush) {
      state.brush[brush.dataset.brush] = brush.value;
      return;
    }
    const pick = event.target.closest("[data-lane-pick]");
    if (pick) {
      const lanes = state.lanes[Number(pick.dataset.lanePick)];
      lanes[Number(pick.dataset.laneIndex)] = pick.value;
      root.dataset.signature = "";
      syncInspector();
      return;
    }
    const rootNote = event.target.closest("[data-root]");
    if (rootNote) {
      state.track = Number(rootNote.dataset.root);
      pushUndo();
      const track = currentTrack();
      const scale = scaleByName(track.inputScale);
      if (!scale) return;
      const mask = rotateMask(scale.mask, Number(rootNote.value));
      track.footer[state.schema.scaleMaskOffset] = mask & 255;
      track.footer[state.schema.scaleMaskOffset + 1] = (mask >> 8) & 255;
      track.scaleMask = mask;
      perf(track).root = Number(rootNote.value);
      state.dirty = true;
      syncInspector();
      renderPads();
      return;
    }
    const direction = event.target.closest("[data-direction]");
    if (direction) {
      perf(state.pattern.tracks[Number(direction.dataset.direction)]).direction = direction.value;
      markPerformance();
      return;
    }
    const mode = event.target.closest("[data-mod-mode]");
    if (mode) {
      const trackIndex = Number(mode.dataset.modMode);
      const data = perf(state.pattern.tracks[trackIndex]);
      data.modMode = mode.value;
      if (mode.value === "decay" || mode.value === "asr") {
        const key = mode.value === "decay" ? "decay" : "release";
        data[key] = state.pattern.tracks[trackIndex].steps.map((step) => step[26]);
      }
      markPerformance();
      root.dataset.signature = "";
      syncInspector();
      if (mode.value === "notes") scrollModRoll(trackIndex);
      return;
    }
    const shape = event.target.closest("[data-lfo-shape]");
    if (shape) {
      state.track = Number(shape.dataset.lfoShape);
      pushUndo();
      writeF32(currentTrack().footer, state.schema.lfoShapeOffset, Number(shape.value) / 7);
      state.dirty = true;
      renderPads();
      draw();
    }
  });
  root.addEventListener("input", (event) => {
    const range = event.target.closest("[data-range]");
    if (range) {
      const trackIndex = Number(range.dataset.track);
      const data = perf(state.pattern.tracks[trackIndex]);
      data[range.dataset.range] = Math.max(1, Math.min(64, Number(range.value) || 1));
      if (data.first > data.last) {
        if (range.dataset.range === "first") data.last = data.first;
        else data.first = data.last;
      }
      markPerformance();
      const host = document.querySelector(`[data-lane-fn="direction"][data-lane-track="${trackIndex}"] .tool-lane .range-lane`);
      if (host) {
        const next = document.createElement("div");
        next.innerHTML = directionBody(trackIndex);
        host.replaceWith(next.firstElementChild);
      }
    }
    const glide = event.target.closest("[data-glide-master]");
    if (glide) {
      perf(state.pattern.tracks[Number(glide.dataset.glideMaster)]).glideMaster = Number(glide.value);
      markPerformance();
    }
    const shuffle = event.target.closest("[data-shuffle]");
    if (shuffle) {
      const data = perf(state.pattern.tracks[Number(shuffle.dataset.shuffle)]);
      data.shuffle = Number(shuffle.value);
      spreadShuffle(data);
      markPerformance();
    }
    const level = event.target.closest("[data-lfo-amount]");
    if (level) {
      state.track = Number(level.dataset.lfoAmount);
      writeF32(currentTrack().footer, state.schema.lfoLevelOffset, Math.max(0, Math.min(100, Number(level.value) || 0)) / 100);
      state.dirty = true;
      renderPads();
      draw();
    }
    const sync = event.target.closest("[data-lfo-sync]");
    if (sync) {
      state.track = Number(sync.dataset.lfoSync);
      currentTrack().footer[state.schema.lfoSyncOffset] = sync.checked ? 6 : 0;
      state.dirty = true;
      renderPads();
      draw();
    }
  });
}

function rewriteNotes(track) {
  if (track.outputScale === "NONE") return;
  const scale = scaleByName(track.outputScale);
  const mask = scale ? scale.mask : 0xfff;
  pushUndo();
  for (let step = 0; step < 63; step += 1) {
    const cents = noteOf(track, step);
    if (!cents || isMarker(track, step)) continue;
    const semitone = Math.round(cents / 100);
    let best = semitone;
    let bestDistance = 99;
    for (let delta = -6; delta <= 6; delta += 1) {
      const candidate = semitone + delta;
      const degree = ((candidate % 12) + 12) % 12;
      if ((mask & (1 << degree)) === 0) continue;
      const distance = Math.abs(candidate * 100 - cents);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    writeNote(step, best * 100);
  }
  syncInspector();
  draw();
  renderPads();
}

function playStep(track, index, length) {
  const data = track.performance;
  if (!data) return index % length;
  const first = Math.max(0, Math.min(length - 1, data.first - 1));
  const last = Math.min(length, Math.max(first + 1, data.last));
  const span = last - first;
  const local = index % span;
  if (data.direction === "backward") return last - 1 - local;
  if (data.direction === "random") return first + Math.floor(Math.random() * span);
  if (data.direction === "pingpong" || data.direction === "pingpong-ends") {
    const trip = Math.max(1, span * 2 - (data.direction === "pingpong-ends" ? 0 : 2));
    const pos = index % trip;
    return pos < span ? first + pos : first + (trip - pos);
  }
  return first + local;
}

function spreadShuffle(data) {
  const amount = Math.max(0, Math.min(50, Math.round(Number(data.shuffle) || 0)));
  for (let step = 0; step < 64; step += 1) {
    const sign = data.shuffleStep[step % 4];
    if (sign === "off") data.timing[step] = 0;
    else if (sign === "−" || sign === "-") data.timing[step] = -amount;
    else data.timing[step] = amount;
  }
}

function chanceAllows(track, step) {
  const value = track.performance?.probability?.[step] || "Always";
  if (value === "Always") return true;
  if (!track.performance.visits) track.performance.visits = Array(64).fill(0);
  const visit = track.performance.visits[step];
  track.performance.visits[step] += 1;
  if (value.endsWith("%")) return Math.random() * 100 < Number.parseFloat(value);
  const [num, den] = value.split("/").map(Number);
  if (!den) return true;
  return visit % den < num;
}

function ratchetCount(track, step) {
  return track.performance?.ratchet?.[step] || 1;
}

