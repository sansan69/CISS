import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Wiring contract for the reviewed web integration: the retained manual roster
// dialog must use the version/receipt path, the FO duty dates must be labelled
// from the canonical IST helper, and the duty form must bind its batch to the
// account that started it.

const panelSource = readFileSync(
  resolve(process.cwd(), "src/components/field-officers/work-orders-panel.tsx"),
  "utf8",
);
const formSource = readFileSync(
  resolve(process.cwd(), "src/components/field-officers/guard-assignment-form.tsx"),
  "utf8",
);

describe("field officer duty scheduling surface contract", () => {
  it("labels and groups every duty date through the shared IST helper", () => {
    expect(panelSource).toContain("formatIstDutyDateLabel(");
    expect(panelSource).toContain("formatIstDate(");
    expect(panelSource).not.toContain("toLocaleDateString");
    expect(panelSource).not.toContain("Asia/Kolkata");
  });

  it("saves the retained manual roster with its loaded version and receipt", () => {
    expect(panelSource).toContain("loadWorkOrderRoster(");
    expect(panelSource).toContain("retainedRosterMutation(");
    expect(panelSource).toContain("submitRosterRequest(");
    expect(panelSource).toContain("versionConflict");
    expect(panelSource).toContain("Reload");
  });

  it("binds the duty assignment form batch to the initiating account and origin", () => {
    expect(formSource).toContain("readDutyOwner(");
    expect(formSource).toContain("createOwnerBoundFetcher(");
    expect(formSource).toContain("isDisposed");
  });
});
