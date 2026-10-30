const VCO_TYPES = { sine: "sine", square: "square", saw: "sawtooth", triangle: "triangle" };

/** Audition a single pitch on one sequencer channel through the live rack when possible. */
function voiceTrigger(trackIndex, cents, gate, level, when, stepDuration, mod = 0) {
  const channel = trackIndex + 1;
  const cv = (cents - 4800) / 1200;
  const signals = { stepDuration };
  for (let index = 1; index <= 4; index += 1) {
    const on = index === channel;
    signals[`step${index}`] = 0;
    signals[`cv${index}`] = on ? cv : 0;
    signals[`to${index}`] = on ? cv : 0;
    signals[`from${index}`] = null;
    signals[`gate${index}`] = on ? 5 : 0;
    signals[`mod${index}`] = on ? Number(mod) || 0 : 0;
    signals[`dur${index}`] = stepDuration;
    signals[`span${index}`] = stepDuration;
    signals[`slice${index}`] = Math.max(0.02, stepDuration * Math.min(gate, 100) / 100);
    signals[`attack${index}`] = on ? 1 : 0;
    signals[`nudge${index}`] = 0;
    signals[`glide${index}`] = 0;
  }
  const audition = !state.playing;
  if (audition && typeof setPlaybackAudible === "function") setPlaybackAudible(true);
  if (typeof rackPlay === "function") {
    try {
      rackPlay(signals, when);
      if (audition && typeof setPlaybackAudible === "function") {
        const ms = Math.max(80, stepDuration * Math.min(gate, 100) * 10 + 120);
        window.setTimeout(() => {
          if (!state.playing) setPlaybackAudible(false);
        }, ms);
      }
      return;
    } catch (error) {
      console.error(error);
    }
  }
  const ctx = audio();
  const frequency = 440 * 2 ** ((cents / 100 - 69) / 12);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = ["sawtooth", "square", "triangle", "sine"][trackIndex % 4];
  oscillator.frequency.setValueAtTime(frequency, when);
  const peak = 0.07 * (level / 100);
  const length = Math.max(0.02, stepDuration * Math.min(gate, 100) / 100);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
  oscillator.connect(gain).connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
  oscillator.start(when);
  oscillator.stop(when + length + 0.02);
}

function stepMod(track, step) {
  const performance = track.performance;
  if (!performance) return 0;
  if (performance.modMode === "notes") {
    const cents = performance.modNote?.[step] || 0;
    if (!cents) return 0;
    return Math.max(-1, Math.min(1, cents / 2400));
  }
  const volt = Number(performance.modVolt?.[step] || 0);
  return Math.max(-1, Math.min(1, volt / 100));
}

function envelope(ctx, when, duration, peak) {
  const gain = ctx.createGain();
  const hold = Math.max(0.03, duration);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + hold);
  return gain;
}

function tone(ctx, when, type, frequency, stop, from, glide) {
  const osc = ctx.createOscillator();
  osc.type = type;
  const target = Math.max(20, frequency);
  const start = Math.max(20, from || frequency);
  osc.frequency.setValueAtTime(start, when);
  if (glide > 0 && Math.abs(start - target) > 0.5) {
    osc.frequency.exponentialRampToValueAtTime(target, when + glide);
  }
  osc.start(when);
  osc.stop(stop);
  return osc;
}

function vcoVoice(ctx, when, type, frequency, mod, duration, peak, from, glide) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(160 + ((mod + 1) / 2) * 7400, when);
  const gain = envelope(ctx, when, duration, peak);
  tone(ctx, when, type, frequency, when + duration + 0.05, from, glide).connect(filter);
  filter.connect(gain).connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
}

function plaitsVoice(ctx, when, frequency, mod, duration, peak, from, glide) {
  const mix = (mod + 1) / 2;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(180 + mix * 5200, when);
  filter.Q.setValueAtTime(0.6 + mix * 6, when);
  const kind = mix > 0.66 ? "square" : mix > 0.33 ? "sawtooth" : "triangle";
  const stop = when + duration + 0.05;
  const gain = envelope(ctx, when, duration, peak);
  tone(ctx, when, kind, frequency, stop, from, glide).connect(filter);
  tone(ctx, when, "sawtooth", frequency * (1 + mix), stop, from ? from * (1 + mix) : 0, glide).connect(filter);
  filter.connect(gain).connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
}

function noiseBurst(ctx, when, seconds) {
  const count = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < count; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / count);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.start(when);
  source.stop(when + seconds);
  return source;
}

