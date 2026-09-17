const DAY_MS = 86_400_000;

export function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return "";
  const digits = String(value).replace(/\D/g, "").padStart(4, "0").slice(-4);
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseWeekMask(mask) {
  if (typeof mask !== "string") return [];
  return [...mask].flatMap((flag, index) => (flag === "1" ? [index + 1] : []));
}

export function parseWeeks(text) {
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
    const match = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
        weeks.add(week);
      }
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

export function calendarNameFromSemesterText(text) {
  const match = String(text ?? "").match(/(\d{4})\s*[-—至]\s*(\d{4}).*?第?\s*([一二三四1-4])\s*学期/);
  if (!match) return "Cal-Schedule";
  return `Cal-${match[1].slice(-2)}-${match[2].slice(-2)}-${semesterNumber(match[3])}`;
}

export function calendarNameFromSemesterCode(code) {
  const match = String(code ?? "").match(/^(\d{4})([1-4])$/);
  if (!match) return "Cal-Schedule";
  const startYear = Number(match[1]);
  return `Cal-${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}-${match[2]}`;
}

function isoDateToUtc(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function utcToIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateText, days) {
  const date = isoDateToUtc(dateText);
  if (!date) throw new Error(`无效日期：${dateText}`);
  return utcToIsoDate(new Date(date.getTime() + days * DAY_MS));
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

function directCourseMatch(displayName, details) {
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
    const identity = JSON.stringify([
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
    const normalized = { ...record, weeks };
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(normalized);
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

export function inferWeekOneMonday(blocks) {
  const candidates = new Map();
  for (const block of blocks) {
    if (!block.firstDate || !block.weeks.length) continue;
    if (weekdayMondayFirst(block.firstDate) !== block.weekday) continue;
    const firstWeek = Math.min(...block.weeks);
    const candidate = addDays(block.firstDate, -((firstWeek - 1) * 7 + block.weekday - 1));
    candidates.set(candidate, (candidates.get(candidate) ?? 0) + 1);
  }
  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    date: ranked[0]?.[0] ?? "",
    confidence: ranked[0]?.[1] ?? 0,
    candidates: Object.fromEntries(ranked),
  };
}

export function normalizeDomCapture(capture) {
  if (!capture || capture.kind !== "shou-schedule") throw new Error("没有找到可识别的课表页面");
  const details = Array.isArray(capture.details) ? capture.details : [];
  const records = (capture.periodRows ?? []).map((row) => {
    const detail = directCourseMatch(row.displayName, details);
    return {
      courseCode: detail?.courseCode ?? "",
      courseName: detail?.courseName ?? row.displayName,
      className: detail?.className ?? "",
      teacher: row.teacher || detail?.teacher || "",
      room: row.room ?? "",
      campus: detail?.campus ?? "",
      weekday: Number(row.weekday),
      period: Number(row.period),
      startTime: row.startTime,
      endTime: row.endTime,
      weekText: row.weekText,
      weeks: parseWeeks(row.weekText),
      method: row.method ?? "",
      firstDate: detail?.firstDate ?? "",
    };
  });
  const blocks = groupPeriodRecords(records);
  const inference = inferWeekOneMonday(blocks);
  const unscheduled = details.filter((item) => !item.firstDate || !item.scheduleText);
  const warnings = [];
  if (!inference.date) warnings.push("无法自动推断第一周日期，请手动填写。");
  if (Object.keys(inference.candidates).length > 1) warnings.push("课程首次日期存在不同推断结果，已采用出现次数最多的日期。");
  if (records.some((item) => !item.startTime || !item.endTime)) warnings.push("部分课节缺少上下课时间。");

  return {
    source: "shou-page",
    sourceUrl: capture.pageUrl,
    semesterText: capture.semesterText,
    calendarName: calendarNameFromSemesterText(capture.semesterText),
    weekOneMonday: inference.date,
    blocks,
    unscheduled,
    warnings,
  };
}

export function normalizeApiJson(data) {
  const rows = data?.datas?.xspkjgcx?.rows;
  if (!Array.isArray(rows)) throw new Error("JSON 中未找到 datas.xspkjgcx.rows");
  const records = rows.map((row) => ({
    courseCode: String(row.KCDM ?? ""),
    courseName: String(row.KCMC ?? "未命名课程"),
    className: String(row.BJMC ?? ""),
    teacher: String(row.JSXM ?? ""),
    room: String(row.JASMC ?? ""),
    campus: "",
    weekday: Number(row.XQ),
    period: Number(row.KSJCDM),
    startTime: normalizeTime(row.KSSJ),
    endTime: normalizeTime(row.JSSJ),
    weekText: String(row.ZCMC ?? ""),
    weeks: parseWeekMask(row.ZCBH).length ? parseWeekMask(row.ZCBH) : parseWeeks(row.ZCMC),
    method: String(row.SKFSDM_DISPLAY ?? ""),
    firstDate: "",
  }));
  const semesterCode = rows.find((row) => row.XNXQDM)?.XNXQDM ?? "";
  const warnings = ["接口 JSON 不含学期第一周日期，请手动填写后再导出。"];
  if (records.some((item) => !item.startTime || !item.endTime)) warnings.push("部分课节缺少上下课时间。");
  return {
    source: "shou-api-json",
    sourceUrl: "",
    semesterText: String(semesterCode),
    calendarName: calendarNameFromSemesterCode(semesterCode),
    weekOneMonday: "",
    blocks: groupPeriodRecords(records),
    unscheduled: [],
    warnings,
  };
}

export function simplifyLocation(campus, room, removeText = "上海海洋大学") {
  const removals = String(removeText)
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  let value = [campus, room].filter(Boolean).join(" ");
  for (const removal of removals) value = value.split(removal).join("");
  return value.replace(/[|｜]+/g, " ").replace(/\s+/g, " ").trim();
}

export function buildSessions(blocks, weekOneMonday, options = {}) {
  if (!isoDateToUtc(weekOneMonday)) throw new Error("请填写有效的第一周星期一日期");
  const settings = {
    campusOverride: "",
    removeLocationText: "上海海洋大学",
    includeTeacher: true,
    includeClass: true,
    ...options,
  };
  const sessions = [];

  for (const block of blocks) {
    if (!block.weeks.length || !block.startTime || !block.endTime) continue;
    for (const week of block.weeks) {
      const date = addDays(weekOneMonday, (week - 1) * 7 + block.weekday - 1);
      const campus = settings.campusOverride || block.campus;
      const location = simplifyLocation(campus, block.room, settings.removeLocationText);
      const description = [];
      if (settings.includeTeacher && block.teacher) description.push(`任课教师：${block.teacher}`);
      if (settings.includeClass && block.className) description.push(`班级：${block.className}`);
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

export function findConflicts(sessions) {
  const conflicts = [];
  const byDate = Map.groupBy ? Map.groupBy(sessions, (item) => item.date) : sessions.reduce((map, item) => {
    if (!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push(item);
    return map;
  }, new Map());
  for (const [date, items] of byDate) {
    const sorted = [...items].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].startTime < sorted[index - 1].endTime) {
        conflicts.push({ date, first: sorted[index - 1].title, second: sorted[index].title });
      }
    }
  }
  return conflicts;
}
