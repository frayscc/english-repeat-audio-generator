import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, "dist", "v2");
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: {
    app: path.join(root, "src", "app", "main.ts"),
  },
  outdir: outputDirectory,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  target: ["safari16", "chrome120", "edge120"],
  sourcemap: false,
  legalComments: "none",
  define: {
    __TAURI_V2__: "true",
    __V2_DEV_SMOKE__: JSON.stringify(process.env.V2_TTS_SMOKE === "1"),
    __V2_BENCHMARK__: JSON.stringify(process.env.V2_BENCHMARK === "1"),
  },
  plugins: [{
    name: "native-v2-only",
    setup(build) {
      build.onResolve({ filter: /\/tts\/(kokoroEngine|offlineResources)$/ }, (args) => ({
        path: args.path.endsWith("kokoroEngine") ? "kokoro-engine" : "offline-resources",
        namespace: "v2-stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "v2-stub" }, (args) => ({
        contents: args.path === "kokoro-engine"
          ? "export class KokoroEngine { constructor(){ throw new Error('V1 browser engine is unavailable in the desktop build') } }"
          : "export function installOfflineResources(){ return () => {} }",
        loader: "js",
      }));
    },
  }],
});

const [template, styles] = await Promise.all([
  readFile(path.join(root, "src", "app", "app.template.html"), "utf8"),
  readFile(path.join(root, "src", "ui", "styles.css"), "utf8"),
]);

const html = template
  .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
  .replace("<style>{{APP_STYLES}}</style>", '<link rel="stylesheet" href="./styles.css">')
  .replace("{{EMBEDDED_ASSETS}}", "")
  .replace("<script>{{APP_BUNDLE}}</script>", '<script type="module" src="./app.js"></script>');

await Promise.all([
  writeFile(path.join(outputDirectory, "index.html"), html),
  writeFile(path.join(outputDirectory, "styles.css"), styles),
]);

console.log("Built dist/v2 desktop frontend shell");
