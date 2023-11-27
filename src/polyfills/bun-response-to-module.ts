// XXX(chrisdickinson): BUN NOTE: bun doesn't support `WebAssembly.compileStreaming` at the time of writing, nor
// does cloning a response work [1].
//
// [1]: https://github.com/oven-sh/bun/issues/6348
export async function responseToModule(
  response: Response,
  _hasHash?: boolean,
): Promise<{ module: WebAssembly.Module; data?: ArrayBuffer }> {
  if (String(response.headers.get('Content-Type')).split(';')[0] === 'application/octet-stream') {
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/wasm');

    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    });
  }
  const data = await response.arrayBuffer();
  const module = await WebAssembly.compile(data);

  return { module, data };
}
