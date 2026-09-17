const encoder = new TextEncoder();

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
    if (encoder.encode(current + character).length > 75) {
      chunks.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

function compactDate(date) {
  return date.replaceAll("-", "");
}

function compactTime(time) {
  return `${time.replace(":", "")}00`;
}

function utcStamp(now) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createIcs(sessions, calendarName, now = new Date()) {
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
  const stamp = utcStamp(now);

  for (const session of sessions) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${session.uid}`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${escapeIcsText(session.title)}`,
      `DTSTART;TZID=Asia/Shanghai:${compactDate(session.date)}T${compactTime(session.startTime)}`,
      `DTEND;TZID=Asia/Shanghai:${compactDate(session.date)}T${compactTime(session.endTime)}`,
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

export function createGoogleCsv(sessions) {
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

export function createJsonExport(schedule, sessions, settings) {
  return `${JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    calendarName: settings.calendarName,
    semesterText: schedule.semesterText,
    weekOneMonday: settings.weekOneMonday,
    source: schedule.source,
    blocks: schedule.blocks,
    sessions,
    unscheduled: schedule.unscheduled,
    warnings: schedule.warnings,
  }, null, 2)}\n`;
}

export function safeFilename(value) {
  return String(value || "calendar")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "calendar";
}
