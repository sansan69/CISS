import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("defines the composite index required by guard attendance range queries", () => {
  const { indexes } = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));

  expect(
    indexes.some(
      (index: {
        collectionGroup: string;
        queryScope: string;
        fields: Array<{ fieldPath: string; order?: string }>;
      }) =>
        index.collectionGroup === "attendanceLogs" &&
        index.queryScope === "COLLECTION" &&
        JSON.stringify(index.fields) ===
          JSON.stringify([
            { fieldPath: "district", order: "ASCENDING" },
            { fieldPath: "attendanceDate", order: "ASCENDING" },
            { fieldPath: "__name__", order: "ASCENDING" },
          ]),
    ),
  ).toBe(true);
});
