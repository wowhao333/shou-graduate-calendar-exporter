import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../userscript/SHOU研究生课表导出.user.js", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("release versions stay in sync", () => {
  assert.equal(manifest.version, packageJson.version);
  assert.match(source, new RegExp(`^// @version\\s+${packageJson.version.replaceAll(".", "\\.")}$`, "m"));
});

test("userscript is restricted to the SHOU graduate service host", () => {
  assert.match(source, /\/\/ @name\s+SHOU研究生课表导出/);
  assert.match(source, /\/\/ @match\s+https:\/\/yjsfw\.shou\.edu\.cn\/\*/);
  assert.match(source, /\/\/ @grant\s+none/);
  assert.match(source, /location\.pathname\.includes\("\/sys\/wdkbapp\/"\)/);
});

test("userscript has no remote code or credential access", () => {
  const executable = source.replace(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m, "");
  assert.doesNotMatch(executable, /\bfetch\s*\(/);
  assert.doesNotMatch(executable, /XMLHttpRequest|document\.cookie|GM_xmlhttpRequest|\beval\s*\(/);
  assert.doesNotMatch(executable, /<script[^>]+src=/i);
});

test("userscript includes every supported export format", () => {
  assert.match(source, /value="ics"/);
  assert.match(source, /value="csv"/);
  assert.match(source, /value="json"/);
  assert.match(source, /BEGIN:VCALENDAR/);
  assert.match(source, /Subject.*Start Date.*Start Time/);
});
