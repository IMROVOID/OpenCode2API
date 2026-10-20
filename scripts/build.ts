import esbuild from "esbuild";
import fs from "node:fs/promises";

async function build(): Promise<void> {
  console.log("[OpenCode2API] Starting build...");

  await fs.mkdir("dist", { recursive: true });
  await fs.mkdir("worker", { recursive: true });

  console.log("[OpenCode2API] Bundling CLI daemon (dist/cli.js)...");
  await esbuild.build({
    entryPoints: ["src/cli/index.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: "dist/cli.js",
    banner: {
      js: "#!/usr/bin/env node\n",
    },
    sourcemap: true,
  });

  console.log("[OpenCode2API] Bundling standalone Cloudflare Worker (worker/worker.js)...");
  await esbuild.build({
    entryPoints: ["src/worker/index.ts"],
    bundle: true,
    platform: "neutral",
    target: "es2022",
    format: "esm",
    outfile: "worker/worker.js",
    minify: false,
    sourcemap: false,
  });

  const workerStats = await fs.stat("worker/worker.js");
  const cliStats = await fs.stat("dist/cli.js");

  console.log(`✓ CLI bundled: dist/cli.js (${(cliStats.size / 1024).toFixed(1)} KB)`);
  console.log(
    `✓ Worker bundled: worker/worker.js (${(workerStats.size / 1024).toFixed(1)} KB)`,
  );
  console.log("[OpenCode2API] Build completed successfully!\n");
}

build().catch((error) => {
  console.error("[OpenCode2API] Build failed:", error);
  process.exit(1);
});
