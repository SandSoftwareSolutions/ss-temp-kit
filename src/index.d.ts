export interface TempDir {
  readonly path: string;
  join(...parts: string[]): string;
  write(name: string, content?: string | Uint8Array): Promise<string>;
  read(name: string): Promise<string>;
  read(name: string, encoding: null): Promise<Buffer>;
  remove(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface TempOptions {
  prefix?: string;
  /** Where to make it. Default: the system temp folder. */
  base?: string;
}

export function createTempDir(options?: TempOptions): Promise<TempDir>;
export function createTempDirSync(options?: TempOptions): string;
export function withTempDir<T>(fn: (dir: TempDir) => T | Promise<T>, options?: TempOptions): Promise<T>;
export function withTempFile<T>(content: string | Uint8Array, fn: (path: string) => T | Promise<T>, options?: TempOptions & { name?: string }): Promise<T>;
export function pending(): number;
