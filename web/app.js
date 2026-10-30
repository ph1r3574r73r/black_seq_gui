const CELL_W = 18;
const CELL_H = 16;
const LOW = 21;
const HIGH = 84;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const TRACK_COLORS = ["#37d67a", "#5ec8ff", "#ff6b6b", "#c77dff"];
const CANVAS = "#070707";
const GRID_A = "#050505";
const GRID_B = "#101010";
const STEP_MARK = "#ffb000";

const state = {
  root: "/Volumes/NO NAME",
  schema: null,
  library: null,
  studioLibrary: null,
  cardLibrary: null,
  projectName: "",
  bank: "00",
  slot: "01.SEQ",
  songSlot: "00.SNG",
  pattern: null,
  song: null,
  songIndex: -1,
  info: null,
  track: 0,
  step: 0,
  dirty: false,
  songDirty: false,
  projectAction: null,
  homePlace: "studio",
  projectPick: null,
  undo: [],
  redo: [],
  grids: "",
  playing: false,
  timer: null,
  nextTime: 0,
  playIndex: 0,
  gesture: null,
  zoom: 16,
  lanes: [[], [], [], []],
  laneOpen: [false, false, false, false],
  brush: {
    probability: "1/2",
    ratchet: "2",
    repeat: "2",
    arpDir: "up",
    arpScale: "CHROMATIC",
    wave: "Sine",
    triggers: true,
  },
  mix: [
    { mute: false, solo: false },
    { mute: false, solo: false },
    { mute: false, solo: false },
    { mute: false, solo: false },
  ],
  playLength: 16,
  playMode: "pattern",
  playCache: null,
  playEntry: -1,
  arming: false,
  following: false,
  sessionRev: 0,
};

const $ = (id) => document.getElementById(id);
globalThis.state = state;
globalThis.$ = $;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]));
}

function noteName(cents) {
  if (!cents) return "—";
  const semitone = Math.floor(cents / 100);
  const micro = cents - semitone * 100;
  const name = `${NAMES[((semitone % 12) + 12) % 12]}${Math.floor(semitone / 12)}`;
  return micro ? `${name} ${micro > 0 ? "+" : ""}${micro}c` : name;
}

function readI32(bytes, offset) {
  const value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
  return value | 0;
}

function writeI32(bytes, offset, value) {
  const signed = value | 0;
  bytes[offset] = signed & 255;
  bytes[offset + 1] = (signed >> 8) & 255;
  bytes[offset + 2] = (signed >> 16) & 255;
  bytes[offset + 3] = (signed >> 24) & 255;
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU32(bytes, offset, value) {
  const unsigned = value >>> 0;
  bytes[offset] = unsigned & 255;
  bytes[offset + 1] = (unsigned >> 8) & 255;
  bytes[offset + 2] = (unsigned >> 16) & 255;
  bytes[offset + 3] = (unsigned >> 24) & 255;
}

function readF32(bytes, offset) {
  const buffer = new ArrayBuffer(4);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < 4; index += 1) view[index] = bytes[offset + index];
  return new DataView(buffer).getFloat32(0, true);
}

function writeF32(bytes, offset, value) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, Number(value), true);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < 4; index += 1) bytes[offset + index] = view[index];
}

function currentTrack() {
  return state.pattern.tracks[state.track];
}

function noteOf(track, step) {
  return readI32(track.steps[step], state.schema.noteOffset);
}

function cvPageShift(track) {
  const cv = track.cvCents || 0;
  if (!cv) return false;
  let count = 0;
  let last = -1;
  let contiguous = true;
  for (let step = 0; step < 63; step += 1) {
    if (!noteOf(track, step)) continue;
    if (last >= 0 && step !== last + 1) contiguous = false;
    last = step;
    count += 1;
  }
  // Factory stores 15 notes on the steps and a separate channel CV.
  if (contiguous && count === 15 && last === 14) return false;
  return true;
}

function shownNote(track, step) {
  if (cvPageShift(track)) {
    if (step === 63) return noteOf(track, 62);
    if (step === 0) return track.cvCents;
    return noteOf(track, step - 1);
  }
  if (step === 63) return 0;
  return noteOf(track, step);
}

