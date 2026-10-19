import { describe, expect, it } from "vitest";
import {
  buildClaimRepairPlan,
  buildClaimRepairPlanFromProfiles,
  buildClaimRepairPlanFromIndexes,
  indexClaimRepairProfilesByUid,
} from "./claims-repair";

describe("claims repair planning", () => {
  it("marks repeated same-type UID links ambiguous instead of choosing one", () => {
    const indexed = indexClaimRepairProfilesByUid([
      { uid: "fo-1", stateCode: "KL", assignedDistricts: ["Kollam"] },
      { uid: "fo-1", stateCode: "TN", assignedDistricts: ["Chennai"] },
    ]);
    expect(indexed.get("fo-1")).toBeNull();
    expect(buildClaimRepairPlanFromProfiles({
      uid: "fo-1",
      fieldOfficerProfile: indexed.get("fo-1") ?? undefined,
      claims: {},
    })).toBeNull();
  });
  it.each([
    { order: "field officer then client", profiles: [
      { uid: "shared-1", stateCode: "KL", assignedDistricts: ["Kollam"] },
      { uid: "shared-1", stateCode: "KL", clientId: "client-1" },
      { uid: "shared-1", stateCode: "TN", assignedDistricts: ["Chennai"] },
    ] },
    { order: "client then field officer", profiles: [
      { uid: "shared-1", stateCode: "KL", clientId: "client-1" },
      { uid: "shared-1", stateCode: "KL", assignedDistricts: ["Kollam"] },
      { uid: "shared-1", stateCode: "TN", clientId: "client-2" },
    ] },
  ])("rejects cross-type repair when duplicate links are $order", ({ profiles }) => {
    const fieldOfficersByUid = indexClaimRepairProfilesByUid(
      profiles.filter((profile) => "assignedDistricts" in profile),
    );
    const clientUsersByUid = indexClaimRepairProfilesByUid(
      profiles.filter((profile) => "clientId" in profile),
    );
    expect(buildClaimRepairPlanFromIndexes({
      uid: "shared-1",
      fieldOfficersByUid,
      clientUsersByUid,
      claims: {},
    })).toBeNull();
  });
  it("offers a field officer whose district scope drifted despite the correct role", () => {
    expect(buildClaimRepairPlan({
      uid: "fo-1",
      source: "fieldOfficers",
      profile: { stateCode: "KL", assignedDistricts: ["Ernakulam", "Kollam"] },
      claims: { role: "fieldOfficer", stateCode: "KL", assignedDistricts: ["Ernakulam"] },
    })).toMatchObject({
      expectedRole: "fieldOfficer",
      currentRole: "fieldOfficer",
      claimPatch: { stateCode: "KL", assignedDistricts: ["Ernakulam", "Kollam"] },
    });
  });

  it("does not offer a profile whose role and scope already match", () => {
    expect(buildClaimRepairPlan({
      uid: "fo-1",
      source: "fieldOfficers",
      profile: { stateCode: "KL", assignedDistricts: ["Kollam"] },
      claims: { role: "fieldOfficer", stateCode: "KL", assignedDistricts: ["Kollam"] },
    })).toBeNull();
  });

  it.each([{ role: "admin" }, { role: "superAdmin" }, { admin: true, role: "fieldOfficer" }])(
    "never offers repair for privileged claims %s",
    (claims) => {
      expect(buildClaimRepairPlan({
        uid: "privileged-1",
        source: "fieldOfficers",
        profile: { stateCode: "KL", assignedDistricts: ["Kollam"] },
        claims,
      })).toBeNull();
    },
  );

  it("offers a client whose linked client scope drifted", () => {
    expect(buildClaimRepairPlan({
      uid: "client-1",
      source: "clientUsersByUid",
      profile: { stateCode: "KL", clientId: "client-new", clientName: "New Client" },
      claims: { role: "client", stateCode: "KL", clientId: "client-old", clientName: "Old Client" },
    })).toMatchObject({
      expectedRole: "client",
      currentRole: "client",
      claimPatch: { stateCode: "KL", clientId: "client-new", clientName: "New Client" },
    });
  });

  it("does not choose between a UID linked to both profile types", () => {
    expect(buildClaimRepairPlanFromProfiles({
      uid: "dual-1",
      fieldOfficerProfile: { stateCode: "KL", assignedDistricts: ["Kollam"] },
      clientProfile: { stateCode: "KL", clientId: "client-1" },
      claims: { role: "fieldOfficer", stateCode: "KL", assignedDistricts: ["Kollam"] },
    })).toBeNull();
  });

  it.each([
    { status: "inactive" },
    { status: "disabled" },
    { status: "terminated" },
    { active: false },
    { deprovisioned: true },
  ])("does not grant an active role to an inactive linked profile %s", (profileState) => {
    expect(buildClaimRepairPlan({
      uid: "fo-1",
      source: "fieldOfficers",
      profile: { ...profileState, stateCode: "KL", assignedDistricts: ["Kollam"] },
      claims: {},
    })).toBeNull();
  });
});
