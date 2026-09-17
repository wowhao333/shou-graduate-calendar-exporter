import {
  buildSessions,
  findConflicts,
  normalizeApiJson,
  normalizeDomCapture,
} from "../core/schedule.js";
import {
  createGoogleCsv,
  createIcs,
  createJsonExport,
  safeFilename,
} from "../core/exporters.js";

let schedule = null;

const elements = {
  readPage: document.querySelector("#read-page"),
  jsonFile: document.querySelector("#json-file"),
  sourceTitle: document.querySelector("#source-title"),
  statusText: document.querySelector("#status-text"),
  preview: document.querySelector("#preview"),
  calendarPreview: document.querySelector("#calendar-preview"),
  readyChip: document.querySelector("#ready-chip"),
  courseCount: document.querySelector("#course-count"),
  blockCount: document.querySelector("#block-count"),
  sessionCount: document.querySelector("#session-count"),
  messages: document.querySelector("#messages"),
  calendarName: document.querySelector("#calendar-name"),
  weekOne: document.querySelector("#week-one"),
  weekOneHint: document.querySelector("#week-one-hint"),
  campus: document.querySelector("#campus"),
  removeLocation: document.querySelector("#remove-location"),
  format: document.querySelector("#format"),
  formatHint: document.querySelector("#format-hint"),
  includeTeacher: document.querySelector("#include-teacher"),
  includeClass: document.querySelector("#include-class"),
  exportButton: document.querySelector("#export"),
};

