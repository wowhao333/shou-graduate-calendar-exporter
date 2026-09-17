import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildSessions,
  calendarNameFromSemesterCode,
  calendarNameFromSemesterText,
  normalizeApiJson,
  parseWeekMask,
  parseWeeks,
} from "../core/schedule.js";
import { createGoogleCsv, createIcs, safeFilename } from "../core/exporters.js";

const apiFixture = {
  code: "0",
  datas: {
    xspkjgcx: {
      rows: [
        {
          KCDM: "TEST001",
          KCMC: "跨平台日历测试课程",
          BJMC: "测试班",
          JSXM: "测试教师",
          JASMC: "上海海洋大学 临港校区 1001",
          XQ: 1,
          KSJCDM: 1,
          KSSJ: 815,
          JSSJ: 900,
          ZCMC: "2-3周",
          ZCBH: "01100000000000000000",
          SKFSDM_DISPLAY: "面授讲课",
          XNXQDM: "20261"
        },
        {
          KCDM: "TEST001",
          KCMC: "跨平台日历测试课程",
          BJMC: "测试班",
          JSXM: "测试教师",
          JASMC: "上海海洋大学 临港校区 1001",
          XQ: 1,
          KSJCDM: 2,
          KSSJ: 905,
          JSSJ: 950,
          ZCMC: "2-3周",
          ZCBH: "01100000000000000000",
          SKFSDM_DISPLAY: "面授讲课",
          XNXQDM: "20261"
        }
      ]
    }
  }
};

test("parses continuous, odd and masked teaching weeks", () => {
  assert.deepEqual(parseWeeks("2-5周"), [2, 3, 4, 5]);
  assert.deepEqual(parseWeeks("1-8周（单周）"), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeks("2、4、8周"), [2, 4, 8]);
  assert.deepEqual(parseWeekMask("01101"), [2, 3, 5]);
});

test("builds the requested calendar title", () => {
  assert.equal(calendarNameFromSemesterCode("20261"), "Cal-26-27-1");
  assert.equal(calendarNameFromSemesterText("2026-2027学年 第一学期"), "Cal-26-27-1");
});

test("merges adjacent periods and expands exact sessions", () => {
  const schedule = normalizeApiJson(apiFixture);
  assert.equal(schedule.blocks.length, 1);
  assert.equal(schedule.blocks[0].startTime, "08:15");
  assert.equal(schedule.blocks[0].endTime, "09:50");
  assert.deepEqual(schedule.blocks[0].weeks, [2, 3]);

  const sessions = buildSessions(schedule.blocks, "2026-09-14", {
    removeLocationText: "上海海洋大学",
  });
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].date, "2026-09-21");
  assert.equal(sessions[1].date, "2026-09-28");
  assert.equal(sessions[0].location, "临港校区 1001");
});

test("creates a CRLF and 75-octet-safe universal ICS", () => {
  const schedule = normalizeApiJson(apiFixture);
  const sessions = buildSessions(schedule.blocks, "2026-09-14", {
    removeLocationText: "上海海洋大学",
  });
  const ics = createIcs(sessions, "Cal-26-27-1", new Date("2026-09-17T04:00:00Z"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.match(ics, /NAME:Cal-26-27-1\r\n/);
  assert.match(ics, /TZID=Asia\/Shanghai/);
  assert.equal(/(^|[^\r])\n/.test(ics), false);
  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line exceeds 75 octets: ${line}`);
  }
});

test("creates Google Calendar CSV with one row per occurrence", () => {
  const schedule = normalizeApiJson(apiFixture);
  const sessions = buildSessions(schedule.blocks, "2026-09-14");
  const csv = createGoogleCsv(sessions);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Subject,Start Date,Start Time/);
  assert.match(lines[1], /09\/21\/2026,08:15 AM/);
  assert.equal(/(^|[^\r])\n/.test(csv), false);
});

test("sanitizes generated filenames", () => {
  assert.equal(safeFilename(' Cal:26/27*1 '), "Cal-26-27-1");
});

test("limits the extension action to the SHOU graduate service host", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.equal(manifest.name, "SHOU研究生课表导出");
  assert.equal(manifest.action.default_state, "disabled");
  assert.ok(manifest.permissions.includes("declarativeContent"));
  assert.match(background, /hostEquals:\s*"yjsfw\.shou\.edu\.cn"/);
  assert.match(background, /schemes:\s*\["https"\]/);
});
