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

// Ctrl-C, `kill` and a closing terminal end a process without an "exit" event, so the folders would stay behind. We only act when
// nobody else listens for the signal (a program with its own shutdown code keeps control and the "exit" hook cleans up later): then
// the folders are removed and the signal is sent again, so the process ends just as it would have without us.
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const handlers = new Map();

function onSignal(signal) {
  if (process.listenerCount(signal) > 1) return;
  removeAllOnExit();
  for (const [name, handler] of handlers) process.removeListener(name, handler);
  handlers.clear();
  process.kill(process.pid, signal);
}

function track(path) {
  live.add(path);
  if (!hooked) {
    hooked = true;
    process.on("exit", removeAllOnExit);
    for (const signal of SIGNALS) {
      const handler = () => onSignal(signal);
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
  }
}

function inside(root, name) {
  if (typeof name !== "string" || name === "" || isAbsolute(name)) throw new RangeError(`temp-kit: "${name}" must be a relative path inside the folder`);
  const full = resolve(root, name);
  const rel = relative(root, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new RangeError(`temp-kit: "${name}" would leave the temporary folder`);
  return full;
}

function wrap(path) {
  let removal;
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
    remove() {
      removal ??= (async () => {
        live.delete(path);
        try {
          await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        } catch (error) {
          // Still there: keep it on the list for the exit hook and allow another try.
          live.add(path);
          removal = undefined;
          throw error;
        }
      })();
      return removal;
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
