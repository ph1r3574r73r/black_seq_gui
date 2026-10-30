function gateHolds(track, step) {
  return (track.steps[step][state.schema.gateOffset] || 0) >= 100;
}

function songAt(index) {
  const entries = state.song?.entries || [];
  let cycle = 0;
  const spans = entries.map((entry, entryIndex) => {
    const repeats = Math.min(64, Math.max(1, Number(entry.repeats) || 1));
    const steps = repeats * 64;
    cycle += steps;
    return { entryIndex, slot: slotName(entry.pattern, "SEQ"), steps };
  });
  if (!cycle) return null;
  let at = index % cycle;
  if (at < 0) at += cycle;
  for (const span of spans) {
    if (at < span.steps) return { index: span.entryIndex, slot: span.slot, step: at % 64 };
    at -= span.steps;
  }
  return null;
}

function patternFor(slot) {
  if (slot === state.slot && state.pattern) return state.pattern;
  return state.playCache?.get(slot) || null;
}

async function prepareSong() {
  const entries = state.song?.entries || [];
  if (!entries.length) {
    setStatus("This song is empty. Add a pattern, then play.", "error");
    return false;
  }
  const have = new Set(bankInfo()?.patterns || []);
  const cache = new Map();
  if (state.pattern) cache.set(state.slot, state.pattern);
  const slots = [...new Set(entries.map((entry) => slotName(entry.pattern, "SEQ")))]
    .filter((slot) => have.has(slot) && !cache.has(slot));
  const base = `root=${encodeURIComponent(state.root)}&project=${encodeURIComponent(state.projectName)}&bank=${state.bank}`;
  for (const slot of slots) cache.set(slot, await api(`/api/pattern?${base}&slot=${slot}`));
  state.playCache = cache;
  state.playEntry = -1;
  return true;
}

const ARP_MAJOR = [0, 4, 7, 12, 16, 19, 24, 28];

function freshClocks(slot) {
  state.trackClock = [0, 1, 2, 3].map(() => ({ pos: 0, left: 0, step: 0, hold: false, times: 1, play: false, cv: 0, heard: false }));
  state.clockSlot = slot || state.slot;
}

function repeatTimes(track, step) {
  const count = track.performance?.repeat?.[step] || 0;
  return count > 1 ? count : 1;
}

function glidePortion(track, step) {
  const painted = Math.max(0, Math.min(100, track.performance?.glide?.[step] || 0)) / 100;
  const master = Math.max(0, Math.min(100, track.performance?.glideMaster || 0)) / 100;
  return painted * (master > 0 ? master : 1);
}

function arpRatios(track, step, count) {
  const name = String(track.performance?.arp?.[step] || "Off");
  if (name === "Off" || count < 2 || !name.endsWith("MAJ")) return null;
  const down = name.startsWith("−") || name.startsWith("-");
  return Array.from({ length: count }, (_, index) => {
    const semis = ARP_MAJOR[Math.min(index, ARP_MAJOR.length - 1)];
    return 2 ** ((down ? -semis : semis) / 12);
  });
}

function takeTrack(index, track, length) {
  if (!state.trackClock) freshClocks();
  const clock = state.trackClock[index];
  if (clock.left > 0) {
    clock.left -= 1;
    return { step: clock.step, sustain: clock.hold, times: clock.times, entered: false };
  }
  const step = playStep(track, clock.pos, length);
  const times = repeatTimes(track, step);
  const hold = times > 1 && Boolean(track.performance?.repeatMerge?.[step]);
  clock.step = step;
  clock.left = times - 1;
  clock.hold = hold;
  clock.times = times;
  clock.pos = (clock.pos + 1) % length;
  clock.play = Boolean(shownNote(track, step)) && !isMarker(track, step) && chanceAllows(track, step);
  return { step, sustain: false, times, entered: true };
}

function cuePerformance(signals, when) {
  if (!state.rack) return;
  if (!state.rack.cues) state.rack.cues = [];
  state.rack.cues.push({ when, signals });
  const now = audio().currentTime;
  const horizon = (signals.stepDuration || 0.2) * 8;
  state.rack.cues = state.rack.cues.filter((cue) => cue.when > now - horizon);
}

