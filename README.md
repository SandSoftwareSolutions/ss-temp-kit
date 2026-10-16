# @sandsoftwaresolutions/temp-kit

[![CI](https://github.com/SandSoftwareSolutions/ss-temp-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-temp-kit/actions/workflows/ci.yml)

Temporary folders and files for tests and scripts that clean up after themselves, also when the test fails or the process is killed halfway. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/temp-kit
```

## Usage

```js
import { withTempDir, withTempFile, createTempDir } from "@sandsoftwaresolutions/temp-kit";

// The folder exists during the callback and is removed afterwards, also when it throws
await withTempDir(async (dir) => {
  await dir.write("config/app.json", '{"port": 3000}');   // creates subfolders
  const result = await run(dir.path);
  assert.equal(await dir.read("out/result.txt"), "ok");
});

// One file with the right name and extension
await withTempFile(csvText, (path) => importCsv(path), { name: "people.csv" });

// With explicit resource management (a recent Node): removed at the end of the block
{
  await using dir = await createTempDir({ prefix: "test-" });
  // ...
}
```

## Details

- `createTempDir({ prefix, base })` makes a new private folder (default in the system temp folder) with a random name. `dir.path`, `dir.join(...)`, `dir.write(name, content)`, `dir.read(name)`, `dir.remove()`.
- **Removed on exit as a last resort.** If a test crashes before it can clean up, the folder is still deleted when the process ends, so they do not pile up on your disk.
- **No escaping.** Names given to `write`, `read` and `join` must stay inside the folder: `../x` and absolute paths are refused.
- `createTempDirSync()` just gives you a path (also removed at exit).
- `pending()` counts folders that are not removed yet, handy to check your own test helpers.

`SIGKILL` and power loss cannot be caught by any program; those folders stay in the temp folder, which your system cleans up now and then.
