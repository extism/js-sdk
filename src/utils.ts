export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Function call timed out'));
        }, ms);

        promise.then(resolve, reject).finally(() => {
            clearTimeout(timeout);
        });
    });
}
