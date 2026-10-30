class PlaitsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.params = new Float32Array(32);
    this.params[1] = 0.5;
    this.params[2] = 0.5;
    this.params[3] = 0.5;
    this.params[4] = 0.5;
    this.params[5] = 0.5;
    this.params[6] = 0.5;
    this.params[7] = 0.5;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.wasm) this.start(data.wasm);
      else if (data.params) this.params.set(data.params);
    };
  }

  start(bytes) {
    const wasm = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(wasm);
    const api = instance.exports;
    this.memory = api.memory;
    this.render = api.plaits_render;
    this.paramsPtr = api.malloc(32 * 4);
    this.outPtr = api.malloc(256 * 4);
    this.auxPtr = api.malloc(256 * 4);
    api.plaits_init();
    this.ready = true;
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels || !channels[0]) return true;
    const frames = channels[0].length;
    if (!this.ready || frames > 256) {
      channels[0].fill(0);
      if (channels[1]) channels[1].fill(0);
      return true;
    }
    new Float32Array(this.memory.buffer).set(this.params, this.paramsPtr / 4);
    this.render(this.paramsPtr, this.outPtr, this.auxPtr, frames);
    const samples = new Float32Array(this.memory.buffer);
    channels[0].set(samples.subarray(this.outPtr / 4, this.outPtr / 4 + frames));
    if (channels[1]) channels[1].set(samples.subarray(this.auxPtr / 4, this.auxPtr / 4 + frames));
    return true;
  }
}

registerProcessor("plaits", PlaitsProcessor);
