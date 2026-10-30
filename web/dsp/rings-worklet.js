class RingsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.params = new Float32Array(32);
    this.params[1] = 1;
    this.params[2] = 0.5;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.wasm) this.start(data.wasm);
      else if (data.params) this.params.set(data.params);
    };
  }

  start(bytes) {
    try {
      const wasm = new WebAssembly.Module(bytes);
      const instance = new WebAssembly.Instance(wasm);
      const api = instance.exports;
      this.memory = api.memory;
      this.render = api.rings_render;
      this.paramsPtr = api.malloc(32 * 4);
      this.inPtr = api.malloc(256 * 4);
      this.outPtr = api.malloc(256 * 4);
      this.auxPtr = api.malloc(256 * 4);
      api.rings_init();
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
      channels[0].fill(0);
      if (channels[1]) channels[1].fill(0);
      return true;
    }
    try {
      const memory = new Float32Array(this.memory.buffer);
      memory.set(this.params, this.paramsPtr / 4);
      const incoming = inputs[0] && inputs[0][0];
      if (incoming && incoming.length >= frames) memory.set(incoming.subarray(0, frames), this.inPtr / 4);
      else memory.fill(0, this.inPtr / 4, this.inPtr / 4 + frames);
      this.render(this.paramsPtr, this.inPtr, this.outPtr, this.auxPtr, frames);
      const samples = new Float32Array(this.memory.buffer);
      channels[0].set(samples.subarray(this.outPtr / 4, this.outPtr / 4 + frames));
      if (channels[1]) channels[1].set(samples.subarray(this.auxPtr / 4, this.auxPtr / 4 + frames));
    } catch (error) {
      if (!this.reported) {
        this.reported = true;
        this.port.postMessage({ error: String(error && error.stack || error) });
      }
      channels[0].fill(0);
      if (channels[1]) channels[1].fill(0);
    }
    return true;
  }
}

registerProcessor("rings", RingsProcessor);
