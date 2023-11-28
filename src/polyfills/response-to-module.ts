export async function responseToModule(
  response: Response,
  hasHash?: boolean,
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

  // XXX(chrisdickinson): Note that we want to pass a `Response` to WebAssembly.compileStreaming if we
  // can to play nicely with V8's code caching [1]. At the same time, we need the original ArrayBuffer data
  // to verify any hashes. There's no way back to bytes from `WebAssembly.Module`, so we have to `.clone()`
  // the response to get the `ArrayBuffer` data if we need to check a hash.
  //
  // [1]: https://v8.dev/blog/wasm-code-caching#algorithm
  const data = hasHash ? await response.clone().arrayBuffer() : undefined;
  const module = await WebAssembly.compileStreaming(response);

  return { module, data };
}