function writeShownNote(track, step, cents) {
  if (step === 63) {
    if (cvPageShift(track)) writeI32(track.steps[62], state.schema.noteOffset, cents);
  } else if (!cvPageShift(track)) {
    writeI32(track.steps[step], state.schema.noteOffset, cents);
  } else if (step === 0) {
    track.cvCents = cents;
  } else {
    writeI32(track.steps[step - 1], state.schema.noteOffset, cents);
  }
  state.dirty = true;
}

function isMarker(track, step) {
  return step === 63 && !cvPageShift(track);
}

function showChrome() {
  const label = $("project-label");
  if (!label) return;
  const open = Boolean(state.projectName) && !$("workspace").hidden;
  label.hidden = !open;
  label.textContent = open ? state.projectName : "";
}

function setStatus(message, kind) {
  const node = $("status");
  node.textContent = message;
  node.className = `status${kind ? ` ${kind}` : ""}`;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function project() {
  return state.library.projects.find((item) => item.name === state.projectName);
}

function bankInfo() {
  return project()?.banks.find((item) => item.id === state.bank);
}

function slotName(index, suffix) {
  return `${String(index).padStart(2, "0")}.${suffix}`;
}

function machineNumber(slot) {
  const index = Number(String(slot).slice(0, 2));
  return Number.isFinite(index) ? index + 1 : String(slot);
}

async function enterProject(name) {
  if (!state.library || !await confirmEdits()) return;
  state.projectAction = null;
  state.projectName = name;
  chooseDefaultBank();
  state.lanes = [[], [], [], []];
  state.laneOpen = [false, false, false, false];
  state.mix = state.mix.map(() => ({ mute: false, solo: false }));
  $("home").hidden = true;
  $("workspace").hidden = false;
  try {
    await loadSelection({ song: true });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function createNamedProject(name, place) {
  const root = placeRoot(place);
  if (!root) {
    setStatus("Connect the card first.", "error");
    return;
  }
  const created = await api("/api/project/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, name }),
  });
  state.root = root;
  state.library = await api(`/api/library?root=${encodeURIComponent(root)}`);
  if (place === "card") state.cardLibrary = state.library;
  else state.studioLibrary = state.library;
  await enterProject(created.name);
  setStatus(`Created ${created.name}.`, "ok");
}

function chooseDefaultBank() {
  const banks = project().banks;
  const withPattern = banks.find((bank) => bank.patterns.length);
  state.bank = withPattern ? withPattern.id : banks[0]?.id || "00";
  state.slot = withPattern?.patterns[0] || "01.SEQ";
  state.songSlot = "00.SNG";
  state.songIndex = -1;
}

function renderPads() {
  const banks = project().banks;
  const bankSelect = $("bank");
  bankSelect.innerHTML = Array.from({ length: 16 }, (_, index) => {
    const id = slotName(index, "").slice(0, 2);
    const bank = banks.find((item) => item.id === id);
    let detail = "empty";
    if (bank) {
      const parts = [];
      if (bank.patterns.length) parts.push(`${bank.patterns.length} pattern${bank.patterns.length === 1 ? "" : "s"}`);
      if (bank.songs.length) parts.push(`${bank.songs.length} song${bank.songs.length === 1 ? "" : "s"}`);
      if (parts.length) detail = parts.join(", ");
    }
    return `<option value="${id}"${id === state.bank ? " selected" : ""}>${machineNumber(id)} · ${detail}</option>`;
  }).join("");
  const info = bankInfo();
  const patterns = new Set(info?.patterns || []);
  const used = new Set((state.song?.entries || []).map((entry) => slotName(entry.pattern, "SEQ")));
  $("patterns").innerHTML = Array.from({ length: 16 }, (_, index) => {
    const slot = slotName(index, "SEQ");
    const exists = patterns.has(slot);
    const active = slot === state.slot ? " active" : "";
    const empty = exists ? "" : " empty";
    const marked = used.has(slot) ? " in-song" : "";
    const number = machineNumber(slot);
    const label = exists ? `Pattern ${number}` : `Pattern ${number}, empty. Click to create it.`;
    return `<button type="button" class="pad${active}${empty}${marked}" data-slot="${slot}" title="${label}" aria-label="${label}">${number}</button>`;
  }).join("");
  const songs = new Set(info?.songs || []);
  $("songs").innerHTML = Array.from({ length: 16 }, (_, index) => {
    const slot = slotName(index, "SNG");
    const exists = songs.has(slot);
    const active = slot === state.songSlot ? " active" : "";
    const empty = exists ? "" : " empty";
    const named = info?.songNames?.[slot];
    const number = machineNumber(slot);
    const label = exists
      ? `Song ${number}${named ? `, ${named}` : ""}`
      : `Song ${number}, no file yet`;
    return `<button type="button" class="pad${active}${empty}" data-song="${slot}" title="${label}" aria-label="${label}">${number}</button>`;
  }).join("");
  const infoText = state.info;
  $("bpm").value = Math.round(infoText.bpm);
  const onSong = !$("song-view").hidden;
  const file = onSong ? state.songSlot : state.slot;
  $("filepath").textContent = `PROJECTS/${state.projectName}/${state.bank}/${file}`;
  $("save").textContent = state.dirty ? "Save pattern *" : "Save pattern";
  $("save").classList.toggle("dirty", Boolean(state.dirty));
  $("save").disabled = !state.pattern;
}

function markPerformance() {
  if (!state.pattern) return;
  state.dirty = true;
  const save = $("save");
  if (save) {
    save.textContent = "Save pattern *";
    save.classList.add("dirty");
    save.disabled = false;
  }
}

function performancePayload() {
  return state.pattern.tracks.map((track) => {
    const data = { ...perf(track) };
    delete data.visits;
    return data;
  });
}

async function loadSong() {
  if (state.playing && state.playMode === "song") stopPlayback();
  const base = `root=${encodeURIComponent(state.root)}&project=${encodeURIComponent(state.projectName)}&bank=${state.bank}`;
  state.song = await api(`/api/song?${base}&slot=${state.songSlot}`);
  if (!state.song.entries) state.song.entries = [];
  state.songDirty = false;
  state.songIndex = state.song.entries.length ? 0 : -1;
  if (typeof useSongRack === "function") await useSongRack();
}

async function loadSelection(options = {}) {
  stopPlayback();
  const info = project().info;
  state.info = { bpm: info.bpm, flag2: info.flag2, flag3: info.flag3 };
  if (options.song) await loadSong();
  const hasPattern = bankInfo()?.patterns.includes(state.slot);
  if (!hasPattern) {
    state.pattern = null;
    state.dirty = false;
    state.sessionRev += 1;
    renderPads();
    draw();
    renderSong();
    showChrome();
    setStatus(`Bank ${machineNumber(state.bank)} pattern ${machineNumber(state.slot)} is empty. Click its number to create it.`);
    return;
  }
  const base = `root=${encodeURIComponent(state.root)}&project=${encodeURIComponent(state.projectName)}&bank=${state.bank}`;
  state.pattern = await api(`/api/pattern?${base}&slot=${state.slot}`);
  state.dirty = false;
  state.undo = [];
  state.redo = [];
  state.grids = "";
  state.step = 0;
  state.playLength = suggestedLength();
  state.sessionRev += 1;
  renderPads();
  syncInspector();
  draw();
  renderSong();
  scrollRollIntoView();
  showChrome();
  setStatus(`Bank ${machineNumber(state.bank)} · Pattern ${machineNumber(state.slot)}`);
}

function suggestedLength() {
  const stored = currentTrack()?.performance?.last;
  if (stored >= 1 && stored <= 64) return stored;
  const track = currentTrack();
  let last = 0;
  for (let step = 0; step < 63; step += 1) {
    if (noteOf(track, step)) last = step + 1;
  }
  if (last <= 16) return 16;
  if (last <= 32) return 32;
  if (last <= 48) return 48;
  return 64;
}


function pushUndo() {
  state.undo.push(JSON.stringify(state.pattern));
  if (state.undo.length > 40) state.undo.shift();
  state.redo = [];
}

function restore(serialized) {
  state.pattern = JSON.parse(serialized);
  syncInspector();
  draw();
  renderPads();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.pattern));
  restore(state.undo.pop());
  state.dirty = true;
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.pattern));
  restore(state.redo.pop());
  state.dirty = true;
}

