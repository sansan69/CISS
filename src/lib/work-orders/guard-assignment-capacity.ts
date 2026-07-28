type GuardGenderLike = {
  gender?: unknown;
};

export type GuardAssignmentCounts = {
  male: number;
  female: number;
};

export type GuardAssignmentCapacityIssue = {
  title: string;
  description: string;
};

function normalizeGender(value: unknown): "male" | "female" | "" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "male") return "male";
  if (normalized === "female") return "female";
  return "";
}

function normalizeRequirement(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function countGuardAssignments(
  guards: GuardGenderLike[],
): GuardAssignmentCounts {
  return guards.reduce<GuardAssignmentCounts>(
    (counts, guard) => {
      const gender = normalizeGender(guard.gender);
      if (gender === "male") counts.male += 1;
      if (gender === "female") counts.female += 1;
      return counts;
    },
    { male: 0, female: 0 },
  );
}

export function getGuardAssignmentCapacityIssue(
  selectedGuards: GuardGenderLike[],
  candidateGender: unknown,
  requirements: {
    maleGuardsRequired?: unknown;
    femaleGuardsRequired?: unknown;
  },
): GuardAssignmentCapacityIssue | null {
  const gender = normalizeGender(candidateGender);
  if (!gender) {
    return {
      title: "Gender information required",
      description:
        "Update this guard’s profile before assigning them to a male or female requirement.",
    };
  }

  const counts = countGuardAssignments(selectedGuards);
  const required =
    gender === "male"
      ? normalizeRequirement(requirements.maleGuardsRequired)
      : normalizeRequirement(requirements.femaleGuardsRequired);
  const assigned = gender === "male" ? counts.male : counts.female;

  if (assigned >= required) {
    const label = gender === "male" ? "Male" : "Female";
    return {
      title: `${label} requirement already filled`,
      description: `This work order requires ${required} ${gender} guard${required === 1 ? "" : "s"}. Remove an assigned guard before adding another.`,
    };
  }

  return null;
}
