export function withTimeout<T>(promise: Promise<T>, timeoutMs?: number | undefined): Promise<T> {
    if (!timeoutMs) {
        return promise;
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(async () => {
            reject(new Error('Function call timed out'));
        }, timeoutMs);

        promise.then(resolve, reject).finally(() => {
            clearTimeout(timeout);
        });
    });
}

export async function readBodyUpTo(response: Response, maxBytes: number): Promise<Uint8Array> {
    const reader = response.body?.getReader();
    if (!reader) {
      return new Uint8Array(0);
    }
  
    let receivedLength = 0;
    const chunks = [];
  
    while (receivedLength < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      receivedLength += value.length;
      if (receivedLength >= maxBytes) {
        throw new Error(`Response body exceeded ${maxBytes} bytes`);
      }
    }
  
    const limitedResponseBody = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      limitedResponseBody.set(chunk, position);
      position += chunk.length;
    }
  
    return limitedResponseBody;
  }
