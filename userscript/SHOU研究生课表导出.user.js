// ==UserScript==
// @name         SHOU研究生课表导出
// @namespace    https://yjsfw.shou.edu.cn/
// @version      0.1.1
// @description  将上海海洋大学研究生课表导出为通用 ICS、Google Calendar CSV 或 JSON，全程本地处理。
// @author       SHOU Calendar Exporter contributors
// @match        https://yjsfw.shou.edu.cn/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  if (!location.pathname.includes("/sys/wdkbapp/") || document.querySelector("#shou-calendar-exporter-userscript")) return;

  const DAY_MS = 86_400_000;
  const textEncoder = new TextEncoder();
  let schedule = null;

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function parseWeeks(text) {
    if (!text) return [];
    const source = String(text);
    const parity = /单/.test(source) ? 1 : /双/.test(source) ? 0 : null;
    const normalized = source
      .replace(/[－—–~～至]/g, "-")
      .replace(/[，、；;]/g, ",")
      .replace(/第|周/g, " ");
    const tokens = normalized.match(/\d+\s*-\s*\d+|\d+/g) ?? [];
    const weeks = new Set();
    for (const token of tokens) {
      const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) weeks.add(week);
      } else {
        weeks.add(Number(token));
      }
    }
    return [...weeks]
      .filter((week) => Number.isInteger(week) && week > 0 && week <= 60)
      .filter((week) => parity === null || week % 2 === parity)
      .sort((a, b) => a - b);
  }

  function semesterNumber(value) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4 };
    return map[value] ?? (Number(value) || 1);
  }

  function calendarNameFromSemesterText(text) {
    const match = String(text ?? "").match(/(\d{4})\s*[-—至]\s*(\d{4}).*?第?\s*([一二三四1-4])\s*学期/);
    if (!match) return "Cal-Schedule";
    return `Cal-${match[1].slice(-2)}-${match[2].slice(-2)}-${semesterNumber(match[3])}`;
  }

  function isoDateToUtc(value) {
    const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  function addDays(dateText, days) {
    const date = isoDateToUtc(dateText);
    if (!date) throw new Error(`无效日期：${dateText}`);
    return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
  }

  function weekdayMondayFirst(dateText) {
    const date = isoDateToUtc(dateText);
    if (!date) return null;
    const day = date.getUTCDay();
    return day === 0 ? 7 : day;
  }

  function stableHash(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function stableUid(value) {
    return `${stableHash(value)}${stableHash([...String(value)].reverse().join(""))}@shou-calendar-exporter`;
  }

  function collectSameOriginDocuments(rootDocument, visited = new Set()) {
    if (!rootDocument || visited.has(rootDocument)) return [];
    visited.add(rootDocument);
    const documents = [rootDocument];
    for (const frame of rootDocument.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument) documents.push(...collectSameOriginDocuments(frame.contentDocument, visited));
      } catch {
        // Cross-origin frames are outside this script's scope.
      }
    }
    return documents;
  }

  function findScheduleDocument() {
    return collectSameOriginDocuments(document).find((candidate) => candidate.querySelector("#jsTbl_01")) ?? null;
  }

  function extractSchedule(scheduleDocument) {
    const timetable = scheduleDocument.querySelector("#jsTbl_01");
    if (!timetable) throw new Error("没有找到节次课表");

    const detailTable = [...scheduleDocument.querySelectorAll("table")].find((table) => {
      const headerText = cleanText(table.rows?.[0]?.textContent);
      return headerText.includes("课程代码") && headerText.includes("课程名称") && headerText.includes("首次上课日期");
    });

    const details = [];
    if (detailTable?.rows?.length) {
      const headers = [...detailTable.rows[0].cells].map((cell) => cleanText(cell.textContent));
      const column = (name) => headers.indexOf(name);
      const valueAt = (cells, name) => {
        const index = column(name);
        return index >= 0 ? cleanText(cells[index]?.textContent) : "";
      };
      for (const row of [...detailTable.rows].slice(1)) {
        const cells = [...row.cells];
        const courseCode = valueAt(cells, "课程代码");
        const courseName = valueAt(cells, "课程名称");
        const className = valueAt(cells, "班级名称");
        if (!courseCode && !courseName) continue;
        details.push({
          courseCode,
          courseName,
          className,
          displayName: className ? `${courseName}(${className})` : courseName,
          campus: valueAt(cells, "校区"),
          teacher: valueAt(cells, "任课教师"),
          firstDate: valueAt(cells, "首次上课日期"),
          scheduleText: valueAt(cells, "上课时间地点"),
        });
      }
    }

    const periodTimes = {};
    for (const row of [...timetable.rows].slice(1)) {
      const periodCell = row.querySelector("td[jc]");
      const period = Number(periodCell?.getAttribute("jc"));
      const match = cleanText(row.cells?.[1]?.textContent).match(/(\d{1,2}:\d{2})\s*[~～-]\s*(\d{1,2}:\d{2})/);
      if (period && match) {
        periodTimes[period] = {
          startTime: match[1].padStart(5, "0"),
          endTime: match[2].padStart(5, "0"),
        };
      }
    }

    const periodRows = [];
    for (const cell of timetable.querySelectorAll("td[jc][xq]")) {
      const period = Number(cell.getAttribute("jc"));
      const weekday = Number(cell.getAttribute("xq"));
      for (const arrangement of cell.querySelectorAll(":scope > .arrage")) {
        const parts = [...arrangement.children].map((child) => cleanText(child.textContent));
        if (!parts[0] || !parts[1]) continue;
        periodRows.push({
          weekText: parts[0],
          displayName: parts[1],
          teacher: parts[2] ?? "",
          room: parts[3] ?? "",
          method: parts[4] ?? "",
          period,
          weekday,
          startTime: periodTimes[period]?.startTime ?? "",
          endTime: periodTimes[period]?.endTime ?? "",
        });
      }
    }

    const semesterSelect = scheduleDocument.querySelector("#myXnxqSelect");
    return {
      semesterText: cleanText(semesterSelect?.selectedOptions?.[0]?.textContent || semesterSelect?.value),
      details,
      periodRows,
    };
  }

  function matchCourse(displayName, details) {
    const exact = details.find((item) => item.displayName === displayName);
    if (exact) return exact;
    return [...details]
      .sort((a, b) => b.courseName.length - a.courseName.length)
      .find((item) => displayName === item.courseName || displayName.startsWith(`${item.courseName}(`));
  }

  function groupPeriodRecords(records) {
    const groups = new Map();
    for (const record of records) {
      const weeks = [...new Set(record.weeks)].sort((a, b) => a - b);
      const key = JSON.stringify([
        record.courseCode,
        record.courseName,
        record.className,
        record.teacher,
        record.room,
        record.campus,
        record.weekday,
        weeks,
        record.method,
      ]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...record, weeks });
    }

    const blocks = [];
    for (const rows of groups.values()) {
      const sorted = rows.sort((a, b) => a.period - b.period);
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const first = run[0];
        const last = run.at(-1);
        blocks.push({
          ...first,
          startPeriod: first.period,
          endPeriod: last.period,
          startTime: first.startTime,
          endTime: last.endTime,
        });
        run = [];
      };
      for (const row of sorted) {
        if (run.length && row.period !== run.at(-1).period + 1) flush();
        run.push(row);
      }
      flush();
    }
    return blocks.sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod || a.courseName.localeCompare(b.courseName, "zh-CN"));
  }

  function inferWeekOneMonday(blocks) {
    const candidates = new Map();
    for (const block of blocks) {
      if (!block.firstDate || !block.weeks.length) continue;
      if (weekdayMondayFirst(block.firstDate) !== block.weekday) continue;
      const firstWeek = Math.min(...block.weeks);
      const candidate = addDays(block.firstDate, -((firstWeek - 1) * 7 + block.weekday - 1));
      candidates.set(candidate, (candidates.get(candidate) ?? 0) + 1);
    }
    const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { date: ranked[0]?.[0] ?? "", candidateCount: ranked.length };
  }

  function normalizeSchedule(capture) {
    const records = capture.periodRows.map((row) => {
      const detail = matchCourse(row.displayName, capture.details);
      return {
        courseCode: detail?.courseCode ?? "",
        courseName: detail?.courseName ?? row.displayName,
        className: detail?.className ?? "",
        teacher: row.teacher || detail?.teacher || "",
        room: row.room,
        campus: detail?.campus ?? "",
        weekday: Number(row.weekday),
        period: Number(row.period),
        startTime: row.startTime,
        endTime: row.endTime,
        weekText: row.weekText,
        weeks: parseWeeks(row.weekText),
        method: row.method,
        firstDate: detail?.firstDate ?? "",
      };
    });
    const blocks = groupPeriodRecords(records);
    const inference = inferWeekOneMonday(blocks);
    const warnings = [];
    if (!inference.date) warnings.push("无法自动推断第一周日期，请手动填写。");
    if (inference.candidateCount > 1) warnings.push("课程首次日期存在不同推断结果，已采用出现次数最多的日期。");
    if (records.some((item) => !item.startTime || !item.endTime)) warnings.push("部分课节缺少上下课时间。");
    return {
      source: "shou-userscript",
      semesterText: capture.semesterText,
      calendarName: calendarNameFromSemesterText(capture.semesterText),
      weekOneMonday: inference.date,
      blocks,
      unscheduled: capture.details.filter((item) => !item.firstDate || !item.scheduleText),
      warnings,
    };
  }

  function simplifyLocation(campus, room, removeText) {
    const removals = String(removeText)
      .split(/[,，;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    let value = [campus, room].filter(Boolean).join(" ");
    for (const removal of removals) value = value.split(removal).join("");
    return value.replace(/[|｜]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function buildSessions(blocks, weekOneMonday, options) {
    if (!isoDateToUtc(weekOneMonday)) throw new Error("请填写有效的第一周星期一日期");
    const sessions = [];
    for (const block of blocks) {
      if (!block.weeks.length || !block.startTime || !block.endTime) continue;
      for (const week of block.weeks) {
        const date = addDays(weekOneMonday, (week - 1) * 7 + block.weekday - 1);
        const campus = options.campusOverride || block.campus;
        const location = simplifyLocation(campus, block.room, options.removeLocationText);
        const description = [];
        if (options.includeTeacher && block.teacher) description.push(`任课教师：${block.teacher}`);
        if (options.includeClass && block.className) description.push(`班级：${block.className}`);
        description.push(`周次：第${week}周`);
        description.push(`节次：第${block.startPeriod}${block.endPeriod > block.startPeriod ? `-${block.endPeriod}` : ""}节`);
        if (block.courseCode) description.push(`课程代码：${block.courseCode}`);
        if (block.method) description.push(`授课方式：${block.method}`);
        const uidSeed = [block.courseCode || block.courseName, block.className, date, block.startTime, block.endTime, location].join("|");
        sessions.push({
          uid: stableUid(uidSeed),
          title: block.courseName,
          date,
          startTime: block.startTime,
          endTime: block.endTime,
          location,
          description: description.join("\n"),
          week,
          weekday: block.weekday,
          courseCode: block.courseCode,
        });
      }
    }
    return sessions.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`) || a.title.localeCompare(b.title, "zh-CN"));
  }

  function findConflicts(sessions) {
    const byDate = new Map();
    for (const session of sessions) {
      if (!byDate.has(session.date)) byDate.set(session.date, []);
      byDate.get(session.date).push(session);
    }
    const conflicts = [];
    for (const [date, items] of byDate) {
      const sorted = [...items].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].startTime < sorted[index - 1].endTime) conflicts.push({ date, first: sorted[index - 1], second: sorted[index] });
      }
    }
    return conflicts;
  }

  function escapeIcsText(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function foldIcsLine(line) {
    const chunks = [];
    let current = "";
    for (const character of String(line)) {
      if (textEncoder.encode(current + character).length > 75) {
        chunks.push(current);
        current = ` ${character}`;
      } else {
        current += character;
      }
    }
    chunks.push(current);
    return chunks.join("\r\n");
  }

  function createIcs(sessions, calendarName) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SHOU Calendar Exporter//ZH-CN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `NAME:${escapeIcsText(calendarName)}`,
      `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
      "X-WR-TIMEZONE:Asia/Shanghai",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Shanghai",
      "X-LIC-LOCATION:Asia/Shanghai",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0800",
      "TZOFFSETTO:+0800",
      "TZNAME:CST",
      "DTSTART:19700101T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    for (const session of sessions) {
      const date = session.date.replaceAll("-", "");
      const startTime = `${session.startTime.replace(":", "")}00`;
      const endTime = `${session.endTime.replace(":", "")}00`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${session.uid}`,
        `DTSTAMP:${stamp}`,
        `SUMMARY:${escapeIcsText(session.title)}`,
        `DTSTART;TZID=Asia/Shanghai:${date}T${startTime}`,
        `DTEND;TZID=Asia/Shanghai:${date}T${endTime}`,
        `LOCATION:${escapeIcsText(session.location)}`,
        `DESCRIPTION:${escapeIcsText(session.description)}`,
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function googleDate(date) {
    const [year, month, day] = date.split("-");
    return `${month}/${day}/${year}`;
  }

  function googleTime(time) {
    const [rawHour, minute] = time.split(":").map(Number);
    const suffix = rawHour >= 12 ? "PM" : "AM";
    const hour = rawHour % 12 || 12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
  }

  function createGoogleCsv(sessions) {
    const headers = ["Subject", "Start Date", "Start Time", "End Date", "End Time", "All Day Event", "Description", "Location", "Private"];
    const rows = sessions.map((session) => [
      session.title,
      googleDate(session.date),
      googleTime(session.startTime),
      googleDate(session.date),
      googleTime(session.endTime),
      "False",
      session.description.replace(/\r?\n/g, "；"),
      session.location,
      "False",
    ]);
    return `\ufeff${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
  }

  function createJsonExport(currentSchedule, sessions, settings) {
    return `${JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      calendarName: settings.calendarName,
      semesterText: currentSchedule.semesterText,
      weekOneMonday: settings.weekOneMonday,
      source: currentSchedule.source,
      blocks: currentSchedule.blocks,
      sessions,
      unscheduled: currentSchedule.unscheduled,
      warnings: currentSchedule.warnings,
    }, null, 2)}\n`;
  }

  function safeFilename(value) {
    return String(value || "calendar")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "calendar";
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  const host = document.createElement("div");
  host.id = "shou-calendar-exporter-userscript";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .fab, .dialog, button, input, select { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
      .fab { position: fixed; right: 22px; bottom: 22px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 11px 16px; color: #fff; background: linear-gradient(135deg,#0877ea,#0754ae); box-shadow: 0 10px 28px rgba(9,105,218,.3); font-size: 13px; font-weight: 700; cursor: pointer; }
      .fab:hover { transform: translateY(-1px); }
      .overlay { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 20px; background: rgba(8,22,40,.48); backdrop-filter: blur(3px); }
      .hidden { display: none; }
      .dialog { width: min(430px, calc(100vw - 28px)); max-height: min(760px, calc(100vh - 28px)); overflow: auto; border: 1px solid #dfe7f0; border-radius: 18px; padding: 18px; color: #10243e; background: #f5f8fc; box-shadow: 0 22px 70px rgba(8,25,48,.28); }
      .header { display: grid; grid-template-columns: 42px 1fr auto; align-items: center; gap: 11px; margin-bottom: 13px; }
      .mark { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 13px; color: #fff; background: linear-gradient(145deg,#0877ea,#0754ae); font-weight: 800; }
      h1, h2, p { margin: 0; }
      h1 { font-size: 17px; }
      h2 { margin-top: 3px; font-size: 16px; }
      .subtitle, .muted, small { color: #65758b; }
      .subtitle { margin-top: 3px; font-size: 10px; }
      .close { width: 32px; height: 32px; border: 0; border-radius: 9px; color: #52657d; background: #e8eef5; font-size: 18px; cursor: pointer; }
      .card { border: 1px solid #dfe7f0; border-radius: 14px; padding: 14px; background: #fff; }
      .heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .eyebrow { color: #0969da; font-size: 9px; font-weight: 800; letter-spacing: .12em; }
      .chip { padding: 5px 8px; border-radius: 999px; color: #9a6700; background: #fff3cd; font-size: 10px; font-weight: 700; }
      .chip.ready { color: #087f5b; background: #e7f8f1; }
      .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin: 13px 0; }
      .stats div { padding: 9px 7px; border-radius: 10px; background: #f5f8fc; text-align: center; }
      .stats strong { display: block; color: #0969da; font-size: 18px; }
      .stats span { color: #65758b; font-size: 9px; }
      .messages { display: grid; gap: 6px; margin-bottom: 11px; }
      .message { padding: 8px 9px; border-radius: 8px; color: #704d00; background: #fff7db; font-size: 10px; line-height: 1.45; }
      .form { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
      label { display: grid; gap: 4px; color: #42566f; font-size: 10px; font-weight: 650; }
      label.wide { grid-column: 1/-1; }
      input, select { width: 100%; min-height: 35px; border: 1px solid #ced9e6; border-radius: 8px; padding: 7px 8px; color: #10243e; background: #fff; font-size: 11px; outline: none; }
      input:focus, select:focus { border-color: #0969da; box-shadow: 0 0 0 3px rgba(9,105,218,.12); }
      small { font-size: 9px; font-weight: 400; line-height: 1.35; }
      .checks { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
      .checks label { display: flex; grid-auto-flow: column; align-items: center; gap: 5px; }
      .checks input { width: 14px; min-height: 14px; accent-color: #0969da; }
      .actions { display: grid; grid-template-columns: auto 1fr; gap: 8px; }
      .button { border: 0; border-radius: 9px; padding: 10px 12px; font-size: 11px; font-weight: 700; cursor: pointer; }
      .button.secondary { color: #0969da; background: #eaf3ff; }
      .button.primary { color: #fff; background: linear-gradient(135deg,#0969da,#0753a9); }
      .button:disabled { cursor: not-allowed; opacity: .5; }
      .privacy { padding-top: 10px; color: #65758b; font-size: 9px; text-align: center; }
    </style>
    <button class="fab" id="open" type="button">导出课表</button>
    <div class="overlay hidden" id="overlay">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
        <header class="header">
          <div class="mark" aria-hidden="true">海</div>
          <div><h1 id="title">SHOU研究生课表导出</h1><p class="subtitle">Apple · Google · Outlook · Android</p></div>
          <button class="close" id="close" type="button" aria-label="关闭">×</button>
        </header>
        <section class="card">
          <div class="heading">
            <div><p class="eyebrow">导出预览</p><h2 id="calendar-preview">等待读取课表</h2><p class="subtitle" id="status">请打开“学生课程表”页面。</p></div>
            <span class="chip" id="chip">待检查</span>
          </div>
          <div class="stats">
            <div><strong id="courses">0</strong><span>门课程</span></div>
            <div><strong id="blocks">0</strong><span>上课时段</span></div>
            <div><strong id="sessions">0</strong><span>日历事件</span></div>
          </div>
          <div class="messages" id="messages"></div>
          <div class="form">
            <label><span>日历名称</span><input id="calendar-name" type="text"></label>
            <label><span>第一周星期一</span><input id="week-one" type="date"><small id="week-hint">用于将教学周换算为日期</small></label>
            <label><span>校区覆盖</span><input id="campus" type="text" placeholder="留空使用课表校区"></label>
            <label><span>地点中删除</span><input id="remove-location" type="text" value="上海海洋大学"></label>
            <label class="wide"><span>导出格式</span><select id="format"><option value="ics">通用 ICS（推荐）</option><option value="csv">Google Calendar CSV</option><option value="json">标准化 JSON 备份</option></select><small id="format-hint">兼容 Apple、Google、Outlook 及支持 ICS 的安卓日历</small></label>
          </div>
          <div class="checks"><label><input id="teacher" type="checkbox" checked>备注包含教师</label><label><input id="class" type="checkbox" checked>备注包含班级</label></div>
          <div class="actions"><button class="button secondary" id="refresh" type="button">重新读取</button><button class="button primary" id="export" type="button" disabled>下载日历文件</button></div>
        </section>
        <p class="privacy">仅在当前浏览器处理，不读取密码，不上传课表。</p>
      </section>
    </div>`;
  document.documentElement.append(host);

  const elements = {
    open: shadow.querySelector("#open"),
    overlay: shadow.querySelector("#overlay"),
    close: shadow.querySelector("#close"),
    calendarPreview: shadow.querySelector("#calendar-preview"),
    status: shadow.querySelector("#status"),
    chip: shadow.querySelector("#chip"),
    courses: shadow.querySelector("#courses"),
    blocks: shadow.querySelector("#blocks"),
    sessions: shadow.querySelector("#sessions"),
    messages: shadow.querySelector("#messages"),
    calendarName: shadow.querySelector("#calendar-name"),
    weekOne: shadow.querySelector("#week-one"),
    weekHint: shadow.querySelector("#week-hint"),
    campus: shadow.querySelector("#campus"),
    removeLocation: shadow.querySelector("#remove-location"),
    format: shadow.querySelector("#format"),
    formatHint: shadow.querySelector("#format-hint"),
    teacher: shadow.querySelector("#teacher"),
    className: shadow.querySelector("#class"),
    refresh: shadow.querySelector("#refresh"),
    export: shadow.querySelector("#export"),
  };

  function settings() {
    return {
      calendarName: elements.calendarName.value.trim() || schedule?.calendarName || "Cal-Schedule",
      weekOneMonday: elements.weekOne.value,
      campusOverride: elements.campus.value.trim(),
      removeLocationText: elements.removeLocation.value,
      includeTeacher: elements.teacher.checked,
      includeClass: elements.className.checked,
    };
  }

  function showMessages(extra = []) {
    elements.messages.replaceChildren();
    const messages = [...(schedule?.warnings ?? []), ...extra];
    if (schedule?.unscheduled?.length) {
      const names = schedule.unscheduled.map((item) => item.courseName).filter(Boolean).join("、");
      messages.push(`有 ${schedule.unscheduled.length} 门课程尚未安排时间地点，未加入日历：${names}`);
    }
    for (const message of messages) {
      const node = document.createElement("div");
      node.className = "message";
      node.textContent = message;
      elements.messages.append(node);
    }
  }

  function refreshPreview() {
    if (!schedule) return;
    const currentSettings = settings();
    elements.calendarPreview.textContent = currentSettings.calendarName;
    elements.courses.textContent = String(new Set(schedule.blocks.map((item) => item.courseCode || item.courseName)).size);
    elements.blocks.textContent = String(schedule.blocks.length);
    let sessions = [];
    let errorMessage = "";
    try {
      sessions = buildSessions(schedule.blocks, currentSettings.weekOneMonday, currentSettings);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    elements.sessions.textContent = String(sessions.length);
    const conflicts = findConflicts(sessions);
    const extra = [];
    if (errorMessage) extra.push(errorMessage);
    if (conflicts.length) extra.push(`检测到 ${conflicts.length} 处课程时间重叠，请导出后核对。`);
    showMessages(extra);
    const ready = sessions.length > 0 && !errorMessage;
    elements.chip.textContent = ready ? "可以导出" : "待检查";
    elements.chip.classList.toggle("ready", ready);
    elements.export.disabled = !ready;
  }

  function readCurrentSchedule() {
    elements.status.textContent = "正在读取当前课表…";
    elements.refresh.disabled = true;
    try {
      const scheduleDocument = findScheduleDocument();
      if (!scheduleDocument) throw new Error("请先打开“培养管理 → 我的课表 → 学生课程表”，并等待课表显示完成");
      schedule = normalizeSchedule(extractSchedule(scheduleDocument));
      elements.calendarName.value = schedule.calendarName;
      elements.weekOne.value = schedule.weekOneMonday;
      elements.weekHint.textContent = schedule.weekOneMonday ? "已根据首次上课日期自动推断" : "请根据校历手动填写";
      elements.status.textContent = schedule.semesterText || "已读取当前课表";
      refreshPreview();
    } catch (error) {
      schedule = null;
      elements.status.textContent = error instanceof Error ? error.message : String(error);
      elements.chip.textContent = "未读取";
      elements.chip.classList.remove("ready");
      elements.export.disabled = true;
      showMessages();
    } finally {
      elements.refresh.disabled = false;
    }
  }

  function exportSchedule() {
    if (!schedule) return;
    const currentSettings = settings();
    const sessions = buildSessions(schedule.blocks, currentSettings.weekOneMonday, currentSettings);
    const basename = safeFilename(currentSettings.calendarName);
    if (elements.format.value === "csv") {
      downloadFile(createGoogleCsv(sessions), `${basename}-google.csv`, "text/csv;charset=utf-8");
    } else if (elements.format.value === "json") {
      downloadFile(createJsonExport(schedule, sessions, currentSettings), `${basename}.json`, "application/json;charset=utf-8");
    } else {
      downloadFile(createIcs(sessions, currentSettings.calendarName), `${basename}.ics`, "text/calendar;charset=utf-8");
    }
  }

  function updateFormatHint() {
    const hints = {
      ics: "兼容 Apple、Google、Outlook 及支持 ICS 的安卓日历",
      csv: "按每次上课展开，适合 Google Calendar 网页端导入",
      json: "保存标准化课表数据，便于备份或二次转换",
    };
    elements.formatHint.textContent = hints[elements.format.value];
  }

  elements.open.addEventListener("click", () => {
    elements.overlay.classList.remove("hidden");
    readCurrentSchedule();
  });
  elements.close.addEventListener("click", () => elements.overlay.classList.add("hidden"));
  elements.overlay.addEventListener("click", (event) => {
    if (event.target === elements.overlay) elements.overlay.classList.add("hidden");
  });
  elements.refresh.addEventListener("click", readCurrentSchedule);
  elements.export.addEventListener("click", exportSchedule);
  elements.format.addEventListener("change", updateFormatHint);
  for (const input of [elements.calendarName, elements.weekOne, elements.campus, elements.removeLocation, elements.teacher, elements.className]) {
    input.addEventListener("input", refreshPreview);
    input.addEventListener("change", refreshPreview);
  }
})();
