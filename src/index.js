import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const live = new Set();
let hooked = false;

function removeAllOnExit() {
  for (const path of live) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Nothing more can be done while exiting.
    }
  }
}

function track(path) {
  live.add(path);
  if (!hooked) {
    hooked = true;
    process.on("exit", removeAllOnExit);
  }
}

function inside(root, name) {
  if (typeof name !== "string" || name === "" || isAbsolute(name)) throw new RangeError(`temp-kit: "${name}" must be a relative path inside the folder`);
  const full = resolve(root, name);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) throw new RangeError(`temp-kit: "${name}" would leave the temporary folder`);
  return full;
}

function wrap(path) {
  let removed = false;
  const dir = {
    path,
    /** A path inside the folder (refuses `..` and absolute paths). */
    join: (...parts) => inside(path, join(...parts)),
    /** Writes a file inside the folder, creating subfolders as needed. Returns its full path. */
    async write(name, content = "") {
      const full = inside(path, name);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
      return full;
    },
    async read(name, encoding = "utf8") {
      return readFile(inside(path, name), encoding);
    },
    /** Deletes the folder and everything in it. Safe to call twice. */
    async remove() {
      if (removed) return;
      removed = true;
      live.delete(path);
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    },
    async [Symbol.asyncDispose]() {
      await dir.remove();
    }
  };
  return dir;
}

/**
 * Makes a new, private temporary folder. It is removed when you call `remove()`, with `await using dir = await createTempDir()`,
 * and as a last resort when the process exits, so tests that crash do not fill the disk.
 */
export async function createTempDir({ prefix = "tmp-", base = tmpdir() } = {}) {
  const path = await mkdtemp(join(base, prefix));
  track(path);
  return wrap(path);
}

/** The synchronous way to get just a path (removed at exit). */
export function createTempDirSync({ prefix = "tmp-", base = tmpdir() } = {}) {
  const path = mkdtempSync(join(base, prefix));
  track(path);
  return path;
}

/** Runs `fn(dir)` with a fresh temporary folder and removes it afterwards, also when `fn` throws. */
export async function withTempDir(fn, options) {
  const dir = await createTempDir(options);
  try {
    return await fn(dir);
  } finally {
    await dir.remove();
  }
}

/** Runs `fn(path)` with a temporary file that has the given content, and removes it afterwards. `name` keeps the extension you need. */
export async function withTempFile(content, fn, { name = "file.tmp", ...options } = {}) {
  return withTempDir(async (dir) => fn(await dir.write(name, content)), options);
}

/** How many folders made by this module are still waiting to be removed (for tests of your own code). */
export const pending = () => live.size;
