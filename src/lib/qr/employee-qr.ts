const EMPLOYEE_ID_LABEL_RE = /Employee\s*ID\s*:\s*([^\n\r]+)/i;
const CISS_ID_RE = /CISS\/[^\s\r\n]+/i;

function normalizeQrText(text: string): string {
  return text.replace(/\u0000/g, "").trim();
}

export function parseEmployeeIdFromQrText(text: string): string | null {
  const normalized = normalizeQrText(text);
  if (!normalized) return null;

  const labeledMatch = normalized.match(EMPLOYEE_ID_LABEL_RE);
  if (labeledMatch?.[1]) return labeledMatch[1].trim();

  const cissMatch = normalized.match(CISS_ID_RE);
  if (cissMatch?.[0]) return cissMatch[0].trim();

  const firstLine = normalized.split(/\r?\n/)[0]?.trim();
  if (firstLine && /^CISS\//i.test(firstLine)) return firstLine;

  return null;
}