function writeNote(step, cents) {
  writeI32(currentTrack().steps[step], state.schema.noteOffset, cents);
  state.dirty = true;
}

function paint(step, cents) {
  writeShownNote(currentTrack(), step, cents);
  state.step = step;
  syncInspector();
  draw();
  renderPads();
}


function patternChoices(selected) {
  const have = new Set(bankInfo()?.patterns || []);
  return Array.from({ length: 16 }, (_, slot) => {
    const note = have.has(slotName(slot, "SEQ")) ? "" : " · empty";
    return `<option value="${slot}"${slot === selected ? " selected" : ""}>${slot + 1}${note}</option>`;
  }).join("");
}

function touchSong() {
  if (state.playing && state.playMode === "song") stopPlayback();
  state.songDirty = true;
  renderSong();
  renderPads();
}

function renderSong() {
  const entries = state.song?.entries || [];
  const plays = entries.reduce((sum, entry) => sum + Number(entry.repeats || 0), 0);
  const called = songLabel();
  $("song-title").textContent = called
    ? `Song ${machineNumber(state.songSlot)} · ${called}`
    : `Song ${machineNumber(state.songSlot)} · Bank ${machineNumber(state.bank)}`;
  $("song-length").textContent = entries.length
    ? `${entries.length} part${entries.length === 1 ? "" : "s"} · ${plays} play${plays === 1 ? "" : "s"}`
    : "Empty";
  const have = new Set(bankInfo()?.patterns || []);
  $("song-chain").innerHTML = entries.map((entry, index) => {
    const repeats = Math.min(64, Math.max(1, Number(entry.repeats) || 1));
    const name = entry.pattern + 1;
    const missing = have.has(slotName(entry.pattern, "SEQ")) ? "" : " missing";
    const on = index === state.songIndex ? " on" : "";
    const sounding = index === state.playEntry ? " sounding" : "";
    const basis = (3.6 + (repeats - 1) * 1.2).toFixed(2);
    const silence = missing ? " Empty pattern, silent on the instrument." : "";
    return `<button type="button" class="chain-block${on}${sounding}${missing}" data-song-index="${index}" style="flex-basis:${basis}rem" aria-pressed="${index === state.songIndex}" title="Pattern ${name}, ${entry.repeats} play${entry.repeats === 1 ? "" : "s"}.${silence}">
      <span class="chain-pattern">${name}</span>
      <span class="chain-repeats">×${entry.repeats}</span>
    </button>`;
  }).join("") || `<p class="hint">This song is empty. Add a pattern from this bank.</p>`;
  const entry = entries[state.songIndex];
  const editor = $("song-edit");
  if (!entry) {
    editor.hidden = true;
    editor.innerHTML = "";
  } else {
    editor.hidden = false;
    editor.innerHTML = `
      <label>Pattern
        <select data-song-pattern>${patternChoices(entry.pattern)}</select>
      </label>
      <label>Repeats
        <input data-song-repeats type="number" min="1" max="64" value="${entry.repeats}">
      </label>
      <button type="button" data-song-move="-1" ${state.songIndex === 0 ? "disabled" : ""}>Move left</button>
      <button type="button" data-song-move="1" ${state.songIndex >= entries.length - 1 ? "disabled" : ""}>Move right</button>
      <button type="button" data-song-remove>Remove</button>
    `;
  }
  $("add-entry").disabled = entries.length >= 64;
  $("save-song").textContent = state.songDirty ? "Save song *" : "Save song";
  const nameField = $("song-name");
  if (nameField && document.activeElement !== nameField) nameField.value = called;
  const stored = new Set(bankInfo()?.songs || []);
  const hasFile = stored.has(state.songSlot);
  const target = $("song-target");
  if (target) {
    const free = Array.from({ length: 16 }, (_, index) => slotName(index, "SNG")).filter((slot) => !stored.has(slot));
    target.innerHTML = free.map((slot) => `<option value="${slot}">${machineNumber(slot)}</option>`).join("");
    target.disabled = !hasFile || free.length === 0;
  }
  const fileActions = ["duplicate-song", "move-song", "delete-song"];
  for (const id of fileActions) {
    const button = $(id);
    if (button) button.disabled = !hasFile || (id === "move-song" && (!target || !target.value));
  }
}

