// Writes one version into every manifest the app build reads.
// Used by semantic-release (prepareCmd) and by CI before bundling.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}

const edit = (path, fn) => {
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before && !before.includes(version)) throw new Error(`no version found in ${path}`);
  writeFileSync(path, after);
};

edit("package.json", (s) => s.replace(/("version":\s*")[^"]+"/, `$1${version}"`));
edit("src-tauri/tauri.conf.json", (s) => s.replace(/("version":\s*")[^"]+"/, `$1${version}"`));
edit("src-tauri/Cargo.toml", (s) => s.replace(/^(version\s*=\s*")[^"]+"/m, `$1${version}"`));
edit("src-tauri/Cargo.lock", (s) => s.replace(/(name = "minifuse-panel"\nversion = ")[^"]+"/, `$1${version}"`));
