import { ExtismPluginBase, PluginWasi } from './plugin'
import { WASI, Fd } from '@bjorn3/browser_wasi_shim';

export class ExtismPlugin extends ExtismPluginBase {
  
  async fetch(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    return response.arrayBuffer();
  }

  loadWasi(): PluginWasi {

    const args: Array<string> = [];
    const envVars: Array<string> = [];
    let fds: Fd[] = [
      // new XtermStdio(term), // stdin
      // new XtermStdio(term), // stdout
      // new XtermStdio(term), // stderr
    ];

    const wasi = new WASI(args, envVars, fds);
    return new PluginWasi(wasi, wasi.wasiImport);
  }
}