function ringsVoice(ctx, when, frequency, mod, duration, peak, damping = 0.5, structure = 0.5, position = 0.5) {
  const now = ctx.currentTime;
  const start = Math.max(now, when);
  const note = Math.max(50, Math.min(1200, frequency));
  const brightness = Math.max(0, Math.min(1, (mod + 1) / 2));
  const dampAmount = Math.max(0, Math.min(1, damping));
  const body = Math.max(0, Math.min(1, structure));
  const place = Math.max(0, Math.min(1, position));
  const period = Math.max(0.0005, 1 / note - 128 / ctx.sampleRate);
  const ring = Math.min(1.15, Math.max(0.08, 0.16 + (1 - dampAmount) * 0.8 + brightness * 0.1));
  const loop = Math.min(0.99, Math.pow(0.05, period / ring));
  const delay = ctx.createDelay(0.05);
  delay.delayTime.setValueAtTime(period, now);
  const feedback = ctx.createGain();
  feedback.gain.setValueAtTime(0, now);
  delay.connect(feedback).connect(delay);
  const color = ctx.createBiquadFilter();
  color.type = "lowpass";
  color.frequency.setValueAtTime(Math.min(8000, note * (2 + brightness * 8) * (0.45 + place)), now);
  color.Q.setValueAtTime(0.4 + body * 4, now);
  const level = Math.max(0.0002, peak);
  const excite = ctx.createGain();
  excite.gain.setValueAtTime(0.0001, now);
  excite.gain.setValueAtTime(0.28 + body * 0.35, start);
  excite.gain.exponentialRampToValueAtTime(0.0001, start + 0.008 + (1 - body) * 0.02);
  tone(ctx, start, body > 0.55 ? "sawtooth" : "triangle", note, start + 0.02).connect(excite).connect(delay);
  const release = start + Math.min(1.25, Math.max(duration, ring));
  const out = envelope(ctx, start, release - start, level * 2.2);
  delay.connect(color).connect(out).connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
  const hold = start + ring * 0.7;
  feedback.gain.setValueAtTime(loop, start);
  feedback.gain.setValueAtTime(loop, hold);
  feedback.gain.exponentialRampToValueAtTime(0.0001, release);
  window.setTimeout(() => {
    delay.disconnect();
    feedback.disconnect();
    color.disconnect();
    out.disconnect();
  }, Math.max(0, (release - ctx.currentTime) * 1000) + 80);
}

function cloudsVoice(ctx, when, frequency, mod, duration, peak) {
  const amount = (mod + 1) / 2;
  const delay = ctx.createDelay(1);
  delay.delayTime.setValueAtTime(0.015 + amount * 0.22, when);
  const feedback = ctx.createGain();
  feedback.gain.setValueAtTime(0.2 + amount * 0.55, when);
  const smear = ctx.createBiquadFilter();
  smear.type = "bandpass";
  smear.frequency.setValueAtTime(Math.max(80, frequency * (0.5 + amount * 2)), when);
  smear.Q.setValueAtTime(0.7 + amount * 6, when);
  const stop = when + duration + 0.08;
  const dry = tone(ctx, when, "triangle", frequency, stop);
  const grain = tone(ctx, when, "sine", Math.max(20, frequency * (1.01 + amount * 0.08)), stop);
  dry.connect(delay);
  grain.connect(delay);
  delay.connect(smear).connect(feedback).connect(delay);
  const out = envelope(ctx, when, duration + amount * 0.35, peak);
  delay.connect(out).connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
  feedback.gain.setTargetAtTime(0.0001, when + duration, 0.12);
}

function drumVoice(ctx, when, semitone, mod, peak) {
  const decay = 0.08 + ((mod + 1) / 2) * 0.22;
  const out = ctx.createGain();
  out.gain.setValueAtTime(peak, when);
  out.connect(typeof playbackOut === "function" ? playbackOut() : ctx.destination);
  if (semitone < 40) {
    const body = tone(ctx, when, "sine", 160, when + decay + 0.05);
    body.frequency.exponentialRampToValueAtTime(42, when + decay);
    body.connect(out);
    noiseBurst(ctx, when, 0.012).connect(out);
    return;
  }
  if (semitone < 55) {
    const body = tone(ctx, when, "triangle", 180 + mod * 40, when + 0.16);
    body.connect(out);
    const noise = noiseBurst(ctx, when, 0.12 + ((mod + 1) / 2) * 0.08);
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 900;
    noise.connect(high).connect(out);
    return;
  }
  const noise = noiseBurst(ctx, when, 0.04 + ((mod + 1) / 2) * 0.05);
  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 4000 + mod * 1500;
  noise.connect(high).connect(out);
}

