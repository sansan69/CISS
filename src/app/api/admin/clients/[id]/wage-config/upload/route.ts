import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import {
  analyzeTemplateFields,
  detectHeaderRow,
  inferSheetFamily,
} from "@/lib/payroll/wage-template-parser";

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

    const sheetIndexParam = formData.get("sheetIndex");
    const requestedSheetIndex = sheetIndexParam !== null ? parseInt(String(sheetIndexParam), 10) : 0;

    const buffer = Buffer.from(await file.arrayBuffer());
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames: string[] = workbook.SheetNames;
    if (!sheetNames.length) {
      return NextResponse.json({ error: "No sheets found in file." }, { status: 400 });
    }

    const sheetIndex = Math.min(requestedSheetIndex, sheetNames.length - 1);
    const selectedSheet = sheetNames[sheetIndex];
    const worksheet = workbook.Sheets[selectedSheet];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" }) as unknown[][];

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
