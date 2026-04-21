import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/firebase", () => ({
  db: {},
  auth: {},
  storage: {},
  isFirebaseConfigured: false,
  ensureAuthPersistence: vi.fn(),
}));

import { OPERATIONAL_CLIENT_NAME } from "../lib/constants";
import {
  buildTcsWorkOrderImportsQuery,
  normalizeTcsWorkOrderImportRecords,
} from "./(app)/work-orders/imports/work-order-imports";
import { bottomNavItems, getVisibleGroups, mainNavGroups } from "./(app)/navigation";

describe("work orders surface behavior", () => {
  it("builds a TCS-only imports query instead of fetching a broad page", () => {
    const collectionCalls: unknown[][] = [];
    const whereCalls: unknown[][] = [];
    const orderByCalls: unknown[][] = [];
    const limitCalls: unknown[][] = [];
    const queryCalls: unknown[][] = [];

    const queryRef = buildTcsWorkOrderImportsQuery({
      db: { marker: "fake-db" } as never,
      collectionFn: ((...args: unknown[]) => {
        collectionCalls.push(args);
        return "collection-ref" as never;
      }) as any,
      whereFn: ((...args: unknown[]) => {
        whereCalls.push(args);
        return "where-ref" as never;
      }) as any,
      orderByFn: ((...args: unknown[]) => {
        orderByCalls.push(args);
        return "order-by-ref" as never;
      }) as any,
      limitFn: ((...args: unknown[]) => {
        limitCalls.push(args);
        return "limit-ref" as never;
      }) as any,
      queryFn: ((...args: unknown[]) => {
        queryCalls.push(args);
        return "query-ref" as never;
      }) as any,
    });

    expect(queryRef).toBe("query-ref");
    expect(collectionCalls).toEqual([[{ marker: "fake-db" }, "workOrderImports"]]);
    expect(whereCalls).toEqual([["clientName", "==", OPERATIONAL_CLIENT_NAME]]);
    expect(orderByCalls).toEqual([["createdAt", "desc"]]);
    expect(limitCalls).toEqual([[25]]);
    expect(queryCalls).toEqual([["collection-ref", "where-ref", "order-by-ref", "limit-ref"]]);
  });

  it("keeps only TCS import records from a mixed snapshot", () => {
    const records = normalizeTcsWorkOrderImportRecords({
      docs: [
        {
          id: "tcs-1",
          data: () => ({
            clientName: "TCS",
            examName: "TCS Exam",
            fileName: "tcs.xlsx",
          }),
        },
        {
          id: "other-1",
          data: () => ({
            clientName: "Other Client",
            examName: "Other Exam",
            fileName: "other.xlsx",
          }),
        },
      ],
    } as any);

    expect(records).toEqual([
      {
        id: "tcs-1",
        clientName: "TCS",
        examName: "TCS Exam",
        fileName: "tcs.xlsx",
      },
    ]);
  });

  it("uses the shared nav config for desktop and mobile visibility", () => {
    const workforceGroup = mainNavGroups.find((group) => group.label === "Workforce");

    expect(workforceGroup?.items.map((item) => item.label)).toContain("Work Order Imports");
    expect(getVisibleGroups(mainNavGroups, "admin", false).flatMap((group) => group.items.map((item) => item.label))).toContain("Work Order Imports");
    expect(getVisibleGroups(mainNavGroups, "fieldOfficer", false).flatMap((group) => group.items.map((item) => item.label))).not.toContain("Work Order Imports");
    expect(bottomNavItems.map((item) => item.label)).toEqual(["Home", "Guards", "Attendance", "Orders"]);
  });
});
