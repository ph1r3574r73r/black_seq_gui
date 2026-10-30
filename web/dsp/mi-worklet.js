class MiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.params = new Float32Array(48);
    this.inputCount = 0;
    this.outputCount = 1;
    this.blocks = 0;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.wasm) this.start(data);
      else if (data.params) this.params.set(data.params);
    };
  }

  start(data) {
    try {
      const wasm = new WebAssembly.Module(data.wasm);
      const instance = new WebAssembly.Instance(wasm);
      const api = instance.exports;
      this.memory = api.memory;
      this.render = api[data.render];
      this.inputCount = data.inputs || 0;
      this.outputCount = data.outputs || 1;
      this.paramsPtr = api.malloc(48 * 4);
      this.inPtr = api.malloc(8 * 256 * 4);
      this.outPtr = api.malloc(8 * 256 * 4);
      api[data.init]();
      this.ready = true;
    } catch (error) {
      this.port.postMessage({ error: String(error && error.message || error) });
    }
  }

  process(inputs, outputs) {
    const channels = outputs[0];
    if (!channels || !channels[0]) return true;
    const frames = channels[0].length;
    if (!this.ready || frames > 256) {
      for (let i = 0; i < channels.length; i += 1) if (channels[i]) channels[i].fill(0);
      return true;
    }
    try {
      let memory = new Float32Array(this.memory.buffer);
      memory.set(this.params, this.paramsPtr / 4);
      for (let i = 0; i < this.inputCount; i += 1) {
        const src = inputs[i] && inputs[i][0];
        const offset = this.inPtr / 4 + i * frames;
        if (src && src.length >= frames) memory.set(src.subarray(0, frames), offset);
        else memory.fill(0, offset, offset + frames);
      }
      this.render(this.paramsPtr, this.inPtr, this.outPtr, frames);
      memory = new Float32Array(this.memory.buffer);
      for (let i = 0; i < this.outputCount; i += 1) {
        if (!channels[i]) continue;
        const start = this.outPtr / 4 + i * frames;
        channels[i].set(memory.subarray(start, start + frames));
      }
      this.blocks += 1;
      if (this.blocks % 8 === 0) {
        const levels = [];
        const last = frames - 1;
        for (let i = 0; i < this.outputCount; i += 1) {
          levels.push(memory[this.outPtr / 4 + i * frames + last] || 0);
        }
        this.port.postMessage({ levels });
      }
    } catch (error) {
      if (!this.reported) {
        this.reported = true;
        this.port.postMessage({ error: String(error && error.stack || error) });
      }
      for (let i = 0; i < channels.length; i += 1) if (channels[i]) channels[i].fill(0);
    }
    return true;
  }
}

registerProcessor("mi", MiProcessor);
