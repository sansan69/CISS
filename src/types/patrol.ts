import { z } from "zod";

export const patrolPointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  active: z.boolean().default(true),
  requiresPhoto: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
});

export const patrolSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  hourlyNightPhotoEnabled: z.boolean().default(false),
  hourlyIntervalMinutes: z.number().int().min(30).max(180).default(60),
  nightWindowStart: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
  nightWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).default("06:00"),
  photoRequiredForPatrol: z.boolean().default(true),
});

export const patrolActivityTypeSchema = z.enum(["patrol", "hourly_photo"]);

export type PatrolPoint = z.infer<typeof patrolPointSchema>;
export type PatrolSettings = z.infer<typeof patrolSettingsSchema>;
export type PatrolActivityType = z.infer<typeof patrolActivityTypeSchema>;

export type GuardPatrolActivityRow = {
  id: string;
  type: PatrolActivityType;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  district: string;
  guardName: string;
  employeeId: string;
  employeeDocId: string;
  dutyPointId?: string;
  dutyPointName?: string;
  shiftCode?: string;
  shiftLabel?: string;
  patrolPointId?: string;
  patrolPointName?: string;
  patrolPointDescription?: string;
  photoUrl?: string | null;
  notes?: string;
  source: string;
  activityAt: string | null;
  activityDate: string;
  createdAt: string | null;
};

export type GuardPatrolStatusPayload = {
  enabled: boolean;
  settings: PatrolSettings;
  guardName: string;
  employeeId: string;
  clientId: string;
  clientName: string;
  activeDuty: {
    siteId: string;
    siteName: string;
    district: string;
    dutyPointId?: string;
    dutyPointName?: string;
    shiftCode?: string;
    shiftLabel?: string;
    checkedInAt: string | null;
    activeSinceLabel: string | null;
  } | null;
  patrolPoints: PatrolPoint[];
  hourlyRequirement: {
    enabled: boolean;
    dueNow: boolean;
    nextDueAt: string | null;
    overdueMinutes: number;
    lastSubmittedAt: string | null;
    nightWindowLabel: string;
  };
  recentActivities: GuardPatrolActivityRow[];
};

export type PatrolActivityListPayload = {
  summary: {
    total: number;
    hourlyPhotos: number;
    patrolRounds: number;
    activeSites: number;
    uniqueGuards: number;
  };
  settings?: PatrolSettings | null;
  activities: GuardPatrolActivityRow[];
};
