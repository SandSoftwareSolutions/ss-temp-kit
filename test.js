import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { test } from "node:test";

import { createTempDir, createTempDirSync, pending, withTempDir, withTempFile } from "./src/index.js";

test("creates a private folder in the temp directory and removes it", async () => {
  const dir = await createTempDir({ prefix: "kit-" });
  assert.equal(dirname(dir.path), tmpdir());
  assert.ok(basename(dir.path).startsWith("kit-"));
  assert.ok(statSync(dir.path).isDirectory());
  await dir.write("a/b/c.txt", "hello");
  assert.equal(await dir.read("a/b/c.txt"), "hello");
  assert.equal(readFileSync(dir.join("a", "b", "c.txt"), "utf8"), "hello");
  await dir.remove();
  await dir.remove();
  assert.equal(existsSync(dir.path), false);
});

test("withTempDir cleans up after success and after an error", async () => {
  let seen;
  assert.equal(await withTempDir(async (dir) => { seen = dir.path; await dir.write("x", "1"); return 42; }), 42);
  assert.equal(existsSync(seen), false);
  await assert.rejects(withTempDir((dir) => { seen = dir.path; throw new Error("boom"); }), /boom/);
  assert.equal(existsSync(seen), false);
});

test("withTempFile gives a path with the content and the name you need", async () => {
  await withTempFile('{"a":1}', (path) => {
    assert.ok(path.endsWith("config.json"));
    assert.equal(readFileSync(path, "utf8"), '{"a":1}');
  }, { name: "config.json" });
});

test("names cannot leave the folder", async () => {
  const dir = await createTempDir();
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "", "."]) {
    await assert.rejects(dir.write(bad, "x"), RangeError, bad);
  }
  assert.throws(() => dir.join("..", "x"), RangeError);
  await dir.remove();
});

test("await using removes the folder at the end of the block", async () => {
  const run = new Function("createTempDir", "return (async () => { let path; { await using dir = await createTempDir(); path = dir.path; await dir.write('x', '1'); } return path; })()");
  let path;
  try {
    path = await run(createTempDir);
  } catch (error) {
    if (error instanceof SyntaxError) return; // this Node version has no `await using`
    throw error;
  }
  assert.equal(existsSync(path), false);
});

test("folders are removed when the process exits, even if nobody cleaned up", () => {
  const url = new URL("./src/index.js", import.meta.url).href;
  const script = `import { createTempDirSync, createTempDir } from ${JSON.stringify(url)}; const a = createTempDirSync(); const b = await createTempDir(); console.log(a); console.log(b.path);`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  const [a, b] = run.stdout.trim().split("\n");
  assert.ok(a && b);
  assert.equal(existsSync(a), false);
  assert.equal(existsSync(b), false);
});

test("pending counts folders not yet removed", async () => {
  const before = pending();
  const dir = await createTempDir();
  assert.equal(pending(), before + 1);
  await dir.remove();
  assert.equal(pending(), before);
  const sync = createTempDirSync();
  assert.ok(existsSync(sync));
});

test("a file name that merely starts with two dots is fine", async () => {
  await withTempDir(async (dir) => {
    await dir.write("..hidden", "1");
    await dir.write("a/..b/c", "2");
    assert.equal(await dir.read("..hidden"), "1");
    assert.equal(await dir.read("a/..b/c"), "2");
    assert.throws(() => dir.join(".."), RangeError);
    assert.throws(() => dir.join("a", "..", "..", "x"), RangeError);
  });
});

test("folders are removed when the process is ended by Ctrl-C, kill or a closing terminal", { skip: process.platform === "win32" }, () => {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const code = `
      import { createTempDir } from ${JSON.stringify(new URL("./src/index.js", import.meta.url).href)};
      const dir = await createTempDir({ prefix: "signal-test-" });
      await dir.write("x", "1");
      console.log(dir.path);
      process.kill(process.pid, ${JSON.stringify(signal)});
      setTimeout(() => {}, 5000);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
    assert.equal(result.signal, signal, "the process still ends by the signal");
    assert.equal(existsSync(result.stdout.trim()), false, `${signal} left the folder behind`);
  }
});

test("a program with its own signal handler keeps control", { skip: process.platform === "win32" }, () => {
  const code = `
    import { createTempDir } from ${JSON.stringify(new URL("./src/index.js", import.meta.url).href)};
    const dir = await createTempDir({ prefix: "signal-own-" });
    process.on("SIGTERM", () => { console.log("mine " + dir.path); process.exit(0); });
    process.kill(process.pid, "SIGTERM");
    setTimeout(() => {}, 5000);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^mine /);
  assert.equal(existsSync(result.stdout.trim().slice(5)), false, "still removed by the exit hook");
});

test("a failed removal can be tried again and is not forgotten", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const dir = await createTempDir();
  await dir.write("locked/file", "1");
  chmodSync(dir.join("locked"), 0o500);
  const before = pending();
  await assert.rejects(dir.remove());
  assert.equal(pending(), before, "still counted as pending");
  chmodSync(dir.join("locked"), 0o700);
  await dir.remove();
  assert.equal(existsSync(dir.path), false);
  assert.equal(pending(), before - 1);
});
