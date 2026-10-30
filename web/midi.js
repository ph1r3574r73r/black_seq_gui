/** MIDI file import dialog + live controller (server-side rtmidi via SSE). */

const midiState = {
  file: null,
  inspect: null,
  recordArm: false,
  learn: null,
  ccMap: JSON.parse(localStorage.getItem("blackseq.midiCcMap") || "{}"),
  devices: [],
  selected: null,
  source: null,
  held: new Map(),
};

function saveCcMap() {
  localStorage.setItem("blackseq.midiCcMap", JSON.stringify(midiState.ccMap));
}

function midiFileToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function postMidi(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "MIDI request failed");
  return data;
}

function closeMidiImport() {
  $("midi-import")?.setAttribute("hidden", "");
  midiState.file = null;
  midiState.inspect = null;
}

function sourceOptions(inspect) {
  const options = [`<option value="">— skip —</option>`];
  (inspect.tracks || []).forEach((track) => {
    if (!track.noteCount) return;
    const label = track.name || `Track ${track.index + 1}`;
    options.push(`<option value="track:${track.index}">${escapeHtml(label)} (${track.noteCount})</option>`);
  });
  (inspect.midiChannels || []).forEach((channel) => {
    options.push(`<option value="channel:${channel}">MIDI ch ${channel}</option>`);
  });
  return options.join("");
}

function openMidiImport(inspect, fileName) {
  const dialog = $("midi-import");
  if (!dialog) return;
  $("midi-import-file").textContent = fileName || "MIDI file";
  const rows = $("midi-import-rows");
  rows.innerHTML = [0, 1, 2, 3].map((channel) => `
    <label>CH${channel + 1}
      <select data-midi-map="${channel}">${sourceOptions(inspect)}</select>
    </label>`).join("");
  // Prefer first four tracks with notes.
  const music = (inspect.tracks || []).filter((track) => track.noteCount);
  rows.querySelectorAll("select[data-midi-map]").forEach((select, index) => {
    if (music[index]) select.value = `track:${music[index].index}`;
  });
  dialog.removeAttribute("hidden");
}

async function pickMidiFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mid,.midi,audio/midi,audio/x-midi";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const midi = midiFileToBase64(buffer);
      midiState.file = midi;
      midiState.inspect = await postMidi("/api/midi/inspect", { midi });
      openMidiImport(midiState.inspect, file.name);
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });
  input.click();
}

function mappingFromDialog() {
  const mapping = {};
  document.querySelectorAll("select[data-midi-map]").forEach((select) => {
    const channel = Number(select.dataset.midiMap);
    const value = select.value;
    if (!value) {
      mapping[channel] = null;
      return;
    }
    const [kind, raw] = value.split(":");
    mapping[channel] = kind === "track" ? { track: Number(raw) } : { channel: Number(raw) };
  });
  return mapping;
}

