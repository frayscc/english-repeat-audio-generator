import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

if (process.platform !== "win32") {
  throw new Error("Windows portable package must be built and tested on a Windows x64 host.");
}

const root = process.cwd();
const result = spawnSync("npm", ["run", "tauri", "build", "--", "--no-bundle"], {
  cwd: root,
  shell: true,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const destination = path.join(root, "release-v2", "EnglishReader-Windows-x64");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await Promise.all([
  cp(path.join(root, "src-tauri", "target", "release", "english-reader.exe"), path.join(destination, "EnglishReader.exe")),
  cp(path.join(root, "resources-release"), path.join(destination, "resources"), { recursive: true }),
  cp(path.join(root, "LICENSE"), path.join(destination, "LICENSE.txt")),
  cp(path.join(root, "THIRD_PARTY_LICENSES.md"), path.join(destination, "THIRD_PARTY_LICENSES.md")),
]);

const releaseDirectory = path.join(root, "src-tauri", "target", "release");
const runtimeDlls = (await readdir(releaseDirectory)).filter((filename) => filename.toLowerCase().endsWith(".dll"));
await Promise.all(
  runtimeDlls.map((filename) => cp(path.join(releaseDirectory, filename), path.join(destination, filename))),
);

console.log(`Windows portable package created at ${destination} (${runtimeDlls.length} runtime DLLs)`);
