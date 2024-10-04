import { minimatch } from 'npm:minimatch@9.0.4';

export function matches(text: string, pattern: string): boolean {
  return minimatch(text, pattern);
}
