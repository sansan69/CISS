import { describe, expect, it } from "vitest";
import { filterActiveGuardsForDistricts } from "./available-guards";
import type { Employee } from "@/types/employee";

const guard = (overrides: Partial<Employee>): Employee =>
  ({
    id: "guard",
    employeeId: "G-1",
    clientName: "CISS",
    firstName: "Guard",
    lastName: "One",
    fullName: "Guard One",
    dateOfBirth: "",
    gender: "Male",
    fatherName: "",
    motherName: "",
    maritalStatus: "Unmarried",
    district: "Ernakulam",
    fullAddress: "",
    phoneNumber: "",
    joiningDate: "",
    status: "Active",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  }) as Employee;

describe("filterActiveGuardsForDistricts", () => {
  it("keeps guard lookup district scoped while accepting Trivandrum aliases", () => {
    const guards = [
      guard({ id: "tvm", district: "Trivandrum District", fullName: "A Guard" }),
      guard({ id: "kochi", district: "Ernakulam", fullName: "B Guard" }),
      guard({ id: "inactive", district: "Thiruvananthapuram", status: "Inactive" }),
    ];

    expect(
      filterActiveGuardsForDistricts(guards, ["Thiruvananthapuram"]).map((g) => g.id),
    ).toEqual(["tvm"]);
  });

  it("keeps legacy employees visible when district is stored under districtName", () => {
    const guards = [
      { ...guard({ id: "legacy", district: "" }), districtName: "Cochin" },
      guard({ id: "other", district: "Kollam" }),
    ] as Array<Employee & { districtName?: string }>;

    expect(
      filterActiveGuardsForDistricts(guards, ["Ernakulam"]).map((g) => g.id),
    ).toEqual(["legacy"]);
  });
});
