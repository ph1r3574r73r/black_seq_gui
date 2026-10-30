function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]));
}

function sessionSignature() {
  const modes = state.pattern.tracks.map((track) => track.performance?.modMode || "stepped").join(",");
  const lanes = state.lanes.map((lane) => lane.join(".")).join("|");
  const open = state.laneOpen.map((flag) => (flag ? "1" : "0")).join("");
  return [state.sessionRev, state.zoom, lanes, open, modes].join(":");
}

function scaleOptions(selected) {
  const names = (state.library?.scales || []).map((scale) => scale.name);
  if (selected && !names.includes(selected)) names.unshift(selected);
  return names.map((name) => `<option${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
}

function ensureSession() {
  const rows = $("daw-rows");
  if (!rows) return;
  rows.style.setProperty("--step", `${state.zoom}px`);
  if (!state.pattern) {
    if (rows.dataset.signature !== "empty") {
      rows.dataset.signature = "empty";
      rows.innerHTML = `<p class="empty-session">This pattern slot is empty. Click its dim number to create it.</p>`;
    }
    return;
  }
  const signature = sessionSignature();
  if (rows.dataset.signature === signature) return;
  const scrollTops = new Map();
  rows.querySelectorAll("[data-note-scroll]").forEach((node) => scrollTops.set(node.dataset.noteScroll, node.scrollTop));
  rows.dataset.signature = signature;
  rows.innerHTML = sessionMarkup();
  bindNoteScroll();
  scrollTops.forEach((top, index) => {
    const notes = rows.querySelector(`[data-note-scroll="${index}"]`);
    const keys = rows.querySelector(`[data-keys="${index}"]`);
    if (notes) notes.scrollTop = top;
    if (keys) keys.scrollTop = top;
  });
  bindFunctionLanes();
  paintAll();
}

function sessionMarkup() {
  const ruler = Array.from({ length: 64 }, (_, step) => {
    const mark = step % 16 === 0 ? String(step + 1) : step % 4 === 0 ? "·" : "";
    const klass = step % 16 === 0 ? "bar" : step % 4 === 0 ? "beat" : "step";
    return `<span class="${klass}">${mark}</span>`;
  }).join("");
  const tracks = state.pattern.tracks.map((_, index) => trackMarkup(index)).join("");
  return `
    <div class="playhead" id="playhead"></div>
    <div class="daw-row ruler-row">
      <div class="head corner">Tracks</div>
      <div class="lane ruler" id="ruler">${ruler}</div>
    </div>
    ${tracks}`;
}

function trackMarkup(index) {
  const selected = index === state.track ? " selected" : "";
  const expanded = Boolean(state.laneOpen[index] && state.lanes[index].length);
  return `
    <div class="daw-row${state.mix[index].mute ? " muted" : ""}" style="--track:${TRACK_COLORS[index]}">
      <div class="head track-head${selected}">
        <div class="track-title">
          <button type="button" class="icon disclose" data-disclose="${index}" aria-expanded="${expanded}" aria-label="${expanded ? "Hide" : "Show"} CH${index + 1} lanes">${expanded ? "−" : "+"}</button>
          <button type="button" class="track-name" data-select="${index}">CH${index + 1}</button>
          <span class="track-note" data-track-note="${index}"></span>
          <span class="mixes">
            <button type="button" class="mix${state.mix[index].mute ? " on" : ""}" data-mute="${index}" aria-pressed="${state.mix[index].mute}" title="Mute this channel in the editor">M</button>
            <button type="button" class="mix solo${state.mix[index].solo ? " on" : ""}" data-solo="${index}" aria-pressed="${state.mix[index].solo}" title="Solo this channel in the editor">S</button>
          </span>
        </div>
      </div>
      <div class="lane clip-lane" data-clip="${index}">
        <canvas class="clip-canvas" data-kind="clip" data-track="${index}" aria-label="CH${index + 1} clip"></canvas>
        <div class="clip-shade" data-shade="${index}"></div>
        <div class="clip-edge" data-edge="${index}" title="Drag to scale the block, up to 64 steps"></div>
        <div class="clip-name" data-clip-name="${index}"></div>
      </div>
    </div>
    ${renderedLanes(index)}`;
}

function keyMarkup() {
  let html = "";
  for (let midi = HIGH; midi >= LOW; midi -= 1) {
    const black = NAMES[midi % 12].includes("#");
    const label = midi % 12 === 0 ? `${NAMES[0]}${Math.floor(midi / 12) - 1}` : "";
    html += `<div class="key${black ? " black" : ""}" data-midi="${midi}" role="button" tabindex="-1">${label}</div>`;
  }
  return html;
}

const keyAudition = { track: null, midi: null };

function releaseKeyAudition() {
  keyAudition.track = null;
  keyAudition.midi = null;
  document.querySelectorAll(".key.playing").forEach((node) => node.classList.remove("playing"));
}

function auditionKey(trackIndex, midi, held) {
  if (!Number.isFinite(midi)) return;
  const cents = midi * 100;
  audio();
  if (held) {
    keyAudition.track = trackIndex;
    keyAudition.midi = midi;
    trigger(trackIndex, cents, 100, 100, audio().currentTime, 0.45);
  } else {
    trigger(trackIndex, cents, 35, 100, audio().currentTime, 0.18);
  }
}

function bindNoteScroll() {
  document.querySelectorAll("[data-note-scroll]").forEach((lane) => {
    const keys = document.querySelector(`[data-keys="${lane.dataset.noteScroll}"]`);
    if (!keys) return;
    let lock = false;
    const sync = (from, to) => {
      if (lock) return;
      lock = true;
      to.scrollTop = from.scrollTop;
      lock = false;
    };
    lane.addEventListener("scroll", () => sync(lane, keys));
    keys.addEventListener("scroll", () => sync(keys, lane));
  });
}

function sizeCanvas(canvas, height, stretch) {
  const width = 64 * state.zoom;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, width * dpr);
  canvas.height = Math.max(1, height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = stretch ? "100%" : `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function paintAll() {
  if (!state.pattern) return;
  document.querySelectorAll("canvas[data-kind=clip]").forEach((canvas) => paintClip(canvas, Number(canvas.dataset.track)));
  document.querySelectorAll("canvas[data-kind=notes], canvas[data-kind=mod-note]").forEach((canvas) => paintNotes(canvas, Number(canvas.dataset.track)));
  document.querySelectorAll("canvas[data-kind=gate-index]").forEach((canvas) => paintBars(canvas, Number(canvas.dataset.track), (track, step) => track.steps[step][state.schema.gateOffset], 100, TRACK_COLORS[Number(canvas.dataset.track)]));
  document.querySelectorAll("canvas[data-kind=level]").forEach((canvas) => paintBars(canvas, Number(canvas.dataset.track), (track, step) => track.steps[step][state.schema.levelOffset], 100, TRACK_COLORS[Number(canvas.dataset.track)]));
  paintFunctionCanvases();
  document.querySelectorAll("[data-envelope]").forEach((svg) => paintEnvelope(svg, Number(svg.dataset.envelope)));
  placeChrome();
}

function gateOf(track, step) {
  return track.steps[step]?.[state.schema.gateOffset] || 0;
}

function paintClip(canvas, index) {
  const height = 64;
  const ctx = sizeCanvas(canvas, height, true);
  ctx.fillStyle = TRACK_COLORS[index];
  ctx.globalAlpha = index === state.track ? 0.95 : 0.78;
  ctx.fillRect(0, 0, 64 * state.zoom, height);
  ctx.globalAlpha = 1;
  const track = state.pattern.tracks[index];
  for (let step = 0; step < 64; step += 1) {
    if (step % 16 === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(step * state.zoom, 0, 1, height);
    }
    const cents = shownNote(track, step);
    if (!cents) continue;
    const midi = cents / 100;
    const y = ((HIGH - midi) / (HIGH - LOW)) * (height - 8) + 2;
    ctx.fillStyle = isMarker(track, step) ? "rgba(0,0,0,0.25)" : CANVAS;
    ctx.fillRect(step * state.zoom + 1, y, Math.max(2, state.zoom - 2), 4);
  }
}

function paintNotes(canvas, index) {
  const rows = HIGH - LOW + 1;
  const height = rows * CELL_H;
  const ctx = sizeCanvas(canvas, height);
  for (let row = 0; row < rows; row += 1) {
    const midi = HIGH - row;
    ctx.fillStyle = NAMES[midi % 12].includes("#") ? GRID_A : GRID_B;
    ctx.fillRect(0, row * CELL_H, 64 * state.zoom, CELL_H);
  }
  const track = state.pattern.tracks[index];
  for (let step = 0; step < 64; step += 1) {
    const x = step * state.zoom;
    if (step % 16 === 0) {
      ctx.fillStyle = "rgba(255,176,0,0.45)";
      ctx.fillRect(x, 0, 1, height);
    } else if (step % 4 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(x, 0, 1, height);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x, 0, 1, height);
    }
    if (index === state.track && step === state.step) {
      ctx.fillStyle = "rgba(255,176,0,0.12)";
      ctx.fillRect(x, 0, state.zoom, height);
    }
    const modulation = canvas.dataset.kind === "mod-note";
    const cents = modulation ? (track.performance?.modNote[step] || 0) : shownNote(track, step);
    if (!cents) continue;
    const row = HIGH - cents / 100;
    ctx.fillStyle = !modulation && isMarker(track, step) ? "rgba(255,176,0,0.35)" : TRACK_COLORS[index];
    ctx.fillRect(x + 1, row * CELL_H + 1, state.zoom - 2, CELL_H - 2);
  }
}

function paintBars(canvas, index, read, max, color) {
  const height = Math.max(24, Math.round(canvas.clientHeight) || 44);
  const ctx = sizeCanvas(canvas, height, true);
  ctx.fillStyle = CANVAS;
  ctx.fillRect(0, 0, 64 * state.zoom, height);
  const track = state.pattern.tracks[index];
  for (let step = 0; step < 64; step += 1) {
    const value = Math.max(0, Math.min(max, read(track, step)));
    const bar = (value / max) * (height - 4);
    ctx.fillStyle = index === state.track && step === state.step ? STEP_MARK : color;
    ctx.globalAlpha = step >= state.playLength ? 0.35 : 1;
    ctx.fillRect(step * state.zoom + 1, height - bar - 2, Math.max(1, state.zoom - 2), bar);
  }
  ctx.globalAlpha = 1;
}

function paintTails(canvas, key) {
  const height = Math.max(24, Math.round(canvas.clientHeight) || 44);
  const zoom = state.zoom;
  const ctx = sizeCanvas(canvas, height, true);
  const trackIndex = Number(canvas.dataset.track);
  const track = state.pattern.tracks[trackIndex];
  const color = TRACK_COLORS[trackIndex];
  const values = track.performance?.[key] || [];
  ctx.fillStyle = CANVAS;
  ctx.fillRect(0, 0, 64 * zoom, height);
  for (let step = 0; step < 64; step += 4) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(step * zoom, 0, 1, height);
  }
  const top = 8;
  const bottom = height - 12;
  for (let step = 0; step < 64; step += 1) {
    const time = Math.max(0, Math.min(2, (Number(values[step]) || 0) / 50));
    const x = step * zoom;
    const faded = step >= state.playLength ? 0.35 : 1;
    ctx.globalAlpha = faded * 0.45;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(x + 1, bottom - 7, 2, 7);
    const open = key === "release" ? gatePortion(track, step) : 0;
    const close = x + open * zoom;
    if (open > 0) {
      ctx.globalAlpha = faded * 0.9;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, Math.max(2, close - x), 3);
    }
    if (time <= 0) continue;
    ctx.fillStyle = color;
    const end = close + time * zoom;
    ctx.beginPath();
    ctx.moveTo(close, top);
    ctx.lineTo(end, bottom);
    ctx.lineTo(close, bottom);
    ctx.closePath();
    ctx.globalAlpha = faded * 0.8;
    ctx.fill();
    ctx.globalAlpha = faded;
    ctx.beginPath();
    ctx.arc(Math.min(end, 64 * zoom - 1), bottom, Math.max(3, zoom * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function gatePortion(track, step) {
  const length = track.steps[step]?.[state.schema.gateOffset] || 0;
  if (length <= 0) return 0;
  if (length >= 100) return 1;
  return length / 100;
}

function tailLength(event, canvas, step) {
  const rect = canvas.getBoundingClientRect();
  let across = (event.clientX - rect.left) / state.zoom - step;
  if (canvas.dataset.kind === "release") {
    across -= gatePortion(state.pattern.tracks[Number(canvas.dataset.track)], step);
  }
  return Math.round(Math.max(0, Math.min(2, across)) * 4) / 4;
}

function gatePhrase(step, length) {
  if (!length) return `Step ${step + 1} · off`;
  const amount = Math.max(0, Math.min(100, length));
  if (amount >= 100) return `Step ${step + 1} · 100 hold`;
  return `Step ${step + 1} · ${amount}`;
}

function lfoSample(shape, phase) {
  const wrapped = ((phase % 1) + 1) % 1;
  if (shape === 1) return wrapped < 0.5 ? wrapped * 4 - 1 : 3 - wrapped * 4;
  if (shape === 2) return wrapped * 2 - 1;
  if (shape === 3) return 1 - wrapped * 2;
  if (shape === 4) return wrapped < 0.5 ? 1 : -1;
  if (shape === 5) {
    const piece = Math.floor(wrapped * 3);
    return (1 - (wrapped * 3) % 1) * (1 - piece / 3) * 2 - 1;
  }
  if (shape === 6 || shape === 7) {
    const bucket = Math.floor(wrapped * (shape === 6 ? 8 : 28));
    const hash = Math.sin((bucket + 1) * (shape === 6 ? 12.9898 : 78.233)) * 43758.5453;
    return (hash - Math.floor(hash)) * 2 - 1;
  }
  return Math.sin(wrapped * Math.PI * 2);
}

function paintLfo(canvas, index) {
  const height = Math.max(24, Math.round(canvas.clientHeight) || 44);
  const zoom = state.zoom;
  const width = 64 * zoom;
  const ctx = sizeCanvas(canvas, height, true);
  const track = state.pattern.tracks[index];
  const rate = readF32(track.footer, state.schema.lfoRateOffset);
  const shape = Math.max(0, Math.min(7, Math.round(readF32(track.footer, state.schema.lfoShapeOffset) * 7)));
  const level = Math.max(0, Math.min(1, readF32(track.footer, state.schema.lfoLevelOffset)));
  const sync = (track.footer[state.schema.lfoSyncOffset] || 0) !== 0;
  ctx.fillStyle = CANVAS;
  ctx.fillRect(0, 0, width, height);
  const mid = height / 2;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(0, mid, width, 1);
  for (let step = 0; step < 64; step += 4) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(step * zoom, 0, 1, height);
  }
  const amp = level * (mid - 8);
  const sign = 1;
  const cycles = sync ? 4 : Math.max(0.5, Math.min(32, rate * 16 || 0.5));
  ctx.beginPath();
  for (let x = 0; x <= width; x += 2) {
    const y = mid - sign * amp * lfoSample(shape, (x / width) * cycles);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = TRACK_COLORS[index];
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function paintEnvelope(svg, index) {
  const footer = state.pattern.tracks[index].footer;
  const offsets = state.schema.adsrOffsets;
  const attack = Math.max(0.04, Math.min(1, Math.abs(readF32(footer, offsets[0]))));
  const decay = Math.max(0.04, Math.min(1, Math.abs(readF32(footer, offsets[1]))));
  const sustain = Math.max(0, Math.min(1, readF32(footer, offsets[2])));
  const release = Math.max(0.04, Math.min(1, Math.abs(readF32(footer, offsets[3]))));
  const level = Math.max(0.05, Math.min(1, Math.abs(readF32(footer, offsets[4])) || 0.05));
  const x1 = 8 + attack * 28;
  const x2 = x1 + decay * 28;
  const x3 = 92;
  const x4 = x3 + release * 20;
  const peak = 40 - level * 32;
  const hold = 40 - sustain * level * 32;
  const color = TRACK_COLORS[index];
  svg.innerHTML = `<path d="M4 40 L${x1} ${peak} L${x2} ${hold} L${x3} ${hold} L${Math.min(116, x4)} 40" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="1.5"/>`;
}

function placeChrome() {
  const step = state.playing ? audibleStep() : state.step;
  const head = $("playhead");
  if (head) {
    const silent = state.playing && step < 0;
    head.hidden = silent;
    head.classList.toggle("playing", state.playing && !silent);
    if (!silent) head.style.left = `calc(var(--head) + ${Math.max(0, step) * state.zoom}px)`;
  }
  document.querySelectorAll("[data-shade]").forEach((shade) => {
    const left = state.playLength * state.zoom;
    shade.style.left = `${left}px`;
    shade.style.width = `${Math.max(0, 64 - state.playLength) * state.zoom}px`;
  });
  document.querySelectorAll("[data-edge]").forEach((edge) => {
    edge.style.left = `${state.playLength * state.zoom}px`;
  });
  document.querySelectorAll("[data-clip-name]").forEach((label) => {
    label.textContent = `${machineNumber(state.slot)} · ${state.playLength}`;
  });
  const readout = $("position");
  if (readout && state.pattern) {
    if (state.playing && state.playMode === "song" && state.anchorTime) {
      const elapsed = Math.max(0, Math.floor((audio().currentTime - state.anchorTime) / state.stepDuration));
      const where = songAt(elapsed);
      readout.textContent = where
        ? `Song ${machineNumber(state.songSlot)} · ${machineNumber(where.slot)} · Step ${where.step + 1}`
        : "Song";
    } else {
      const cents = shownNote(currentTrack(), state.step);
      const marker = isMarker(currentTrack(), state.step) ? " · factory marker" : "";
      readout.textContent = `CH${state.track + 1} · Step ${state.step + 1} · ${noteName(cents)}${marker}`;
    }
  }
  const length = $("play-length");
  if (length && document.activeElement !== length) length.value = String(state.playLength);
  const zoom = $("zoom");
  if (zoom && document.activeElement !== zoom) zoom.value = String(state.zoom);
  const playing = state.playing ? step : -1;
  document.querySelectorAll(".step-picks button[data-step]").forEach((button) => {
    button.classList.toggle("playing", Number(button.dataset.step) === playing);
  });
}

function syncInspector() {
  ensureSession();
  if (!state.pattern) return;
  state.pattern.tracks.forEach((track, index) => {
    const note = document.querySelector(`[data-track-note="${index}"]`);
    if (note) {
      const name = noteName(shownNote(track, state.step));
      note.textContent = index === state.track && name !== "—" ? name : "";
    }
    const cents = document.querySelector(`[data-cents="${index}"]`);
    if (cents && document.activeElement !== cents) cents.value = String(shownNote(track, state.step));
    const cv = document.querySelector(`[data-cv="${index}"]`);
    if (cv && document.activeElement !== cv) cv.value = String(track.cvCents);
    setSelect(`[data-input-scale="${index}"]`, track.inputScale);
    setSelect(`[data-output-scale="${index}"]`, track.outputScale);
    const root = document.querySelector(`[data-root="${index}"]`);
    if (root && document.activeElement !== root) root.value = String(inferRoot(track.inputScale, track.scaleMask));
    const degrees = document.querySelector(`[data-degrees="${index}"]`);
    if (degrees) {
      const mask = track.footer[state.schema.scaleMaskOffset] | (track.footer[state.schema.scaleMaskOffset + 1] << 8);
      degrees.innerHTML = NAMES.map((name, degree) => `<span class="degree${mask & (1 << degree) ? " on" : ""}">${name.replace("#", "♯")}</span>`).join("");
    }
    const gate = document.querySelector(`[data-readout="gate-${index}"]`);
    if (gate) gate.textContent = String(gateOf(track, state.step));
    const gateIndex = document.querySelector(`[data-readout="gate-index-${index}"]`);
    if (gateIndex) gateIndex.textContent = gatePhrase(state.step, track.steps[state.step][state.schema.gateOffset]);
    const voltRead = document.querySelector(`[data-readout="volt-${index}"]`);
    if (voltRead) voltRead.textContent = voltReadout(state.step, track.performance?.modVolt?.[state.step]);
    const decayRead = document.querySelector(`[data-readout="decay-${index}"]`);
    if (decayRead) decayRead.textContent = timeReadout("Decay", state.step, (track.performance?.decay?.[state.step] || 0) / 50);
    const releaseRead = document.querySelector(`[data-readout="release-${index}"]`);
    if (releaseRead) releaseRead.textContent = timeReadout("Release", state.step, (track.performance?.release?.[state.step] || 0) / 50);
    const level = document.querySelector(`[data-readout="level-${index}"]`);
    if (level) level.textContent = String(track.steps[state.step][state.schema.levelOffset]);
    document.querySelectorAll(`[data-float][data-track="${index}"]`).forEach((input) => {
      if (document.activeElement === input) return;
      const value = readF32(track.footer, Number(input.dataset.float));
      if (input.type === "range") input.max = "1";
      input.value = String(Number(value.toPrecision(6)));
    });
    const stepBox = document.querySelector(`[data-step-bytes="${index}"]`);
    const trackBox = document.querySelector(`[data-track-bytes="${index}"]`);
    const floatBox = document.querySelector(`[data-floats="${index}"]`);
    if (stepBox) renderByteGrid(stepBox, track.steps[state.step], "step");
    if (trackBox) renderByteGrid(trackBox, track.footer, "track");
    if (floatBox) renderFloats(floatBox, track.footer);
  });
  document.querySelectorAll(".track-head").forEach((head, index) => head.classList.toggle("selected", index === state.track));
  draw();
}

function setSelect(selector, value) {
  const select = document.querySelector(selector);
  if (!select || document.activeElement === select) return;
  select.value = value;
}

function draw() {
  ensureSession();
  paintAll();
}

function scrollRollIntoView() {
  const scroller = document.querySelector(`[data-note-scroll="${state.track}"]`);
  if (!scroller || !state.pattern) return;
  const notes = currentTrack().steps.map((_, step) => shownNote(currentTrack(), step)).filter((note) => note);
  const center = notes.length ? Math.round(notes.reduce((sum, note) => sum + note, 0) / notes.length / 100) : 48;
  scroller.scrollTop = Math.max(0, (HIGH - center) * CELL_H - 80);
}

function byteLabel(kind, offset) {
  if (kind === "step" && offset === 0) return "Gate";
  if (kind === "step" && offset === 1) return "Ratchet";
  if (kind === "step" && offset === 2) return "Arp";
  if (kind === "step" && offset === 3) return "Repeat";
  if (kind === "step" && offset === state.schema.gateIndexOffset) return "Chance";
  if (kind === "step" && offset === state.schema.flagOffset) return "Marker";
  if (kind === "step" && offset === state.schema.levelOffset) return "Level";
  if (kind === "track" && offset === state.schema.scaleMaskOffset) return "Mask";
  if (kind === "track" && offset === state.schema.scaleMaskOffset + 1) return "Mask hi";
  const floatIndex = state.schema.floatOffsets.indexOf(offset);
  if (kind === "track" && floatIndex >= 0) return `Val ${floatIndex + 1}`;
  return String(offset);
}

function hiddenTrackByte(offset) {
  return [state.schema.inputScaleOffset, state.schema.outputScaleOffset].some((start) => offset >= start && offset < start + state.schema.scaleNameLength);
}

function renderByteGrid(container, bytes, kind) {
  const hidden = kind === "track" ? bytes.map((_, offset) => offset).filter(hiddenTrackByte).join(",") : "30,31,32,33";
  const signature = `${kind}:${bytes.length}:${hidden}`;
  if (container.dataset.signature !== signature) {
    container.dataset.signature = signature;
    container.innerHTML = bytes.map((value, offset) => {
      if (kind === "step" && offset >= state.schema.noteOffset) return "";
      if (kind === "track" && hiddenTrackByte(offset)) return "";
      return `<label>${byteLabel(kind, offset)}<input data-byte="${offset}" type="number" min="0" max="255" step="1" value="${value}"></label>`;
    }).join("");
    return;
  }
  container.querySelectorAll("[data-byte]").forEach((input) => {
    if (document.activeElement === input) return;
    input.value = bytes[Number(input.dataset.byte)];
  });
}

function renderFloats(box, footer) {
  if (box.dataset.ready !== "1") {
    box.dataset.ready = "1";
    box.innerHTML = state.schema.floatOffsets.map((offset, index) => `
      <label>Value ${index + 1}<input data-float-box="${offset}" type="number" step="0.01"></label>
    `).join("");
  }
  box.querySelectorAll("[data-float-box]").forEach((input) => {
    if (document.activeElement === input) return;
    input.value = String(Number(readF32(footer, Number(input.dataset.floatBox)).toPrecision(6)));
  });
}

function writeClampedByte(bytes, offset, raw) {
  const value = Math.max(0, Math.min(255, Math.round(Number(raw))));
  if (!Number.isFinite(value)) return;
  bytes[offset] = value;
}

function selectTrack(index) {
  state.track = index;
  syncInspector();
}

function canvasStep(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const step = Math.floor((event.clientX - rect.left) / state.zoom);
  if (step < 0 || step > 63) return null;
  return { rect, step };
}

function noteCell(event, canvas) {
  const hit = canvasStep(event, canvas);
  if (!hit) return null;
  const row = Math.floor((event.clientY - hit.rect.top) / CELL_H);
  const midi = HIGH - row;
  if (midi < LOW || midi > HIGH) return null;
  return { step: hit.step, midi };
}

function barValue(event, canvas, max) {
  const hit = canvasStep(event, canvas);
  if (!hit) return null;
  const ratio = 1 - (event.clientY - hit.rect.top) / hit.rect.height;
  const value = Math.round(Math.max(0, Math.min(1, ratio)) * max);
  return { step: hit.step, value };
}

function applyBar(kind, trackIndex, step, value) {
  const track = state.pattern.tracks[trackIndex];
  if (kind === "gate") writeU32(track.steps[step], state.schema.gateOffset, value);
  else if (kind === "gate-index") {
    const bytes = track.steps[step];
    const previous = bytes[state.schema.gateOffset] || 0;
    const chance = bytes[state.schema.gateIndexOffset] || 0;
    bytes[state.schema.gateOffset] = value;
    if (chance <= 10 && previous === chance * 10) bytes[state.schema.gateIndexOffset] = 10;
  }
  else if (kind === "level") track.steps[step][state.schema.levelOffset] = value;
  else return;
  state.dirty = true;
  $("save").textContent = "Save pattern *";
  state.step = step;
  state.track = trackIndex;
}

const rows = () => $("daw-rows");

rows()?.addEventListener("click", (event) => {
  const mute = event.target.closest("[data-mute]");
  const solo = event.target.closest("[data-solo]");
  if ((mute || solo) && state.pattern) {
    const index = Number((mute || solo).dataset.mute ?? (mute || solo).dataset.solo);
    const key = mute ? "mute" : "solo";
    state.mix[index][key] = !state.mix[index][key];
    const button = mute || solo;
    button.classList.toggle("on", state.mix[index][key]);
    button.setAttribute("aria-pressed", String(state.mix[index][key]));
    button.closest(".daw-row")?.classList.toggle("muted", state.mix[index].mute);
    if (mute && state.rack) {
      const mixer = state.rack.modules.find((item) => item.type === "erica_mixer");
      if (mixer) {
        mixer.params[`mute${index + 1}`] = state.mix[index].mute ? 1 : 0;
        if (typeof saveRack === "function") saveRack();
        if (typeof rackVoiceRefresh === "function") rackVoiceRefresh(mixer, state.rack.lastSignals);
        if (!$("rack-view")?.hidden && typeof renderRack === "function") renderRack();
      }
    }
    return;
  }
  const tool = event.target.closest("[data-tool]");
  if (tool && state.pattern) {
    state.track = Number(tool.dataset.track);
    if (tool.dataset.tool === "quantize") openLane(Number(tool.dataset.track), "quantize");
    if (tool.dataset.tool === "down") transpose(-12);
    if (tool.dataset.tool === "up") transpose(12);
    return;
  }
  const select = event.target.closest("[data-select]");
  if (select) selectTrack(Number(select.dataset.select));
  const ruler = event.target.closest("#ruler");
  if (ruler) {
    const hit = canvasStep(event, ruler);
    if (!hit) return;
    state.step = hit.step;
    syncInspector();
  }
});

rows()?.addEventListener("change", (event) => {
  if (!state.pattern) return;
  const input = event.target;
  if (input.dataset.voice !== undefined) return;
  const trackIndex = Number(input.dataset.inputScale ?? input.dataset.outputScale ?? input.dataset.cv ?? input.dataset.cents ?? input.dataset.track ?? state.track);
  if (input.dataset.inputScale !== undefined) {
    const scale = scaleByName(input.value);
    if (!scale) return;
    state.track = Number(input.dataset.inputScale);
    pushUndo();
    const track = currentTrack();
    writeScaleName(track.footer, state.schema.inputScaleOffset, scale.name);
    track.footer[state.schema.scaleMaskOffset] = scale.mask & 255;
    track.footer[state.schema.scaleMaskOffset + 1] = (scale.mask >> 8) & 255;
    track.inputScale = scale.name;
    track.scaleMask = scale.mask;
    state.dirty = true;
    syncInspector();
    renderPads();
    return;
  }
  if (input.dataset.outputScale !== undefined) {
    state.track = Number(input.dataset.outputScale);
    pushUndo();
    const track = currentTrack();
    writeScaleName(track.footer, state.schema.outputScaleOffset, input.value);
    track.outputScale = input.value;
    state.dirty = true;
    syncInspector();
    renderPads();
    return;
  }
  if (input.dataset.cv !== undefined) {
    state.track = Number(input.dataset.cv);
    pushUndo();
    currentTrack().cvCents = Number(input.value);
    state.dirty = true;
    syncInspector();
    renderPads();
    return;
  }
  if (input.dataset.cents !== undefined) {
    state.track = Number(input.dataset.cents);
    pushUndo();
    paint(state.step, Number(input.value));
    return;
  }
  if (input.dataset.floatBox !== undefined) {
    const box = input.closest("[data-floats]");
    state.track = Number(box.dataset.floats);
    pushUndo();
    writeF32(currentTrack().footer, Number(input.dataset.floatBox), Number(input.value));
    state.dirty = true;
    syncInspector();
    renderPads();
    return;
  }
  if (input.matches("[data-byte]")) {
    const stepBox = input.closest("[data-step-bytes]");
    const trackBox = input.closest("[data-track-bytes]");
    pushUndo();
    if (stepBox) {
      state.track = Number(stepBox.dataset.stepBytes);
      writeClampedByte(currentTrack().steps[state.step], Number(input.dataset.byte), input.value);
    } else if (trackBox) {
      state.track = Number(trackBox.dataset.trackBytes);
      const track = currentTrack();
      writeClampedByte(track.footer, Number(input.dataset.byte), input.value);
      track.inputScale = readName(track.footer, state.schema.inputScaleOffset);
      track.outputScale = readName(track.footer, state.schema.outputScaleOffset);
      track.scaleMask = track.footer[state.schema.scaleMaskOffset] | (track.footer[state.schema.scaleMaskOffset + 1] << 8);
    }
    state.dirty = true;
    syncInspector();
    renderPads();
  }
  if (Number.isFinite(trackIndex)) state.track = state.track;
});

rows()?.addEventListener("input", (event) => {
  const input = event.target.closest("[data-float]");
  if (!input || !state.pattern) return;
  state.track = Number(input.dataset.track);
  writeF32(currentTrack().footer, Number(input.dataset.float), Number(input.value));
  state.dirty = true;
  draw();
  renderPads();
});

rows()?.addEventListener("pointerdown", (event) => {
  const input = event.target.closest("[data-float]");
  if (input && state.pattern) pushUndo();
});

rows()?.addEventListener("mouseover", (event) => {
  const key = event.target.closest(".key[data-midi]");
  if (!key || !state.pattern) return;
  const trackIndex = Number(key.closest("[data-lane-track]")?.dataset.laneTrack ?? state.track);
  const note = document.querySelector(`[data-track-note="${trackIndex}"]`);
  if (note) note.textContent = noteName(Number(key.dataset.midi) * 100);
});

rows()?.addEventListener("mouseout", (event) => {
  const key = event.target.closest(".key[data-midi]");
  if (!key || !state.pattern) return;
  if (event.relatedTarget?.closest?.(".key[data-midi]")) return;
  syncInspector();
});

rows()?.addEventListener("mousedown", (event) => {
  if (!state.pattern) return;
  const resize = event.target.closest("[data-roll-resize]");
  if (resize) {
    const startY = event.clientY;
    const host = resize.closest(".notes-row");
    const start = parseFloat(getComputedStyle(host).getPropertyValue("--roll-h")) || 220;
    const onMove = (move) => {
      const next = Math.max(120, Math.min(420, start + (move.clientY - startY)));
      host.style.setProperty("--roll-h", `${next}px`);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    event.preventDefault();
    return;
  }
  const key = event.target.closest(".key[data-midi]");
  if (key) {
    const strip = key.closest("[data-keys]");
    const trackIndex = Number(strip?.closest("[data-lane-track]")?.dataset.laneTrack ?? state.track);
    state.track = trackIndex;
    key.classList.add("playing");
    auditionKey(trackIndex, Number(key.dataset.midi), true);
    event.preventDefault();
    return;
  }
  const edge = event.target.closest("[data-edge]");
  if (edge) {
    state.gesture = { kind: "length" };
    event.preventDefault();
    return;
  }
  const canvas = event.target.closest("canvas[data-kind]");
  if (!canvas) {
    const clip = event.target.closest("[data-clip]");
    if (!clip) return;
    const lane = clip.querySelector("canvas");
    const hit = canvasStep(event, lane);
    if (!hit) return;
    state.track = Number(clip.dataset.clip);
    state.step = hit.step;
    syncInspector();
    return;
  }
  const kind = canvas.dataset.kind;
  const trackIndex = Number(canvas.dataset.track);
  state.track = trackIndex;
  if (kind === "clip") {
    const hit = canvasStep(event, canvas);
    if (!hit) return;
    state.step = hit.step;
    syncInspector();
    return;
  }
  if (kind === "notes" || kind === "mod-note") {
    const cell = noteCell(event, canvas);
    if (!cell) return;
    pushUndo();
    const track = state.pattern.tracks[trackIndex];
    const existing = kind === "notes" ? shownNote(track, cell.step) : (perf(track).modNote[cell.step] || 0);
    const cents = existing === cell.midi * 100 ? 0 : cell.midi * 100;
    state.gesture = { kind, track: trackIndex, step: cell.step, midi: cell.midi, cents, locked: null };
    if (kind === "notes") {
      paint(cell.step, cents);
      if (cents) trigger(trackIndex, cents, 50, 100, audio().currentTime, 0.2);
    } else {
      paintMod(cell.step, cents);
    }
    return;
  }
  if (beginFunctionDrag(event, canvas)) return;
  if (kind !== "gate-index" && kind !== "level") return;
  const max = 100;
  const hit = barValue(event, canvas, max);
  if (!hit) return;
  pushUndo();
  state.gesture = { kind, track: trackIndex, max };
  applyBar(kind, trackIndex, hit.step, hit.value);
  syncInspector();
});

window.addEventListener("mousemove", (event) => {
  if (!state.gesture || !state.pattern) return;
  if (state.gesture.fn) {
    moveFunctionDrag(event);
    return;
  }
  if (state.gesture.kind === "length") {
    const lane = document.querySelector("[data-clip]");
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    state.playLength = Math.max(1, Math.min(64, Math.round((event.clientX - rect.left) / state.zoom)));
    draw();
    return;
  }
  const canvas = document.querySelector(`canvas[data-kind="${state.gesture.kind}"][data-track="${state.gesture.track}"]`);
  if (!canvas) return;
  if (state.gesture.kind === "notes" || state.gesture.kind === "mod-note") {
    const cell = noteCell(event, canvas);
    if (!cell) return;
    if (!state.gesture.locked) {
      if (cell.step !== state.gesture.step) state.gesture.locked = "paint";
      else if (cell.midi !== state.gesture.midi) state.gesture.locked = "pitch";
    }
    state.track = state.gesture.track;
    const apply = state.gesture.kind === "notes" ? paint : paintMod;
    if (state.gesture.locked === "paint") apply(cell.step, state.gesture.cents);
    if (state.gesture.locked === "pitch" && cell.step === state.gesture.step) {
      state.gesture.midi = cell.midi;
      apply(cell.step, cell.midi * 100);
    }
    return;
  }
  const hit = barValue(event, canvas, state.gesture.max);
  if (!hit) return;
  applyBar(state.gesture.kind, state.gesture.track, hit.step, hit.value);
  draw();
  const readout = document.querySelector(`[data-readout="${state.gesture.kind}-${state.gesture.track}"]`);
  if (readout) readout.textContent = `Step ${hit.step + 1} · ${hit.value}`;
});

window.addEventListener("mouseup", () => {
  state.gesture = null;
  releaseKeyAudition();
});

window.addEventListener("blur", () => {
  releaseKeyAudition();
});

$("zoom").addEventListener("input", () => {
  state.zoom = Number($("zoom").value);
  $("daw-rows").dataset.signature = "";
  draw();
  syncInspector();
});

$("play-length").addEventListener("input", () => {
  state.playLength = Math.max(1, Math.min(64, Number($("play-length").value) || 1));
  draw();
});
