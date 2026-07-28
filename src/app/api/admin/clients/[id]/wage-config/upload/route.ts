import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import {
  analyzeTemplateFields,
  detectHeaderRow,
  inferSheetFamily,
} from "@/lib/payroll/wage-template-parser";
import readXlsxFile from "read-excel-file/node";
export const runtime = "nodejs";

const MAX_WAGE_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_WAGE_SHEETS = 20;
const MAX_WAGE_ROWS = 5_000;
const MAX_WAGE_COLUMNS = 100;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    await params;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json(
        { error: "Use an .xlsx wage workbook. Legacy .xls files must be saved as .xlsx first." },
        { status: 400 },
      );
    }
    if (file.size <= 0 || file.size > MAX_WAGE_WORKBOOK_BYTES) {
      return NextResponse.json(
        { error: `Wage workbook must be no larger than ${MAX_WAGE_WORKBOOK_BYTES / 1024 / 1024}MB.` },
        { status: 400 },
      );
    }

    const sheetIndexParam = formData.get("sheetIndex");
    const requestedSheetIndex = sheetIndexParam !== null ? parseInt(String(sheetIndexParam), 10) : 0;

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return NextResponse.json({ error: "The file is not a valid .xlsx workbook." }, { status: 400 });
    }
    const workbook = await readXlsxFile(buffer);
    const sheetNames = workbook.map((sheet) => sheet.sheet);
    if (!sheetNames.length) {
      return NextResponse.json({ error: "No sheets found in file." }, { status: 400 });
    }
    if (sheetNames.length > MAX_WAGE_SHEETS) {
      return NextResponse.json(
        { error: `Wage workbook cannot contain more than ${MAX_WAGE_SHEETS} sheets.` },
        { status: 400 },
      );
    }

    const sheetIndex = Math.min(requestedSheetIndex, sheetNames.length - 1);
    const selectedSheet = sheetNames[sheetIndex];
    const matrix = (workbook[sheetIndex]?.data ?? []).map((row) =>
      (row as unknown[]).map((cell) => cell ?? ""),
    );
    if (
      matrix.length > MAX_WAGE_ROWS ||
      matrix.some((row) => row.length > MAX_WAGE_COLUMNS)
    ) {
      return NextResponse.json(
        { error: `Selected sheet exceeds ${MAX_WAGE_ROWS.toLocaleString()} rows or ${MAX_WAGE_COLUMNS} columns.` },
        { status: 400 },
      );
    }

    if (!matrix.length || !matrix.some((row) => row.some((cell) => String(cell ?? "").trim()))) {
      return NextResponse.json({ error: "Selected sheet appears to be empty." }, { status: 400 });
    }

    const headerRowIndex = detectHeaderRow(matrix);
    const headers = (matrix[headerRowIndex] ?? []).map((cell, index) => {
      const value = String(cell ?? "").trim();
      return value || `Column ${index + 1}`;
    });
    const rows = matrix
      .slice(headerRowIndex + 1, headerRowIndex + 201)
      .filter((row) => row.some((cell) => String(cell ?? "").trim()))
      .map((row) => headers.map((_, index) => String(row[index] ?? "").trim()));

    const templateFields = analyzeTemplateFields(matrix, headerRowIndex);
    const detectedSheetFamily = inferSheetFamily(matrix, headerRowIndex);

    return NextResponse.json({
      sheetNames,
      selectedSheet,
      sheetIndex,
      headerRowIndex,
      headers,
      rows,
      totalRows: rows.length,
      detectedSheetFamily,
      parserSummary: {
        detectedFields: templateFields.length,
        attendanceFields: templateFields.filter((field) => field.category === "attendance").length,
        earningFields: templateFields.filter((field) => field.category === "earning").length,
        deductionFields: templateFields.filter((field) => field.category === "deduction").length,
      },
      templateFields,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error reading file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
