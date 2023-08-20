import { PluginWasi } from './manifest.ts'

const isBrowser =
  typeof window !== "undefined" && typeof window.document !== "undefined";

const isNode =
  typeof process !== "undefined" &&
  process.versions != null &&
  process.versions.node != null;

const isDeno =
  typeof Deno !== "undefined" &&
  typeof Deno.version !== "undefined" &&
  typeof Deno.version.deno !== "undefined";


async function nodeWasi() {
  const pkg = await import("wasi");
  const wasi = new pkg.WASI({
    //version: "preview1",
    //preopens: this.allowedPaths,
  });

  return new PluginWasi(wasi, wasi.wasiImport);
}

async function browserWasi() {
  const module = await import('@bjorn3/browser_wasi_shim');

  const args = [];
  const envVars = [];
  let fds = [];

  const wasi = new module.WASI(args, envVars, fds);

  return new PluginWasi(wasi, wasi.wasiImport);
}

async function denoWasi() {
  const pkgDeno = await import(
    "https://deno.land/std@0.197.0/wasi/snapshot_preview1.ts"
  );
  const wasi = new pkgDeno.default({
    //preopens: this.allowedPaths,
  });

  return new PluginWasi(wasi);
}

async function loadWasi() {
  if (isDeno) {
    return await denoWasi();
  } else if (isNode) {
    return await nodeWasi();
  } else if (isBrowser) {
    return await browserWasi();
  }
}

export {
  isBrowser,
  isNode,
  isDeno,
  loadWasi
}