function extractScheduleFrame() {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const timetable = document.querySelector("#jsTbl_01");
  if (!timetable) return null;

  const detailTable = [...document.querySelectorAll("table")].find((table) => {
    const headerText = clean(table.rows?.[0]?.textContent);
    return headerText.includes("课程代码") && headerText.includes("课程名称") && headerText.includes("首次上课日期");
  });

  const details = [];
  if (detailTable?.rows?.length) {
    const headers = [...detailTable.rows[0].cells].map((cell) => clean(cell.textContent));
    const column = (name) => headers.indexOf(name);
    const valueAt = (cells, name) => {
      const index = column(name);
      return index >= 0 ? clean(cells[index]?.textContent) : "";
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
    const match = clean(row.cells?.[1]?.textContent).match(/(\d{1,2}:\d{2})\s*[~～-]\s*(\d{1,2}:\d{2})/);
    if (period && match) periodTimes[period] = { startTime: match[1].padStart(5, "0"), endTime: match[2].padStart(5, "0") };
  }

  const periodRows = [];
  for (const cell of timetable.querySelectorAll("td[jc][xq]")) {
    const period = Number(cell.getAttribute("jc"));
    const weekday = Number(cell.getAttribute("xq"));
    for (const arrangement of cell.querySelectorAll(":scope > .arrage")) {
      const parts = [...arrangement.children].map((child) => clean(child.textContent));
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

  const semesterSelect = document.querySelector("#myXnxqSelect");
  const semesterText = clean(semesterSelect?.selectedOptions?.[0]?.textContent || semesterSelect?.value);
  return {
    kind: "shou-schedule",
    pageUrl: location.href,
    semesterText,
    details,
    periodRows,
  };
}

function setLoading(message) {
  elements.sourceTitle.textContent = "正在读取课表";
  elements.statusText.textContent = message;
  elements.readPage.disabled = true;
}

function setError(message) {
  elements.sourceTitle.textContent = "未能读取课表";
  elements.statusText.textContent = message;
  elements.readPage.disabled = false;
}

async function captureCurrentPage() {
  setLoading("正在检查当前标签页和课表 iframe…");
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error("没有找到当前标签页");
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: extractScheduleFrame,
    });
    const capture = results.map((item) => item.result).find((item) => item?.kind === "shou-schedule" && item.periodRows?.length);
    if (!capture) throw new Error("请先打开研究生平台中的“学生课程表”页面，并等待课表显示完成");
    schedule = normalizeDomCapture(capture);
    renderSchedule("已从当前课表页面读取");
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

function currentSettings() {
  return {
    calendarName: elements.calendarName.value.trim() || schedule?.calendarName || "Cal-Schedule",
    weekOneMonday: elements.weekOne.value,
    campusOverride: elements.campus.value.trim(),
    removeLocationText: elements.removeLocation.value,
    includeTeacher: elements.includeTeacher.checked,
    includeClass: elements.includeClass.checked,
  };
}

function renderMessages(extraMessages = []) {
  elements.messages.replaceChildren();
  const messages = [...(schedule?.warnings ?? []), ...extraMessages];
  if (schedule?.unscheduled?.length) {
    const names = schedule.unscheduled.map((item) => item.courseName).filter(Boolean).join("、");
    messages.push(`有 ${schedule.unscheduled.length} 门课程尚未安排时间地点，未加入日历：${names}`);
  }
  for (const text of messages) {
    const item = document.createElement("div");
    item.className = "message warning";
    item.textContent = text;
    elements.messages.append(item);
  }
}

function refreshPreview() {
  if (!schedule) return;
  const settings = currentSettings();
  elements.calendarPreview.textContent = settings.calendarName;
  const courseKeys = new Set(schedule.blocks.map((item) => item.courseCode || item.courseName));
  elements.courseCount.textContent = String(courseKeys.size);
  elements.blockCount.textContent = String(schedule.blocks.length);

  let sessions = [];
  let errorMessage = "";
  try {
    sessions = buildSessions(schedule.blocks, settings.weekOneMonday, settings);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  elements.sessionCount.textContent = String(sessions.length);
  const conflicts = findConflicts(sessions);
  const extra = [];
  if (errorMessage) extra.push(errorMessage);
  if (conflicts.length) extra.push(`检测到 ${conflicts.length} 处课程时间重叠，请导出后核对。`);
  renderMessages(extra);

  const ready = sessions.length > 0 && !errorMessage;
  elements.readyChip.textContent = ready ? "可以导出" : "待检查";
  elements.readyChip.classList.toggle("ready", ready);
  elements.exportButton.disabled = !ready;
}

function renderSchedule(sourceMessage) {
  elements.preview.classList.remove("hidden");
  elements.sourceTitle.textContent = schedule.semesterText || "已读取课表";
  elements.statusText.textContent = sourceMessage;
  elements.calendarName.value = schedule.calendarName;
  elements.weekOne.value = schedule.weekOneMonday;
  elements.weekOneHint.textContent = schedule.weekOneMonday
    ? "已根据首次上课日期自动推断"
    : "JSON 不包含该日期，请按校历填写";
  elements.readPage.disabled = false;
  refreshPreview();
}

async function importJson(file) {
  if (!file) return;
  setLoading("正在检查 JSON 字段…");
  try {
    const data = JSON.parse(await file.text());
    schedule = normalizeApiJson(data);
    renderSchedule(`已导入 ${file.name}`);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    elements.jsonFile.value = "";
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function exportSchedule() {
  if (!schedule) return;
  const settings = currentSettings();
  const sessions = buildSessions(schedule.blocks, settings.weekOneMonday, settings);
  const basename = safeFilename(settings.calendarName);
  if (elements.format.value === "csv") {
    downloadFile(createGoogleCsv(sessions), `${basename}-google.csv`, "text/csv;charset=utf-8");
  } else if (elements.format.value === "json") {
    downloadFile(createJsonExport(schedule, sessions, settings), `${basename}.json`, "application/json;charset=utf-8");
  } else {
    downloadFile(createIcs(sessions, settings.calendarName), `${basename}.ics`, "text/calendar;charset=utf-8");
  }
}

function updateFormatHint() {
  const hints = {
    ics: "兼容 Apple、Google、Outlook 及支持 ICS 的安卓日历",
    csv: "按每次上课展开，适合在 Google Calendar 网页端导入",
    json: "保存标准化课表数据，便于备份或二次转换",
  };
  elements.formatHint.textContent = hints[elements.format.value];
}

elements.readPage.addEventListener("click", captureCurrentPage);
elements.jsonFile.addEventListener("change", () => importJson(elements.jsonFile.files?.[0]));
elements.exportButton.addEventListener("click", exportSchedule);
elements.format.addEventListener("change", updateFormatHint);

for (const input of [
  elements.calendarName,
  elements.weekOne,
  elements.campus,
  elements.removeLocation,
  elements.includeTeacher,
  elements.includeClass,
]) {
  input.addEventListener("input", refreshPreview);
  input.addEventListener("change", refreshPreview);
}

updateFormatHint();
captureCurrentPage();
