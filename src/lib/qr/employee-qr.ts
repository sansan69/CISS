const EMPLOYEE_ID_LABEL_RE = /Employee\s*ID\s*:\s*([^\n\r]+)/i;
const PHONE_LABEL_RE = /Phone\s*:\s*([^\n\r]+)/i;
const CISS_ID_RE = /CISS\/[^\s\r\n]+/i;

function normalizeQrText(text: string): string {
  return text.replace(/\u0000/g, "").trim();
}

export function parseEmployeeQrText(text: string): {
  employeeId: string | null;
  phoneNumber: string | null;
} {
  const normalized = normalizeQrText(text);
  if (!normalized) {
    return { employeeId: null, phoneNumber: null };
  }

  const labeledMatch = normalized.match(EMPLOYEE_ID_LABEL_RE);
  const cissMatch = normalized.match(CISS_ID_RE);
  const employeeId = labeledMatch?.[1]?.trim() ?? cissMatch?.[0]?.trim() ?? null;

  const phoneMatch = normalized.match(PHONE_LABEL_RE);
  const phoneDigits = phoneMatch?.[1]?.replace(/\D/g, "").trim() ?? "";
  const normalizedPhone =
    phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;

  const firstLine = normalized.split(/\r?\n/)[0]?.trim();
  const fallbackEmployeeId = firstLine && /^CISS\//i.test(firstLine) ? firstLine : null;

  return {
    employeeId: employeeId ?? fallbackEmployeeId,
    phoneNumber: /^\d{10}$/.test(normalizedPhone) ? normalizedPhone : null,
  };
}

export function parseEmployeeIdFromQrText(text: string): string | null {
  return parseEmployeeQrText(text).employeeId;
}
