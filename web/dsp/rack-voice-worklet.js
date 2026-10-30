// Continuous voices for the non-Mutable-Instruments modules.
class RackVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kind = "";
    this.params = new Float32Array(64);
    this.inputsN = 0;
    this.outputsN = 1;
    this.phase = 0;
    this.held = [];
    this.env = 0;
    this.stage = 0;
    this.lp = 0;
    this.bp = 0;
    this.hp = 0;
    this.pink = new Float32Array(7);
    this.slow = 0;
    this.hold = 0;
    this.smooth = 0;
    this.delayL = new Float32Array(48000);
    this.delayR = new Float32Array(48000);
    this.delayPos = 0;
    this.combs = [1557, 1617, 1491, 1422].map((length) => ({ buf: new Float32Array(length), i: 0, d: 0 }));
    this.blocks = 0;
    this.clock = 0;
    this.period = 12000;
    this.div = [0, 0, 0, 0];
    this.drum = [0, 0, 0, 0, 0, 0];
    this.drumF = [0, 0, 0, 0, 0, 0];
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.kind) {
        this.kind = data.kind;
        this.inputsN = data.inputs || 0;
        this.outputsN = data.outputs || 1;
      } else if (data.params) this.params.set(data.params);
    };
  }

  knob(index, fallback) {
    const value = this.params[index];
    return Number.isFinite(value) ? value : fallback;
  }

  patched(index) {
    return this.params[40 + index] > 0.5;
  }

  audioIn(index) {
    return this.params[56 + index] > 0.5;
  }

  sample(inputs, index, frame) {
    if (!this.patched(index)) return 0;
    if (this.audioIn(index)) {
      const buffer = inputs[index] && inputs[index][0];
      return buffer ? buffer[frame] || 0 : 0;
    }
    return this.params[24 + index] || 0;
  }

  rise(index, value) {
    const high = value > 0.2;
    const edge = high && !this.held[index];
    this.held[index] = high;
    return edge;
  }

  note(coarse, volts) {
    return 48 + (coarse - 0.5) * 24 + volts * 60;
  }

  hz(midi) {
    return 440 * 2 ** ((midi - 69) / 12);
  }

  seconds(amount, low, high) {
    const span = Math.max(0, Math.min(1, amount));
    return low * (high / low) ** span;
  }

  svf(input, cutoff, resonance) {
    const f = 2 * Math.sin(Math.PI * Math.min(0.45, cutoff / sampleRate));
    const q = Math.max(0.05, resonance);
    this.lp += f * this.bp;
    this.hp = input - this.lp - q * this.bp;
    this.bp += f * this.hp;
    return [this.lp, this.bp, this.hp];
  }

  write(channels, values, frame) {
    for (let index = 0; index < this.outputsN; index += 1) {
      if (channels[index]) channels[index][frame] = values[index] || 0;
    }
  }

  process(inputs, outputs) {
    const channels = outputs[0];
    if (!channels || !channels[0] || !this.kind) return true;
    const frames = channels[0].length;
    try {
      for (let frame = 0; frame < frames; frame += 1) this.step(inputs, channels, frame);
      this.blocks += 1;
      if (this.blocks % 8 === 0) {
        const levels = [];
        const last = frames - 1;
        for (let index = 0; index < this.outputsN; index += 1) levels.push(channels[index] ? channels[index][last] : 0);
        this.port.postMessage({ levels });
      }
    } catch (error) {
      if (!this.reported) {
        this.reported = true;
        this.port.postMessage({ error: String(error && error.message || error) });
      }
    }
    return true;
  }

  step(inputs, channels, frame) {
    const kind = this.kind;
    if (kind === "vco") this.vco(inputs, channels, frame);
    else if (kind === "bassline") this.bassline(inputs, channels, frame);
    else if (kind === "polysynth") this.polysynth(inputs, channels, frame);
    else if (kind === "bitboy") this.bitboy(inputs, channels, frame);
    else if (kind === "noise") this.noise(inputs, channels, frame);
    else if (kind === "drums") this.drums(inputs, channels, frame);
    else if (kind === "beat") this.beat(inputs, channels, frame);
    else if (kind === "filter") this.filter(inputs, channels, frame);
    else if (kind === "delay") this.delay(inputs, channels, frame);
    else if (kind === "reverb") this.reverb(inputs, channels, frame);
    else if (kind === "bbd") this.bbd(inputs, channels, frame);
    else if (kind === "vca") this.vca(inputs, channels, frame);
    else if (kind === "boost") this.boost(inputs, channels, frame);
    else if (kind === "stereo") this.stereo(inputs, channels, frame);
    else if (kind === "mult") this.mult(inputs, channels, frame);
    else if (kind === "switch") this.switch(inputs, channels, frame);
    else if (kind === "env") this.envelope(inputs, channels, frame);
    else if (kind === "lfo") this.lfo(inputs, channels, frame);
    else if (kind === "modulator") this.modulator(inputs, channels, frame);
    else if (kind === "drift") this.drift(inputs, channels, frame);
    else if (kind === "offset") this.offset(inputs, channels, frame);
    else if (kind === "divider") this.divider(inputs, channels, frame);
    else if (kind === "clock") this.clockOut(inputs, channels, frame);
    else if (kind === "hold") this.sampleHold(inputs, channels, frame);
    else if (kind === "swamp") this.swamp(inputs, channels, frame);
    else if (kind === "rng") this.rng(inputs, channels, frame);
    else if (kind === "mixer") this.mixer(inputs, channels, frame);
    else if (kind === "output") this.output(inputs, channels, frame);
  }

  osc(midi) {
    this.phase += this.hz(midi) / sampleRate;
    this.phase %= 1;
    const saw = this.phase * 2 - 1;
    const tri = this.phase < 0.5 ? this.phase * 4 - 1 : 3 - this.phase * 4;
    return [saw, tri];
  }

  vco(inputs, channels, frame) {
    const fm = this.sample(inputs, 0, frame) * this.knob(1, 0.5) * 24;
    const midi = this.note(this.knob(0, 0.5), this.patched(3) ? this.sample(inputs, 3, frame) : 0) + fm;
    const sync = this.sample(inputs, 2, frame);
    if (this.rise(2, sync)) this.phase = 0;
    const [saw, tri] = this.osc(midi);
    let width = 0.5 + (this.knob(2, 0.5) - 0.5) * 0.9 + this.sample(inputs, 1, frame) * 0.45;
    width = Math.max(0.05, Math.min(0.95, width));
    // This panel has no gate jack. A patched sync input is the sequencer gate,
    // so the oscillator stays quiet while that gate is low.
    const open = this.patched(2) ? (sync > 0.2 ? 1 : 0) : 1;
    this.write(channels, [saw * open, tri * open, (this.phase < width ? 1 : -1) * open], frame);
  }

  bassline(inputs, channels, frame) {
    const midi = this.note(this.knob(0, 0.5), this.patched(0) ? this.sample(inputs, 0, frame) : 0);
    const [saw] = this.osc(midi);
    const gate = this.sample(inputs, 1, frame);
    if (this.rise(1, gate)) this.env = 1;
    const decay = this.seconds(this.knob(3, 0.5), 0.03, 2);
    this.env *= Math.exp(-1 / (sampleRate * decay));
    const accent = this.sample(inputs, 2, frame) > 0.2 ? this.knob(4, 0.5) : 0;
    const cutoff = this.hz(36 + (this.knob(1, 0.35) + this.sample(inputs, 3, frame) + accent) * 60);
    const [low] = this.svf(saw * this.env, cutoff, 0.3 + this.knob(2, 0.5) * 1.4);
    const drive = 1 + this.knob(5, 0.5) * 6;
    this.write(channels, [Math.tanh(low * drive)], frame);
  }

  polysynth(inputs, channels, frame) {
    const midi = this.note(this.knob(0, 0.5), 0);
    const detune = (this.knob(3, 0.5) - 0.5) * 0.4;
    const shape = Math.max(0, Math.min(1, this.knob(1, 0.5) + this.sample(inputs, 1, frame)));
    const [saw] = this.osc(midi);
    this.clock += this.hz(midi + detune) / sampleRate;
    this.clock %= 1;
    const second = this.clock * 2 - 1;
    const square = this.clock < 0.5 ? 1 : -1;
    const mix = saw * (1 - shape) + square * shape;
    const other = second * (1 - shape) + (this.clock < 0.5 ? -1 : 1) * shape;
    const cutoff = this.hz(48 + (this.knob(2, 0.5) + this.sample(inputs, 0, frame)) * 48);
    const [low] = this.svf((mix + other) * 0.3, cutoff, 0.7);
    const level = this.knob(6, 0.8);
    this.write(channels, [low * level, other * 0.4 * level], frame);
  }

  bitboy(inputs, channels, frame) {
    const midi = this.note(this.knob(0, 0.5), this.patched(0) ? this.sample(inputs, 0, frame) : 0);
    const gate = this.patched(3) ? this.sample(inputs, 3, frame) > 0.2 : 1;
    const mode = Math.max(0, Math.min(3, Math.round((this.knob(1, 0) + this.sample(inputs, 1, frame)) * 3)));
    const frameAmt = Math.max(0.05, Math.min(0.95, this.knob(2, 0.5) + this.sample(inputs, 2, frame)));
    const morph = Math.max(0, Math.min(1, this.knob(3, 0.5)));
    const [saw, tri] = this.osc(midi);
    const wave = [tri, saw, this.phase < frameAmt ? 1 : -1, (Math.random() * 2 - 1) * (this.phase < frameAmt ? 1 : 0.3)][mode];
    const pulse = this.phase < frameAmt ? 1 : -1;
    const level = Math.max(0, Math.min(1, this.knob(4, 0.8) + this.sample(inputs, 4, frame)));
    const step = this.phase < 0.5 ? 1 : 0;
    this.write(channels, [gate ? (wave * (1 - morph) + pulse * morph) * level : 0, step], frame);
  }

  noise(inputs, channels, frame) {
    const white = Math.random() * 2 - 1;
    this.pink[0] = 0.99886 * this.pink[0] + white * 0.0555179;
    this.pink[1] = 0.99332 * this.pink[1] + white * 0.0750759;
    this.pink[2] = 0.969 * this.pink[2] + white * 0.153852;
    this.pink[3] = 0.8665 * this.pink[3] + white * 0.3104856;
    this.pink[4] = 0.55 * this.pink[4] + white * 0.5329522;
    this.pink[5] = -0.7616 * this.pink[5] - white * 0.016898;
    const pink = (this.pink[0] + this.pink[1] + this.pink[2] + this.pink[3] + this.pink[4] + this.pink[5] + this.pink[6] + white * 0.5362) * 0.11;
    this.pink[6] = white * 0.115926;
    const color = this.knob(1, 0.5);
    this.slow += (white - this.slow) * (0.0002 + color * 0.02);
    const level = Math.max(0, Math.min(1, this.knob(0, 0.5) + this.sample(inputs, 0, frame)));
    this.write(channels, [white * level, pink * level, this.slow * 4 * level], frame);
  }

  hit(index, velocity) {
    this.drum[index] = velocity;
    this.drumF[index] = index === 0 ? 180 : index === 4 ? 200 : 320;
  }

  drums(inputs, channels, frame) {
    for (let index = 0; index < 6; index += 1) if (this.rise(index, this.sample(inputs, index, frame))) this.hit(index, 1);
    const decay = this.seconds(this.knob(2, 0.5), 0.02, 0.6);
    const tone = 0.5 + this.knob(0, 0.5);
    const snappy = this.knob(1, 0.5);
    let mix = 0;
    let kick = 0;
    let snare = 0;
    let hats = 0;
    for (let index = 0; index < 6; index += 1) {
      this.drum[index] *= Math.exp(-1 / (sampleRate * (index >= 2 && index !== 4 ? decay * 0.25 : decay)));
      this.drumF[index] *= 0.9996;
      this.pink[index] += (this.drumF[index] * tone) / sampleRate;
      const body = Math.sin(this.pink[index] * Math.PI * 2) * this.drum[index];
      const noise = (Math.random() * 2 - 1) * this.drum[index] * (index === 0 ? 0.15 : snappy);
      const voice = index === 2 || index === 3 ? noise : body + noise;
      mix += voice;
      if (index === 0) kick = voice;
      if (index === 1) snare = voice;
      if (index === 2 || index === 3) hats += voice;
    }
    const level = this.knob(3, 0.8);
    this.write(channels, [Math.tanh(mix) * level, Math.tanh(kick) * level, Math.tanh(snare) * level, Math.tanh(hats) * level], frame);
  }

  beat(inputs, channels, frame) {
    const masks = [
      [0x1111, 0x1010, 0x5555, 0],
      [0x1111, 0x1010, 0xffff, 0],
      [0x1511, 0x1010, 0x5555, 0x4444],
      [0x1111, 0x1110, 0x3333, 0x4444],
    ];
    const pattern = masks[Math.max(0, Math.min(3, Math.round(this.knob(0, 0) * 3)))];
    const bpm = this.patched(0) ? 0 : 120;
    if (bpm) this.clock += (bpm / 60) * 4 / sampleRate;
    if (this.rise(0, this.sample(inputs, 0, frame))) this.clock = Math.floor(this.clock) + 1;
    if (this.rise(1, this.sample(inputs, 1, frame))) this.clock = 0;
    const step = Math.floor(this.clock) % 16;
    const edge = step !== this.div[0];
    this.div[0] = step;
    if (edge) {
      for (let index = 0; index < 4; index += 1) this.drum[index] = (pattern[index] >> step) & 1 ? 1 : this.drum[index];
    }
    const gates = [0, 1, 2, 3].map((index) => ((pattern[index] >> step) & 1 ? 1 : 0));
    let mix = 0;
    for (let index = 0; index < 4; index += 1) {
      this.drum[index] *= Math.exp(-1 / (sampleRate * (index >= 2 ? 0.04 : 0.12)));
      this.drumF[index] = index === 0 ? 70 + this.drum[index] * 140 : 180;
      mix += Math.sin((this.phase + index) * 6.28) * this.drum[index];
      this.phase += this.drumF[index] / sampleRate;
    }
    const level = this.knob(2, 0.8);
    this.write(channels, gates.concat([mix * level, mix * 0.8 * level, mix * level]), frame);
  }

  filter(inputs, channels, frame) {
    const mode = this.params[63] || 0;
    const input = this.sample(inputs, 0, frame);
    const cv = this.sample(inputs, 1, frame);
    const cutoff = this.hz(24 + (this.knob(0, 0.5) + cv * (mode === 0 ? this.knob(2, 0.5) : 1)) * 80);
    const resonance = 0.2 + this.knob(1, 0.5) * 1.5 + (mode === 2 ? 0 : this.sample(inputs, 2, frame));
    const drive = mode === 0 ? 1 : 1 + this.knob(2, 0.5) * 4;
    const [low, band, high] = this.svf(Math.tanh(input * drive), cutoff, resonance);
    this.write(channels, this.outputsN === 2 ? [low, band] : [low, band, high], frame);
  }

  tapDelay(buffer, time, input, feedback) {
    const length = buffer.length;
    const read = (this.delayPos - Math.max(1, Math.min(length - 2, time * sampleRate)) + length) % length;
    const index = Math.floor(read);
    const wet = buffer[index];
    buffer[this.delayPos] = input + wet * feedback;
    return wet;
  }

  delay(inputs, channels, frame) {
    const input = this.sample(inputs, 0, frame);
    const time = Math.max(0.01, Math.min(0.98, this.knob(0, 0.4) + this.sample(inputs, 1, frame) * 0.5));
    const feedback = Math.max(0, Math.min(0.92, this.knob(1, 0.4) + this.sample(inputs, 2, frame)));
    const wetL = this.tapDelay(this.delayL, time, input, feedback);
    const wetR = this.tapDelay(this.delayR, time * 1.07, input, feedback);
    this.delayPos = (this.delayPos + 1) % this.delayL.length;
    const mix = this.knob(2, 0.5);
    const left = input * (1 - mix) + wetL * mix;
    const right = input * (1 - mix) + wetR * mix;
    this.write(channels, [left, right, (left + right) * 0.5], frame);
  }

  bbd(inputs, channels, frame) {
    if (this.sample(inputs, 2, frame) > 0.2) {
      this.write(channels, [0, this.sample(inputs, 0, frame)], frame);
      return;
    }
    const input = this.sample(inputs, 0, frame);
    this.phase += (0.05 + this.knob(4, 0.5) * 6) / sampleRate;
    const time = Math.max(0.005, Math.min(0.4, this.knob(0, 0.4) + this.sample(inputs, 1, frame) * 0.2 + Math.sin(this.phase * 6.283) * this.knob(4, 0.5) * 0.03));
    const feedback = Math.max(0, Math.min(0.85, this.knob(1, 0.4)));
    const wet = this.tapDelay(this.delayL, time, input, feedback);
    this.delayPos = (this.delayPos + 1) % this.delayL.length;
    const colour = this.knob(3, 0.5);
    const [low] = this.svf(wet, this.hz(60 + colour * 50), 0.8);
    const mix = this.knob(2, 0.5);
    this.write(channels, [low, input * (1 - mix) + low * mix], frame);
  }

  reverb(inputs, channels, frame) {
    const left = this.patched(0) ? this.sample(inputs, 0, frame) : 0;
    const right = this.patched(1) ? this.sample(inputs, 1, frame) : left;
    const size = Math.max(0.2, Math.min(1, this.knob(0, 0.5) + this.sample(inputs, 2, frame)));
    const decay = Math.max(0, Math.min(0.9, this.knob(1, 0.5)));
    const damp = 0.2 + this.knob(2, 0.5) * 0.7;
    let wet = (left + right) * 0.5;
    this.combs.forEach((comb) => {
      const read = comb.buf[comb.i];
      comb.d += damp * (read - comb.d);
      comb.buf[comb.i] = wet + comb.d * decay;
      comb.i = (comb.i + 1) % Math.max(20, Math.floor(comb.buf.length * size));
      wet = read;
    });
    wet = Math.tanh(wet * 0.6);
    const mix = this.knob(3, 0.4);
    this.write(channels, [left * (1 - mix) + wet * mix, right * (1 - mix) + wet * 0.8 * mix], frame);
  }

  vca(inputs, channels, frame) {
    const a = this.sample(inputs, 2, frame) * Math.max(0, Math.min(1, this.knob(0, 0) + this.sample(inputs, 0, frame)));
    const b = this.sample(inputs, 3, frame) * Math.max(0, Math.min(1, this.knob(1, 0) + this.sample(inputs, 1, frame)));
    this.write(channels, [a, b, (a + b) * 0.5], frame);
  }

  boost(inputs, channels, frame) {
    const gain = this.knob(0, 0.5) * 4;
    const [low] = this.svf(this.sample(inputs, 0, frame) * gain, this.hz(40 + this.knob(1, 0.5) * 70), 0.7);
    this.write(channels, [Math.tanh(low)], frame);
  }

  stereo(inputs, channels, frame) {
    const left = this.sample(inputs, 0, frame);
    const right = this.patched(1) ? this.sample(inputs, 1, frame) : left;
    const width = this.knob(1, 0.5) * 2;
    const mid = (left + right) * 0.5;
    const side = (left - right) * 0.5 * width;
    const pan = Math.max(-1, Math.min(1, (this.knob(0, 0.5) - 0.5) * 2 + this.sample(inputs, 2, frame)));
    const level = this.knob(2, 0.8);
    this.write(channels, [(mid + side) * (1 - Math.max(0, pan)) * level, (mid - side) * (1 + Math.min(0, pan)) * level], frame);
  }

  mult(inputs, channels, frame) {
    const value = this.sample(inputs, 0, frame);
    this.write(channels, [value, value, value, value], frame);
  }

  switch(inputs, channels, frame) {
    const steps = Math.max(2, Math.min(4, Math.round(this.knob(1, 1) * 3) + 1));
    const select = Math.max(0, Math.min(steps - 1, Math.floor((this.knob(0, 0) + this.sample(inputs, 0, frame) * 0.5) * steps)));
    const common = this.sample(inputs, 1, frame);
    const outs = [0, 0, 0, 0];
    outs[select] = common;
    const back = this.sample(inputs, 2 + select, frame);
    this.write(channels, outs.concat([back]), frame);
  }

  envelope(inputs, channels, frame) {
    const adsr = this.params[63] > 1.5;
    const attack = this.seconds(this.knob(0, 0.2), 0.002, 4);
    const decay = this.seconds(this.knob(1, 0.4), 0.005, 6);
    const sustain = adsr ? this.knob(2, 0.7) : 1;
    const release = this.seconds(this.knob(adsr ? 3 : 1, 0.3), 0.005, 6);
    const gate = this.sample(inputs, 0, frame) > 0.2;
    const trig = this.rise(1, this.sample(inputs, 1, frame));
    if (trig || (this.patched(0) && this.rise(0, gate ? 1 : 0))) this.stage = 1;
    if (this.patched(0) && !gate && this.stage && this.stage < 4) this.stage = 4;
    else if (!this.patched(0) && this.stage === 3) this.stage = 4;
    if (this.stage === 1) {
      this.env += 1 / (sampleRate * attack);
      if (this.env >= 1) { this.env = 1; this.stage = sustain >= 0.99 ? 3 : 2; }
    } else if (this.stage === 2) {
      this.env += (sustain - this.env) * (1 / (sampleRate * decay));
      if (Math.abs(this.env - sustain) < 0.01) this.stage = 3;
    } else if (this.stage === 3) this.env += (sustain - this.env) * 0.02;
    else if (this.stage === 4) {
      this.env *= Math.exp(-1 / (sampleRate * release));
      if (this.env < 0.001) { this.env = 0; this.stage = 0; }
    }
    this.write(channels, [this.env, this.stage === 0 ? 1 : 0], frame);
  }

  wave(shape) {
    const sine = Math.sin(this.phase * Math.PI * 2);
    const tri = this.phase < 0.5 ? this.phase * 4 - 1 : 3 - this.phase * 4;
    const square = this.phase < 0.5 ? 1 : -1;
    const ramp = this.phase * 2 - 1;
    if (shape < 0.33) return sine;
    if (shape < 0.66) return tri;
    if (shape < 0.9) return square;
    return ramp;
  }

  lfo(inputs, channels, frame) {
    const rate = this.seconds(this.knob(0, 0.5) + this.sample(inputs, 0, frame), 0.05, 40);
    if (this.rise(1, this.sample(inputs, 1, frame))) this.phase = 0;
    this.phase += rate / sampleRate;
    this.phase %= 1;
    const shape = Math.max(0, Math.min(1, this.knob(1, 0) + this.sample(inputs, 2, frame)));
    const level = this.knob(2, 0.8);
    const value = this.wave(shape) * level;
    this.write(channels, [value, -value, value * 0.5 + 0.5], frame);
  }

  modulator(inputs, channels, frame) {
    const rate = this.seconds(this.knob(0, 0.5) + this.sample(inputs, 0, frame), 0.05, 30);
    this.phase += rate / sampleRate;
    this.phase %= 1;
    const lfo = this.wave(this.knob(1, 0.2));
    const noise = (Math.random() * 2 - 1) * this.knob(2, 0.4);
    const clockEdge = this.rise(2, this.sample(inputs, 2, frame));
    if (this.rise(1, this.sample(inputs, 1, frame)) || clockEdge) this.phase = 0;
    if (clockEdge) this.hold = this.patched(3) ? this.sample(inputs, 3, frame) : noise;
    const slew = this.seconds(this.knob(3, 0.3), 0.001, 0.5);
    this.smooth += (this.hold - this.smooth) * Math.min(1, 1 / (sampleRate * slew));
    this.write(channels, [lfo, noise, this.smooth], frame);
  }

  drift(inputs, channels, frame) {
    const rate = this.seconds(this.knob(0, 0.4) + this.sample(inputs, 0, frame), 0.02, 8);
    this.phase += rate / sampleRate;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.hold = Math.random() * 2 - 1;
    }
    const smooth = this.seconds(this.knob(2, 0.5), 0.01, 1);
    this.smooth += (this.hold - this.smooth) * Math.min(1, 1 / (sampleRate * smooth));
    const depth = this.knob(1, 0.5);
    this.write(channels, [this.smooth * depth, -this.smooth * depth], frame);
  }

  offset(inputs, channels, frame) {
    const a = this.sample(inputs, 0, frame) * (this.knob(0, 0.5) * 2 - 1) + (this.knob(1, 0.5) * 2 - 1);
    const b = this.sample(inputs, 1, frame) * (this.knob(2, 0.5) * 2 - 1) + (this.knob(3, 0.5) * 2 - 1);
    this.write(channels, [a, b], frame);
  }

  pulse(index, width) {
    return this.phase < width ? 1 : 0;
  }

  divider(inputs, channels, frame) {
    if (this.rise(1, this.sample(inputs, 1, frame))) this.div[0] = 0;
    if (this.rise(0, this.sample(inputs, 0, frame))) this.div[0] = (this.div[0] + 1) % 16;
    const count = this.div[0];
    const clock = this.sample(inputs, 0, frame) > 0.2 ? 1 : 0;
    this.write(channels, [
      clock,
      count % 2 ? 1 : 0,
      Math.floor(count / 2) % 2 ? 1 : 0,
      Math.floor(count / 4) % 2 ? 1 : 0,
    ], frame);
  }

  clockOut(inputs, channels, frame) {
    const bpm = 20 + this.knob(0, 0.4) * 220;
    const ratios = this.kind === "clock" && this.inputsN === 1
      ? [1, 2, 4, 8]
      : [1, 2, 3, 4, 0.5, 1 / 3, 0.25, 0.125];
    const width = 0.05 + this.knob(this.kind === "clock" && this.inputsN === 1 ? 0 : 1, 0.2) * 0.4;
    if (this.inputsN === 1) {
      if (this.rise(0, this.sample(inputs, 0, frame))) {
        this.period = Math.max(48, this.clock || this.period);
        this.clock = 0;
        this.div[0] += 1;
      } else this.clock += 1;
      const outs = ratios.map((ratio) => {
        const length = this.period / ratio;
        const place = (this.clock % length) / length;
        return place < width ? 1 : 0;
      });
      this.write(channels, outs, frame);
      return;
    }
    this.clock += (bpm / 60) / sampleRate;
    const outs = ratios.map((ratio) => {
      const place = (this.clock * ratio) % 1;
      return place < width ? 1 : 0;
    });
    this.write(channels, outs, frame);
  }

  sampleHold(inputs, channels, frame) {
    const noise = (Math.random() * 2 - 1) * this.knob(1, 0);
    const source = this.patched(0) ? this.sample(inputs, 0, frame) : noise;
    if (!this.patched(1) || this.rise(1, this.sample(inputs, 1, frame))) this.hold = source;
    const slew = this.seconds(this.knob(0, 0), 0.0001, 0.4);
    this.smooth += (this.hold - this.smooth) * Math.min(1, 1 / (sampleRate * slew));
    this.write(channels, [this.smooth], frame);
  }

  swamp(inputs, channels, frame) {
    const rate = this.seconds(this.knob(0, 0.5) + this.sample(inputs, 0, frame), 0.1, 20);
    const chaos = Math.max(0, Math.min(1, this.knob(1, 0.5) + this.sample(inputs, 1, frame)));
    if (this.patched(2) ? this.rise(2, this.sample(inputs, 2, frame)) : (this.phase += rate / sampleRate) >= 1) {
      this.phase = this.patched(2) ? this.phase : 0;
      this.hold = (this.hold + (Math.random() * 2 - 1) * chaos) % 1;
      if (this.hold > 1) this.hold -= 2;
    }
    const lag = this.seconds(this.knob(2, 0.4), 0.002, 0.5);
    this.smooth += (this.hold - this.smooth) * Math.min(1, 1 / (sampleRate * lag));
    const burst = Math.abs(this.hold - this.smooth) > 0.2 ? 1 : 0;
    this.write(channels, [this.hold, this.smooth, burst, Math.random() * 2 - 1], frame);
  }

  rng(inputs, channels, frame) {
    const prob = Math.max(0, Math.min(1, this.knob(0, 0.5) + this.sample(inputs, 1, frame)));
    if (this.rise(0, this.sample(inputs, 0, frame)) || (!this.patched(0) && (this.phase += 2 / sampleRate) >= 1)) {
      this.phase = 0;
      if (Math.random() < prob || this.sample(inputs, 2, frame) > 0.2) {
        const steps = Math.max(1, Math.round(this.knob(1, 0.5) * 12));
        this.hold = (Math.round(Math.random() * steps) / steps) * 2 - 1;
        this.env = Math.random() < prob ? 1 : 0;
      }
    }
    const scale = this.knob(2, 0.5);
    const bias = (this.knob(3, 0.5) - 0.5) * 2;
    const value = this.hold * scale + bias;
    this.write(channels, [value, this.env, -value], frame);
  }

  mixer(inputs, channels, frame) {
    let sum = 0;
    for (let index = 0; index < 4; index += 1) {
      const muted = this.knob(4 + index, 0) >= 0.5;
      if (muted) continue;
      sum += this.sample(inputs, index, frame) * this.knob(index, 0.5);
    }
    this.write(channels, [sum, sum], frame);
  }

  output(inputs, channels, frame) {
    const level = this.knob(0, 0.8);
    const left = this.sample(inputs, 0, frame) * level;
    const right = this.patched(1) ? this.sample(inputs, 1, frame) * level : 0;
    this.write(channels, [left, right], frame);
  }
}

registerProcessor("rack-voice", RackVoiceProcessor);
