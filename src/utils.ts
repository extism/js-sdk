export function withTimeout<T>(promise: Promise<T>, callback: () => Promise<void>, timeoutMs?: number | undefined): Promise<T> {
    if (!timeoutMs) {
        return promise;
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(async () => {
            await callback();
            reject(new Error('Function call timed out'));
        }, timeoutMs);

        promise.then(resolve, reject).finally(() => {
            clearTimeout(timeout);
        });
    });
}
