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
  _selectedGuards: GuardGenderLike[],
  candidateGender: unknown,
  _requirements: {
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

  return null;
}
