import { ExtismPluginBase, PluginWasi } from './plugin'
import wasi from 'https://deno.land/std@0.197.0/wasi/snapshot_preview1.ts'

export class ExtismPlugin extends ExtismPluginBase {
  
  async fetch(url) {
    const response = await fetch(url);
    return response.arrayBuffer();
  }

  loadWasi() {
    const w = new wasi.WASI({
      // preopens: this.allowedPaths,
    });

    return new PluginWasi(w, w.exports);
  }
}