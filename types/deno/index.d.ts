declare module 'https://deno.land/x/minimatch@v3.0.4/index.js' {
  export default function matches(text: string, pattern: string): boolean;
}

declare module 'https://deno.land/std@0.200.0/wasi/snapshot_preview1.ts' {
  export default class Context {
    constructor(opts: Record<string, any>);

    exports: WebAssembly.Exports;
    start(opts: any);
    initialize?(opts: any);
  }
}
