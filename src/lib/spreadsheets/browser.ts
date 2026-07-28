"use client";

import { parse } from "csv-parse/browser/esm/sync";
import readXlsxFile from "read-excel-file/browser";
import writeXlsxFile, {
  type Cell,
  type SheetData,
} from "write-excel-file/browser";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 100;

export type TabularRow = Array<string | number | boolean | Date | null>;

function assertSafeDimensions(rows: TabularRow[]) {
  if (rows.length > MAX_ROWS) {
    throw new Error(`The file has more than ${MAX_ROWS.toLocaleString()} rows.`);
  }
  if (rows.some((row) => row.length > MAX_COLUMNS)) {
    throw new Error(`The file has more than ${MAX_COLUMNS} columns.`);
  }
}

export async function readTabularFile(file: File): Promise<TabularRow[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("The file is larger than 8 MB.");
  }

  const extension = file.name.toLowerCase().split(".").pop();
  let rows: TabularRow[];

  if (extension === "csv") {
    rows = parse(await file.text(), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as TabularRow[];
  } else if (extension === "xlsx") {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
      throw new Error("The XLSX file is not a valid Excel workbook.");
    }
    rows = (await readXlsxFile(file)) as unknown as TabularRow[];
  } else {
    throw new Error("Please upload a CSV or XLSX file.");
  }

  assertSafeDimensions(rows);
  return rows;
}

export function rowsToRecords(rows: TabularRow[]) {
  const headers = (rows[0] || []).map((value) => String(value ?? "").trim());
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

export async function downloadXlsx(
  fileName: string,
  rows: TabularRow[],
  sheetName: string,
) {
  assertSafeDimensions(rows);
  const data: SheetData = rows.map((row) =>
    row.map((value): Cell => value ?? null),
  );
  await writeXlsxFile(data, { sheet: sheetName }).toFile(fileName);
}

export function downloadCsv(fileName: string, rows: TabularRow[]) {
  assertSafeDimensions(rows);
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const text =
            value instanceof Date ? value.toISOString() : String(value ?? "");
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
