import { type InternalWasi } from '../interfaces.ts';

export async function loadWasi(
  _allowedPaths: { [from: string]: string },
  _enableWasiOutput: boolean,
): Promise<InternalWasi> {
  throw new TypeError('WASI is not supported on Deno.');
}