function songLabel(slot = state.songSlot) {
  return bankInfo()?.songNames?.[slot] || "";
}

function scaleByName(name) {
  return state.library.scales.find((scale) => scale.name === name);
}

function writeScaleName(footer, offset, name) {
  const length = state.schema.scaleNameLength;
  for (let index = 0; index < length; index += 1) footer[offset + index] = 0;
  for (let index = 0; index < name.length && index < length; index += 1) {
    footer[offset + index] = name.charCodeAt(index);
  }
}

async function savePattern() {
  if (!state.pattern) return;
  const pattern = {
    version: state.pattern.version,
    field2: state.pattern.field2,
    tracks: state.pattern.tracks.map((track) => ({
      cvCents: track.cvCents,
      steps: track.steps,
      footer: track.footer,
    })),
  };
  try {
    const saved = await api("/api/pattern", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: state.root,
        project: state.projectName,
        bank: state.bank,
        slot: state.slot,
        pattern,
        performance: performancePayload(),
      }),
    });
    const info = {
      bpm: Number($("bpm").value),
      flag2: state.info.flag2,
      flag3: state.info.flag3,
    };
    await api("/api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: state.root, project: state.projectName, info }),
    });
    state.info = info;
    project().info = info;
    state.dirty = false;
    renderPads();
    setStatus(`Saved ${saved.path}. A .bak copy of the previous file is beside it.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function saveSong() {
  try {
    const saved = await api("/api/song", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: state.root,
        project: state.projectName,
        bank: state.bank,
        slot: state.songSlot,
        song: { entries: state.song.entries },
      }),
    });
    state.songDirty = false;
    state.library = await api(`/api/library?root=${encodeURIComponent(state.root)}`);
    renderPads();
    renderSong();
    setStatus(`Saved ${saved.path}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function quantizeTrack() {
  const track = currentTrack();
  const mask = track.footer[state.schema.scaleMaskOffset] | (track.footer[state.schema.scaleMaskOffset + 1] << 8);
  pushUndo();
  for (let step = 0; step < 64; step += 1) {
    if (step === 63) continue;
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

function transpose(semitones) {
  pushUndo();
  const track = currentTrack();
  if (cvPageShift(track)) track.cvCents += semitones * 100;
  for (let step = 0; step < 63; step += 1) {
    const cents = noteOf(track, step);
    if (!cents || isMarker(track, step)) continue;
    writeNote(step, cents + semitones * 100);
  }
  syncInspector();
  draw();
  renderPads();
}

function clearNotes() {
  pushUndo();
  const track = currentTrack();
  if (cvPageShift(track)) track.cvCents = 0;
  for (let step = 0; step < 63; step += 1) writeNote(step, 0);
  syncInspector();
  draw();
  renderPads();
}

let audioCtx;
let playbackBus;
let audioGeneration = 0;

function audio() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    playbackBus = audioCtx.createGain();
    playbackBus.gain.value = 0;
    playbackBus.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/** Sequencer / rack output. Muted while stopped so Stop cuts sound immediately. */
function playbackOut() {
  audio();
  return playbackBus;
}

function setPlaybackAudible(on) {
  audio();
  const now = audioCtx.currentTime;
  const value = on ? 1 : 0;
  try {
    playbackBus.gain.cancelScheduledValues(now);
    playbackBus.gain.setValueAtTime(value, now);
  } catch (error) {
    playbackBus.gain.value = value;
  }
}

function bumpAudioGeneration() {
  audioGeneration += 1;
  return audioGeneration;
}

function trigger(trackIndex, cents, gate, level, when, stepDuration, mod = 0) {
  if (typeof voiceTrigger === "function") {
    voiceTrigger(trackIndex, cents, gate, level, when, stepDuration, mod);
    return;
  }
  const ctx = audio();
  const frequency = 440 * 2 ** ((cents / 100 - 69) / 12);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = ["sawtooth", "square", "triangle", "sine"][trackIndex];
  oscillator.frequency.setValueAtTime(frequency, when);
  const peak = 0.07 * (level / 100);
  const length = Math.max(0.02, stepDuration * Math.min(gate, 100) / 100);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
  oscillator.connect(gain).connect(playbackOut());
  oscillator.start(when);
  oscillator.stop(when + length + 0.02);
}

function returnToStart() {
  stopPlayback();
  state.step = 0;
  state.playIndex = 0;
  if (state.pattern) {
    syncInspector();
    draw();
  }
}

let confirmWait = null;

function askConfirm({ title, message, confirm = "Continue", danger = false }) {
  if (confirmWait) finishConfirm(false);
  $("confirm-title").textContent = title;
  $("confirm-body").textContent = message;
  const ok = $("confirm-ok");
  ok.textContent = confirm;
  ok.classList.toggle("danger", danger);
  $("confirm").hidden = false;
  $("confirm-cancel").focus();
  return new Promise((resolve) => {
    confirmWait = resolve;
  });
}

function finishConfirm(accepted) {
  if (!confirmWait) return;
  const resolve = confirmWait;
  confirmWait = null;
  $("confirm").hidden = true;
  resolve(accepted);
}

async function confirmEdits(scope = "both") {
  const pattern = scope !== "song" && state.dirty;
  const song = scope !== "pattern" && state.songDirty;
  if (!pattern && !song) return true;
  const label = pattern && song ? "pattern and song have" : `${pattern ? "pattern" : "song"} has`;
  return askConfirm({
    title: "Unsaved edits",
    message: `This ${label} unsaved edits. Continue without saving?`,
    confirm: "Continue",
  });
}

$("confirm-cancel").addEventListener("click", () => finishConfirm(false));
$("confirm-ok").addEventListener("click", () => finishConfirm(true));
$("confirm").addEventListener("click", (event) => {
  if (event.target === $("confirm")) finishConfirm(false);
});
document.addEventListener("keydown", (event) => {
  if ($("confirm").hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    finishConfirm(false);
  }
});

$("projects-back").addEventListener("click", async () => {
  if (!await confirmEdits()) return;
  if (typeof flushSongRack === "function") await flushSongRack();
  stopPlayback();
  state.dirty = false;
  state.songDirty = false;
  $("workspace").hidden = true;
  $("home").hidden = false;
  showChrome();
  try {
    await loadLibraries();
    setStatus("");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("bank").addEventListener("change", async () => {
  const id = $("bank").value;
  if (id === state.bank) return;
  if (!await confirmEdits()) {
    $("bank").value = state.bank;
    return;
  }
  if (typeof flushSongRack === "function") await flushSongRack();
  state.bank = id;
  state.slot = bankInfo()?.patterns[0] || "01.SEQ";
  await loadSelection({ song: true });
});
$("patterns").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-slot]");
  if (!button) return;
  const slot = button.dataset.slot;
  const exists = bankInfo()?.patterns.includes(slot);
  if (!exists) {
    try {
      state.pattern = await api("/api/pattern/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: state.root, project: state.projectName, bank: state.bank, slot }),
      });
      state.library = await api(`/api/library?root=${encodeURIComponent(state.root)}`);
      state.slot = slot;
      state.dirty = false;
      renderPads();
      syncInspector();
      draw();
      setStatus(`Created ${slot}`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
    return;
  }
  if (slot === state.slot || !await confirmEdits("pattern")) return;
  state.slot = slot;
  await loadSelection();
});
$("songs").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-song]");
  if (!button) return;
  const slot = button.dataset.song;
  if (slot !== state.songSlot) {
    if (!await confirmEdits("song")) return;
    if (typeof flushSongRack === "function") await flushSongRack();
    const previous = state.songSlot;
    state.songSlot = slot;
    try {
      await loadSong();
    } catch (error) {
      state.songSlot = previous;
      setStatus(error.message, "error");
      return;
    }
  }
  showTab("song");
  const exists = bankInfo()?.songs.includes(state.songSlot);
  setStatus(exists
    ? `Bank ${machineNumber(state.bank)} · Song ${machineNumber(state.songSlot)}`
    : `Song ${machineNumber(state.songSlot)} has no file yet.`);
});
$("save").addEventListener("click", savePattern);
$("return-start").addEventListener("click", returnToStart);
$("bpm").addEventListener("change", () => {
  state.dirty = true;
  renderPads();
});

function showTab(name) {
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
  $("pattern-view").hidden = name !== "pattern";
  $("song-view").hidden = name !== "song";
  $("rack-view").hidden = name !== "rack";
  if (name === "song") renderSong();
  if (name === "rack" && typeof renderRack === "function") renderRack();
  renderPads();
  showChrome();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

function readName(bytes, offset) {
  let text = "";
  for (let index = 0; index < state.schema.scaleNameLength; index += 1) {
    const value = bytes[offset + index];
    if (!value) break;
    text += String.fromCharCode(value);
  }
  return text;
}


$("add-entry").addEventListener("click", () => {
  if (!state.song) state.song = { entries: [] };
  if (state.song.entries.length >= 64) return;
  const pattern = Number(state.slot.slice(0, 2));
  state.song.entries.push({ pattern: Number.isFinite(pattern) ? pattern : 0, repeats: 1 });
  state.songIndex = state.song.entries.length - 1;
  touchSong();
});
$("save-song").addEventListener("click", saveSong);
$("song-view").addEventListener("click", (event) => {
  const block = event.target.closest("[data-song-index]");
  if (block) {
    state.songIndex = Number(block.dataset.songIndex);
    renderSong();
    return;
  }
  const move = event.target.closest("[data-song-move]");
  if (move && state.song) {
    const next = state.songIndex + Number(move.dataset.songMove);
    const entries = state.song.entries;
    if (next < 0 || next >= entries.length) return;
    const [item] = entries.splice(state.songIndex, 1);
    entries.splice(next, 0, item);
    state.songIndex = next;
    touchSong();
    return;
  }
  if (event.target.closest("[data-song-remove]") && state.song) {
    state.song.entries.splice(state.songIndex, 1);
    if (!state.song.entries.length) state.songIndex = -1;
    else if (state.songIndex >= state.song.entries.length) state.songIndex -= 1;
    touchSong();
  }
});
$("song-view").addEventListener("change", (event) => {
  const entry = state.song?.entries[state.songIndex];
  if (!entry) return;
  if (event.target.matches("[data-song-pattern]")) entry.pattern = Number(event.target.value);
  if (event.target.matches("[data-song-repeats]")) {
    entry.repeats = Math.min(64, Math.max(1, Number(event.target.value) || 1));
  }
  touchSong();
});

window.addEventListener("keydown", (event) => {
  if ($("workspace").hidden) return;
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    savePattern();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (typing || (!state.pattern && state.playMode !== "song")) return;
  if (event.key === " ") {
    event.preventDefault();
    if (state.playing) stopPlayback();
    else play();
  } else if (event.key === "ArrowRight") {
    state.step = Math.min(63, state.step + 1);
    syncInspector();
    draw();
  } else if (event.key === "ArrowLeft") {
    state.step = Math.max(0, state.step - 1);
    syncInspector();
    draw();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? 100 : -100;
    const cents = noteOf(currentTrack(), state.step);
    if (!cents) return;
    pushUndo();
    paint(state.step, cents + delta);
  } else if (event.key === "Backspace" || event.key === "Delete") {
    pushUndo();
    paint(state.step, 0);
  } else if (["1", "2", "3", "4"].includes(event.key)) {
    state.track = Number(event.key) - 1;
    renderPads();
    syncInspector();
    draw();
  }
});