function signalsAt(now) {
  const cues = state.rack?.cues;
  if (!cues?.length) return null;
  let base = null;
  for (const cue of cues) if (cue.when <= now) base = cue;
  if (!base) base = cues[0];
  const mixed = { ...base.signals };
  for (let channel = 1; channel <= 4; channel += 1) {
    let cue = null;
    for (const item of cues) {
      if (item.when + (item.signals[`nudge${channel}`] || 0) <= now) cue = item;
    }
    if (!cue) {
      mixed[`gate${channel}`] = 0;
      mixed[`attack${channel}`] = 0;
      mixed[`cv${channel}`] = 0;
      continue;
    }
    const source = cue.signals;
    const start = cue.when + (source[`nudge${channel}`] || 0);
    const elapsed = now - start;
    const span = source[`span${channel}`] || source.stepDuration || 0.1;
    if (elapsed > span) {
      mixed[`gate${channel}`] = 0;
      mixed[`attack${channel}`] = 0;
      continue;
    }
    const ratios = source[`ratios${channel}`];
    const hits = source[`ratchet${channel}`] || 1;
    const slice = source[`slice${channel}`] || source.stepDuration || 0.1;
    let cv = source[`to${channel}`] || 0;
    let attack = source[`attack${channel}`] ? 1 : 0;
    let gate = source[`gate${channel}`] || 0;
    if (hits > 1) {
      const index = Math.max(0, Math.min(hits - 1, Math.floor(elapsed / slice)));
      if (ratios) cv += Math.log2(ratios[Math.min(index, ratios.length - 1)] || 1);
      const into = elapsed - index * slice;
      const hit = into < Math.min(0.03, slice * 0.45);
      attack = hit ? 1 : 0;
      gate = hit ? gate : 0;
    } else {
      const glide = source[`glide${channel}`] || 0;
      const from = source[`from${channel}`];
      if (glide > 0 && elapsed < glide && from != null) cv = from + (cv - from) * (elapsed / glide);
    }
    mixed[`cv${channel}`] = cv;
    mixed[`gate${channel}`] = gate;
    mixed[`attack${channel}`] = attack;
    mixed[`mod${channel}`] = source[`mod${channel}`] || 0;
    mixed[`dur${channel}`] = source[`dur${channel}`] || span;
    mixed[`step${channel}`] = source[`step${channel}`] || 0;
  }
  return mixed;
}

function heardNow(fallback) {
  if (!state.playing) return fallback;
  return signalsAt(audio().currentTime) || fallback;
}

