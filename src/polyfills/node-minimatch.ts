import { minimatch } from 'minimatch';

export function matches(text: string, pattern: string): boolean {
  return minimatch(text, pattern);
}
