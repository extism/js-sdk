import minimatch from 'https://deno.land/x/minimatch@v3.0.4/index.js';

export function matches(text: string, pattern: string): boolean {
  return minimatch(text, pattern);
}
