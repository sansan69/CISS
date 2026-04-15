import { randomInt } from "crypto";

export function abbreviateClientName(clientName: string): string {
  if (!clientName) return "CLIENT";

  const upperCaseName = clientName.trim().toUpperCase();
  const abbreviations: Record<string, string> = {
    "TATA CONSULTANCY SERVICES": "TCS",
    WIPRO: "WIPRO",
  };

  if (abbreviations[upperCaseName]) {
    return abbreviations[upperCaseName];
  }

  const words = upperCaseName.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) {
    return words.map((word) => word[0]).join("");
  }

  return upperCaseName.length <= 4 ? upperCaseName : upperCaseName.slice(0, 4);
}

export function getCurrentFinancialYear(referenceDate = new Date()): string {
  const currentMonth = referenceDate.getMonth() + 1;
  const currentYear = referenceDate.getFullYear();

  return currentMonth >= 4
    ? `${currentYear}-${(currentYear + 1).toString().slice(-2)}`
    : `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
}

export function generateEmployeeId(clientName: string, sequenceNumber?: number): string {
  const shortClientName = abbreviateClientName(clientName);
  const financialYear = getCurrentFinancialYear();
  const baseNumber = sequenceNumber ?? randomInt(1, 1000);

  return `CISS/${shortClientName}/${financialYear}/${baseNumber
    .toString()
    .padStart(3, "0")}`;
}
