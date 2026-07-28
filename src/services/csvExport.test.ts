import { describe, it, expect, vi, afterEach } from "vitest";
import type { Project, Task, TimeEntry } from "../types";
import {
  applyRounding,
  buildExportFilename,
  escapeCSV,
  exportToCSV,
  type RoundingRule,
} from "./csvExport";

describe("applyRounding", () => {
  it("passes exact minutes through unchanged", () => {
    expect(applyRounding(0, "exact")).toBe(0);
    expect(applyRounding(1, "exact")).toBe(1);
    expect(applyRounding(47, "exact")).toBe(47);
  });

  it("rounds up to the increment — any started increment bills whole", () => {
    expect(applyRounding(1, "up6")).toBe(6);
    expect(applyRounding(6, "up6")).toBe(6);
    expect(applyRounding(7, "up6")).toBe(12);
    expect(applyRounding(1, "up15")).toBe(15);
    expect(applyRounding(15, "up15")).toBe(15);
    expect(applyRounding(16, "up15")).toBe(30);
    expect(applyRounding(31, "up30")).toBe(60);
  });

  it("rounds to the nearest 15", () => {
    expect(applyRounding(7, "nearest15")).toBe(0);
    expect(applyRounding(8, "nearest15")).toBe(15);
    expect(applyRounding(22, "nearest15")).toBe(15);
    expect(applyRounding(23, "nearest15")).toBe(30);
  });

  it("never produces negative output and leaves zero at zero for every rule", () => {
    const rules: RoundingRule[] = ["exact", "up6", "up15", "up30", "nearest15"];
    for (const rule of rules) {
      expect(applyRounding(0, rule)).toBe(0);
      expect(applyRounding(-5, rule)).toBe(0);
    }
  });
});

describe("escapeCSV formula-injection guard", () => {
  it("prefixes every cell that Excel would evaluate as a formula", () => {
    // The classic payloads: each of these runs on open without the quote.
    expect(escapeCSV("=1+1")).toBe("'=1+1");
    // No comma/quote/newline in this one, so it needs the guard quote but no
    // field quoting.
    expect(escapeCSV("=cmd|' /c calc'!A1")).toBe(`'=cmd|' /c calc'!A1`);
    expect(escapeCSV('=HYPERLINK("http://evil","click")')).toBe(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(escapeCSV("+1+1")).toBe("'+1+1");
    expect(escapeCSV("-1+1")).toBe("'-1+1");
    expect(escapeCSV("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCSV("\tleading tab")).toBe("'\tleading tab");
    expect(escapeCSV("\rleading cr")).toBe(`"'\rleading cr"`);
  });

  it("only neutralizes the leading character, leaving ordinary text alone", () => {
    expect(escapeCSV("Fixed bug =3 in parser")).toBe("Fixed bug =3 in parser");
    expect(escapeCSV("Sprint planning")).toBe("Sprint planning");
    expect(escapeCSV(42)).toBe("42");
    expect(escapeCSV(0)).toBe("0");
  });

  it("returns an empty cell for null/undefined rather than the string 'null'", () => {
    expect(escapeCSV(null)).toBe("");
    expect(escapeCSV(undefined)).toBe("");
    expect(escapeCSV("")).toBe("");
  });

  it("quotes and doubles embedded quotes, commas and newlines", () => {
    expect(escapeCSV('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCSV("a,b")).toBe('"a,b"');
    expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
    // A bare CR is a row break to Excel too — it must be quoted, not passed
    // through raw (which used to shift every column after it).
    expect(escapeCSV("line1\rline2")).toBe('"line1\rline2"');
    expect(escapeCSV("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("exportToCSV", () => {
  const project: Project = { id: "p1", name: "Acme, Inc", color: "#719500", isActive: true, createdAt: "" };
  const task: Task = { id: "t1", projectId: "p1", name: "Zoë's review", isActive: true };
  const entry: TimeEntry = {
    id: "e1", projectId: "p1", taskId: "t1", description: "=IMPORTXML(1,2)",
    startTime: "2026-03-02T09:00:00.000Z", endTime: "2026-03-02T10:00:00.000Z",
    durationMinutes: 47, date: "2026-03-02", ratio: 2,
    userId: "u1", userDisplayName: "Zoë Ǆurić",
  };

  /** Capture what would have been downloaded — jsdom has no
   *  URL.createObjectURL, and the blob is the actual deliverable. Read as
   *  bytes and decoded with ignoreBOM, because the byte-order mark is one of
   *  the things under test and a plain text decode would swallow it. */
  async function capture(entries: TimeEntry[], rounding?: RoundingRule): Promise<string> {
    let captured: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => { captured = blob; return "blob:mock"; });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    // The download is triggered by clicking a temporary <a>; jsdom has no
    // navigation, and letting it try just fills the run with stack traces.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportToCSV(entries, [project], [task], "out.csv", rounding);
    if (!captured) return "";
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(captured!);
    });
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts the file with a UTF-8 BOM so Excel doesn't mojibake non-ASCII names", async () => {
    const csv = await capture([entry]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Zoë Ǆurić");
  });

  it("escapes every cell it writes, including the injection payload and the comma in a project name", async () => {
    const csv = await capture([entry]);
    const [header, row] = csv.replace("﻿", "").split("\n");
    expect(header.startsWith("Date,Start Time,End Time")).toBe(true);
    expect(row).toContain("'=IMPORTXML(1,2)");
    expect(row).toContain('"Acme, Inc"');
  });

  it("applies the chosen rounding to the duration columns only", async () => {
    const exact = (await capture([entry], "exact")).split("\n")[1];
    const rounded = (await capture([entry], "up15")).split("\n")[1];
    expect(exact).toContain(",47,0.78,");
    expect(rounded).toContain(",60,1.00,");
  });

  it("skips entries that are still running", async () => {
    const running: TimeEntry = { ...entry, id: "e2", endTime: undefined, durationMinutes: undefined };
    const csv = await capture([running]);
    expect(csv.replace("﻿", "").trim().split("\n")).toHaveLength(1); // header only
  });
});

describe("buildExportFilename", () => {
  it("names the file after the exported range", () => {
    expect(buildExportFilename("2026-03-01", "2026-03-31")).toBe("timeflow-2026-03-01-to-2026-03-31.csv");
  });

  it("falls back to today when the range is open-ended", () => {
    expect(buildExportFilename()).toMatch(/^timeflow-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(buildExportFilename("2026-03-01")).toMatch(/^timeflow-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
