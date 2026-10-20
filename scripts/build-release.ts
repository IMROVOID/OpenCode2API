import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildZip, readZipEntries, type ZipEntry } from "./zip.js";

// The platforms the release archives are built for.
const TARGETS = [
  { target: "linux-x64", platform: "linux", arch: "x64" },
  { target: "linux-arm64", platform: "linux", arch: "arm64" },
  { target: "win-x64", platform: "win32", arch: "x64" },
  { target: "win-arm64", platform: "win32", arch: "arm64" },
  { target: "macos-x64", platform: "darwin", arch: "x64" },
  { target: "macos-arm64", platform: "darwin", arch: "arm64" },
];

// The version the archives are named after.
const VERSION = "1.0.0";

// buildRelease bundles the CLI for every target and writes the archives. Each
// archive holds the executable, an example configuration the user renames to
// config.json, the README and the license.
async function buildRelease(): Promise<void> {
  console.log("[OpenCode2API] Starting release build...");

  if (!existsSync("dist/cli.js")) {
    throw new Error("dist/cli.js is missing; run the build first");
  }
  const cli = await readFile("dist/cli.js");
  const example = await readFile("config.example.json");
  const readme = await readFile("README.md");
  const license = await readFile("LICENSE");

  await rm("release", { recursive: true, force: true });
  await mkdir("release", { recursive: true });

  for (const target of TARGETS) {
    const entries: ZipEntry[] = [
      { name: "opencode2api-proxy.js", data: cli },
      { name: "config.example.json", data: example },
      { name: "README.md", data: readme },
      { name: "LICENSE", data: license },
    ];
    if (target.platform === "win32") {
      const pkg = await readFile("package.json");
      entries.push({ name: "package.json", data: pkg });
    }
    const archive = buildZip(entries);
    const name = `opencode2api-proxy-v${VERSION}-${target.target}.zip`;
    await writeFile(`release/${name}`, archive);
    const names = readZipEntries(archive);
    if (!names.includes("config.example.json")) {
      throw new Error(`${name} is missing its example configuration`);
    }
    console.log(
      `✓ ${name} (${(archive.length / 1024).toFixed(1)} KB, ${names.length} files)`,
    );
  }

  console.log("[OpenCode2API] Release build completed successfully!\n");
}

buildRelease().catch((error) => {
  console.error("[OpenCode2API] Release build failed:", error);
  process.exit(1);
});