async function applyMidiImport() {
  if (!midiState.file || !state.pattern) return;
  try {
    pushUndo();
    const replace = $("midi-import-replace")?.checked !== false;
    const mono = $("midi-import-mono")?.value || "high";
    const result = await postMidi("/api/midi/import", {
      midi: midiState.file,
      pattern: state.pattern,
      mapping: mappingFromDialog(),
      replace,
      mono,
    });
    state.pattern = result.pattern;
    state.dirty = true;
    closeMidiImport();
    $("daw-rows").dataset.signature = "";
    draw();
    syncInspector();
    setStatus("MIDI imported", false);
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

function renderMidiDevices(info) {
  const select = $("midi-device");
  if (!select) return;
  midiState.devices = info.devices || [];
  midiState.selected = info.selected || null;
  const previous = select.value;
  select.innerHTML = `<option value="">MIDI in</option>` + midiState.devices.map((name) =>
    `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  select.value = midiState.selected || previous || "";
  select.disabled = !info.available && !midiState.devices.length;
  if (!info.available) select.title = "Install python-rtmidi for controller input";
}

async function refreshMidiDevices() {
  try {
    const response = await fetch("/api/midi/devices");
    const info = await response.json();
    renderMidiDevices(info);
    if (info.selected && info.selected !== midiState.selected) {
      await postMidi("/api/midi/select", { name: info.selected });
    }
  } catch (error) {
    console.error(error);
  }
}

async function chooseMidiDevice(name) {
  try {
    const info = await postMidi("/api/midi/select", { name: name || null });
    renderMidiDevices(info);
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

function beginCcLearn(target) {
  midiState.learn = target;
  setStatus(`Move a MIDI knob to learn ${target.label || target.kind}`, false);
}

function applyCcLearn(controller, value) {
  if (!midiState.learn) return false;
  const target = { ...midiState.learn, controller };
  midiState.ccMap[String(controller)] = target;
  saveCcMap();
  midiState.learn = null;
  setStatus(`Learned CC${controller} → ${target.label || target.kind}`, false);
  applyMappedCc(controller, value);
  return true;
}

function applyMappedCc(controller, value) {
  const target = midiState.ccMap[String(controller)];
  if (!target) return;
  const amount = value / 127;
  if (target.kind === "rack" && state.rack) {
    const module = state.rack.modules.find((item) => item.id === target.moduleId);
    if (!module || !target.param) return;
    module.params[target.param] = amount;
    if (typeof saveRack === "function") saveRack();
    if (typeof renderRack === "function" && !$("rack-view")?.hidden) renderRack();
    if (typeof rackVoiceRefresh === "function") rackVoiceRefresh(module, state.rack.lastSignals || {});
    return;
  }
  if (target.kind === "lane") {
    state.brush = state.brush || {};
    if (target.key === "gate") state.brush.gate = Math.round(amount * 100);
    else if (target.key === "probability") state.brush.probability = Math.round(amount * 100);
    else if (target.key === "glide") state.brush.glide = Math.round(amount * 100);
    else if (target.key === "mod") state.brush.modVolt = Math.round(amount * 200 - 100);
    if (midiState.recordArm && state.playing && state.pattern) {
      const track = state.pattern.tracks[state.track];
      const step = state.step || 0;
      if (target.key === "gate" && track?.steps?.[step]) {
        track.steps[step][state.schema.gateOffset] = Math.round(amount * 100);
        state.dirty = true;
        draw();
      }
    }
  }
}

function handleLiveMidi(event) {
  if (event.type === "cc") {
    if (applyCcLearn(event.controller, event.value)) return;
    applyMappedCc(event.controller, event.value);
    return;
  }
  if (event.type === "noteon") {
    const trackIndex = state.track || 0;
    const cents = event.note * 100;
    midiState.held.set(event.note, { trackIndex, at: performance.now() });
    if (typeof trigger === "function") trigger(trackIndex, cents, 80, 100, audio().currentTime, 0.35);
    if (midiState.recordArm && state.pattern) {
      if (state.playing) {
        const step = state.step || 0;
        pushUndo();
        paint(step, cents);
        state.dirty = true;
      } else {
        pushUndo();
        paint(state.step || 0, cents);
        state.step = Math.min(63, (state.step || 0) + 1);
        state.dirty = true;
        syncInspector();
      }
      draw();
    }
    return;
  }
  if (event.type === "noteoff") {
    midiState.held.delete(event.note);
  }
}

function connectMidiStream() {
  if (midiState.source) {
    midiState.source.close();
    midiState.source = null;
  }
  const source = new EventSource("/api/midi/events");
  midiState.source = source;
  source.onmessage = (message) => {
    try {
      handleLiveMidi(JSON.parse(message.data));
    } catch (error) {
      console.error(error);
    }
  };
}

function bindMidiUi() {
  $("midi-import-open")?.addEventListener("click", () => pickMidiFile());
  $("midi-import-cancel")?.addEventListener("click", () => closeMidiImport());
  $("midi-import-apply")?.addEventListener("click", () => applyMidiImport());
  $("midi-device")?.addEventListener("change", (event) => chooseMidiDevice(event.target.value || null));
  $("midi-record")?.addEventListener("click", () => {
    midiState.recordArm = !midiState.recordArm;
    $("midi-record")?.classList.toggle("engaged", midiState.recordArm);
    $("midi-record")?.setAttribute("aria-pressed", midiState.recordArm ? "true" : "false");
  });
  $("midi-learn-gate")?.addEventListener("click", () => beginCcLearn({ kind: "lane", key: "gate", label: "Gate" }));
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-midi-learn-rack]");
    if (!button || !state.rack) return;
    const moduleId = Number(button.dataset.moduleId);
    const param = button.dataset.midiLearnRack;
    beginCcLearn({ kind: "rack", moduleId, param, label: `${param}` });
  });
  refreshMidiDevices();
  connectMidiStream();
  setInterval(refreshMidiDevices, 5000);
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof escapeHtml !== "function") {
    window.escapeHtml = (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
  bindMidiUi();
});
