declare module 'npm:minimatch@9.0.4' {
  export * as minimatch from 'minimatch';
}

declare module 'jsr:@std/path@0.223.0/relative' {
  export function relative(base: string, relative: string): string;
}

declare module 'jsr:@std/path@0.223.0/resolve' {
  export function resolve(base: string, relative: string): string;
}

declare namespace Deno {
  interface DirEntry {
    name: string
    isFile: boolean
    isDirectory: boolean
    isSymlink: boolean
  }
}

declare const Deno: any