function sequencerSignals(pattern, _stepPos, length, stepDuration) {
  const signals = { stepDuration, slot: state.slot };
  const anySolo = state.mix.some((item) => item.solo);
  for (let trackIndex = 0; trackIndex < 4; trackIndex += 1) {
    const name = trackIndex + 1;
    const mix = state.mix[trackIndex];
    const quiet = !pattern || mix.mute || (anySolo && !mix.solo);
    let cv = 0;
    let gate = 0;
    let mod = 0;
    let dur = stepDuration;
    let attack = 0;
    let step = 0;
    let nudge = 0;
    let glide = 0;
    let from = null;
    let span = stepDuration;
    if (!quiet) {
      const track = pattern.tracks[trackIndex];
      const taken = takeTrack(trackIndex, track, length);
      const clock = state.trackClock[trackIndex];
      step = taken.step;
      mod = stepMod(track, step) * 5;
      if (!taken.sustain) nudge = ((track.performance?.timing?.[step] || 0) / 100) * stepDuration;
      const cents = shownNote(track, step);
      if (cents && clock.play) {
        cv = (cents - 4800) / 1200;
        const pieces = Math.max(1, ratchetCount(track, step));
        const ratios = taken.sustain ? null : arpRatios(track, step, pieces);
        if (!taken.sustain && glidePortion(track, step) > 0 && clock.heard) {
          glide = glidePortion(track, step) * stepDuration;
          from = clock.cv;
        }
        if (taken.sustain) {
          gate = 5;
          span = stepDuration;
        } else {
          const forward = (track.performance?.direction || "forward") === "forward";
          const held = forward && taken.times === 1 && step > 0 && gateHolds(track, step - 1) && shownNote(track, step - 1) === cents;
          if (!held && pieces > 1) {
            gate = 5;
            attack = 1;
            dur = stepDuration / pieces;
            span = stepDuration;
            signals[`ratchet${name}`] = pieces;
            if (ratios) signals[`ratios${name}`] = ratios;
          } else if (!held) {
            let run = 1;
            if (forward && taken.times === 1) {
              while (step + run < length && gateHolds(track, step + run - 1) && shownNote(track, step + run) === cents && !isMarker(track, step + run)) run += 1;
            }
            const closing = track.steps[Math.min(length, step + run) - 1]?.[state.schema.gateOffset] || 0;
            const portion = closing >= 100 ? 1 : Math.max(0, closing) / 100;
            const repeats = taken.times > 1 && track.performance?.repeatMerge?.[step] ? taken.times : run;
            if (portion > 0 || repeats > 1) {
              gate = 5;
              attack = 1;
              dur = (repeats - 1 + (portion || 1)) * stepDuration;
              span = taken.times > 1 && track.performance?.repeatMerge?.[step] ? stepDuration : dur;
            }
          } else {
            gate = 5;
            span = stepDuration;
          }
        }
        if (gate) {
          clock.cv = cv;
          clock.heard = true;
        }
      }
    }
    signals[`step${name}`] = step;
    signals[`cv${name}`] = cv;
    signals[`to${name}`] = cv;
    signals[`from${name}`] = from;
    signals[`gate${name}`] = gate;
    signals[`mod${name}`] = mod;
    signals[`dur${name}`] = dur;
    signals[`span${name}`] = span;
    signals[`attack${name}`] = attack;
    signals[`nudge${name}`] = nudge;
    signals[`glide${name}`] = glide;
    signals[`slice${name}`] = dur;
  }
  return signals;
}

function schedule() {
  const ctx = audio();
  const song = state.playMode === "song";
  const length = song ? 64 : (state.playLength || 16);
  const stepDuration = state.stepDuration;
  while (state.nextTime < ctx.currentTime + 0.2) {
    const where = song ? songAt(state.playIndex) : null;
    if (song && !where) {
      stopPlayback();
      return;
    }
    const pattern = song ? patternFor(where.slot) : state.pattern;
    const stepPos = song ? where.step : state.playIndex;
    if (song && where.slot !== state.clockSlot) freshClocks(where.slot);
    if (typeof rackPlay === "function") rackPlay(sequencerSignals(pattern, stepPos, length, stepDuration), state.nextTime);
    state.playIndex += 1;
    if (!song) state.playIndex %= length;
    state.nextTime += stepDuration;
  }
  draw();
  followSong();
}

function followSong() {
  if (state.playMode !== "song" || !state.playing || state.following) return;
  const elapsed = Math.floor((audio().currentTime - state.anchorTime) / state.stepDuration);
  const where = songAt(Math.max(0, elapsed));
  if (!where) return;
  if (where.index !== state.playEntry) {
    state.playEntry = where.index;
    document.querySelectorAll("#song-chain .chain-block").forEach((button) => {
      button.classList.toggle("sounding", Number(button.dataset.songIndex) === where.index);
    });
  }
  if (where.slot === state.slot || state.dirty) return;
  const pattern = state.playCache?.get(where.slot);
  if (!pattern) return;
  state.following = true;
  try {
    state.slot = where.slot;
    state.pattern = pattern;
    state.undo = [];
    state.redo = [];
    state.grids = "";
    state.step = where.step;
    renderPads();
    showChrome();
    syncInspector();
    draw();
  } finally {
    state.following = false;
  }
}

function audibleStep() {
  if (!state.playing || !state.anchorTime) return -1;
  const elapsed = audio().currentTime - state.anchorTime;
  const index = Math.floor(elapsed / state.stepDuration);
  if (index < 0) return 0;
  const cues = state.rack?.cues;
  const channel = state.track + 1;
  if (cues?.length) {
    let cue = null;
    for (const item of cues) {
      if (item.when + (item.signals[`nudge${channel}`] || 0) <= audio().currentTime) cue = item;
    }
    if (cue) {
      if (state.playMode === "song" && cue.signals.slot !== state.slot) return -1;
      return cue.signals[`step${channel}`] || 0;
    }
  }
  if (state.playMode === "song") {
    const where = songAt(index);
    if (!where || where.slot !== state.slot) return -1;
    const track = state.pattern?.tracks[state.track];
    return track ? playStep(track, where.step, 64) : where.step;
  }
  const length = state.playLength || 16;
  const raw = index % length;
  const track = state.pattern?.tracks[state.track];
  return track ? playStep(track, raw, length) : raw;
}

