import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
const userscriptPath = join(projectRoot, "userscript", "SHOU研究生课表导出.user.js");
const userscript = await readFile(userscriptPath, "utf8");

if (manifest.version !== packageJson.version) {
  throw new Error(`manifest.json (${manifest.version}) 与 package.json (${packageJson.version}) 版本不一致`);
}
if (!new RegExp(`^// @version\\s+${packageJson.version.replaceAll(".", "\\.")}$`, "m").test(userscript)) {
  throw new Error("油猴脚本版本与 package.json 不一致");
}

const distDir = join(projectRoot, "dist");
const temporaryRoot = await mkdtemp(join(tmpdir(), "shou-calendar-exporter-"));
const extensionDir = join(temporaryRoot, "SHOU研究生课表导出");
const zipPath = join(distDir, `shou-calendar-exporter-v${packageJson.version}.zip`);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(extensionDir, { recursive: true });

for (const relativePath of [
  "manifest.json",
  "background.js",
  "core",
  "popup",
  "README.md",
  "LICENSE",
]) {
  await cp(join(projectRoot, relativePath), join(extensionDir, basename(relativePath)), { recursive: true });
}

execFileSync("zip", ["-r", "-q", zipPath, basename(extensionDir)], { cwd: temporaryRoot });
await cp(userscriptPath, join(distDir, "shou-calendar-exporter.user.js"));
await rm(temporaryRoot, { recursive: true, force: true });

console.log(`已生成 ${zipPath}`);
console.log(`已生成 ${join(distDir, "shou-calendar-exporter.user.js")}`);
