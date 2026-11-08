// Writes latest.json, the feed the in-app updater reads, from the signed bundles of a release.
// Usage: node scripts/updater-manifest.mjs <version> <bundles dir>
//
// GitHub turns spaces in asset names into dots ("Open MF.app.tar.gz" -> "Open.MF.app.tar.gz"),
// so files are renamed the same way first and the URLs below match what gets uploaded.
import { readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const [version, dir] = process.argv.slice(2);
if (!version || !dir) {
  console.error("usage: node scripts/updater-manifest.mjs <version> <bundles dir>");
  process.exit(1);
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
for (const f of walk(dir)) {
  if (basename(f).includes(" ")) renameSync(f, join(dirname(f), basename(f).replaceAll(" ", ".")));
}
const files = walk(dir);

const base = `https://github.com/ph1p/open-mf/releases/download/v${version}`;
const entry = (re) => {
  const file = files.find((f) => re.test(basename(f)) && files.includes(`${f}.sig`));
  if (!file) throw new Error(`no signed bundle matching ${re} in ${dir}`);
  return { signature: readFileSync(`${file}.sig`, "utf8").trim(), url: `${base}/${encodeURIComponent(basename(file))}` };
};

// The macOS build is universal: one archive serves both architectures.
const mac = entry(/\.app\.tar\.gz$/);
const manifest = {
  version,
  notes: `See https://github.com/ph1p/open-mf/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": mac,
    "darwin-x86_64": mac,
    "windows-x86_64": entry(/-setup\.exe$/),
    "linux-x86_64": entry(/\.AppImage$/),
  },
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json for ${version}: ${Object.keys(manifest.platforms).join(", ")}`);