function syncPlayMode() {
  state.playMode = $("play-mode").value === "song" ? "song" : "pattern";
  const block = $("play-length");
  block.disabled = state.playMode === "song";
  block.title = state.playMode === "song"
    ? "Song plays all 64 steps of each pattern."
    : "How many steps this block plays in the editor. The pattern file still holds 64 steps.";
}

async function play() {
  if (state.playing || state.arming) return;
  state.arming = true;
  try {
    if (state.playMode === "song") {
      if (!await prepareSong()) return;
    } else if (!state.pattern) return;
    const ctx = audio();
    if (typeof bumpAudioGeneration === "function") bumpAudioGeneration();
    if (typeof setPlaybackAudible === "function") setPlaybackAudible(true);
    state.playing = true;
    state.playIndex = 0;
    freshClocks();
    if (state.rack) state.rack.cues = [];
    state.stepDuration = 60 / Number($("bpm").value) / 4;
    state.nextTime = ctx.currentTime + 0.05;
    state.anchorTime = state.nextTime;
    state.timer = setInterval(schedule, 25);
    $("play").classList.add("engaged");
    $("play").setAttribute("aria-pressed", "true");
    if (state.playMode === "song") setStatus(`Playing song ${machineNumber(state.songSlot)}`);
  } catch (error) {
    stopPlayback();
    setStatus(error.message, "error");
  } finally {
    state.arming = false;
  }
}

function silenceRackAudio() {
  if (typeof bumpAudioGeneration === "function") bumpAudioGeneration();
  if (typeof setPlaybackAudible === "function") setPlaybackAudible(false);
  if (state.rack) {
    state.rack.cues = [];
    const silent = { ...(state.rack.lastSignals || {}) };
    for (let channel = 1; channel <= 4; channel += 1) {
      silent[`gate${channel}`] = 0;
      silent[`attack${channel}`] = 0;
    }
    state.rack.lastSignals = silent;
    (state.rack.modules || []).forEach((module) => {
      if (module.type === "plaits" && typeof plaitsRefresh === "function") {
        if (typeof plaitsLast !== "undefined") plaitsLast.set(module.id, silent);
        plaitsRefresh(module);
      } else if (module.type === "rings" && typeof ringsRefresh === "function") {
        if (typeof ringsLast !== "undefined") ringsLast.set(module.id, silent);
        ringsRefresh(module);
      } else if (typeof miRefresh === "function") {
        miRefresh(module, silent);
      } else if (typeof rackVoiceRefresh === "function") {
        rackVoiceRefresh(module, silent);
      }
    });
  }
  if (typeof plaitsStop === "function") plaitsStop();
  if (typeof ringsStop === "function") ringsStop();
  if (typeof miStop === "function") miStop();
  if (typeof rackVoiceStop === "function") rackVoiceStop();
  if (typeof releaseKeyAudition === "function") releaseKeyAudition();
}

function stopPlayback() {
  const wasPlaying = state.playing;
  state.playing = false;
  state.playEntry = -1;
  state.playCache = null;
  state.trackClock = null;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  silenceRackAudio();
  document.querySelectorAll(".chain-block.sounding").forEach((button) => button.classList.remove("sounding"));
  if ($("play")) {
    $("play").classList.remove("engaged");
    $("play").setAttribute("aria-pressed", "false");
  }
  if (state.pattern) draw();
  if (wasPlaying && state.projectName) setStatus(`Bank ${machineNumber(state.bank)} · Pattern ${machineNumber(state.slot)}`);
}

$("stop").addEventListener("click", stopPlayback);
$("play").addEventListener("click", () => {
  if (!state.playing) play();
});
$("play-mode").addEventListener("change", () => {
  const was = state.playing;
  stopPlayback();
  syncPlayMode();
  if (was) play();
});
syncPlayMode();
