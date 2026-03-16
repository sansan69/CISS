import { z } from "zod";

export const coordinateStatusSchema = z.enum([
  "missing",
  "geocoded",
  "verified",
  "overridden",
]);

export const coordinateSourceSchema = z.enum([
  "manual",
  "geocode",
  "map_pin",
  "current_location",
]);

export const siteTypeSchema = z.enum(["main", "branch", "site"]);

export const siteShiftModeSchema = z.enum(["none", "fixed"]);
export const siteShiftPatternSchema = z.enum(["2x12", "3x8"]);

export const shiftTemplateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  hours: z.number().positive(),
  crossesMidnight: z.boolean().default(false),
});

export const geoPointLikeSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const clientLocationSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().optional(),
  clientName: z.string().min(1),
  locationName: z.string().min(1),
  address: z.string().min(1),
  district: z.string().min(1),
  geolocation: geoPointLikeSchema.optional(),
  coordinateStatus: coordinateStatusSchema.default("missing"),
  coordinateSource: coordinateSourceSchema.optional(),
  placeAccuracy: z.string().nullable().optional(),
  geofenceRadiusMeters: z.number().optional(),
  strictGeofence: z.boolean().optional(),
  siteType: siteTypeSchema.optional(),
  placeId: z.string().nullable().optional(),
  geocodedAt: z.any().optional(),
  createdAt: z.any().optional(),
  updatedAt: z.any().optional(),
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
});

export type CoordinateStatus = z.infer<typeof coordinateStatusSchema>;
export type CoordinateSource = z.infer<typeof coordinateSourceSchema>;
export type SiteType = z.infer<typeof siteTypeSchema>;
export type SiteShiftMode = z.infer<typeof siteShiftModeSchema>;
export type SiteShiftPattern = z.infer<typeof siteShiftPatternSchema>;
export type ShiftTemplate = z.infer<typeof shiftTemplateSchema>;
export type GeoPointLike = z.infer<typeof geoPointLikeSchema>;
export type ClientLocation = z.infer<typeof clientLocationSchema>;

export type ManagedSite = {
  id: string;
  clientId?: string | null;
  clientName: string;
  siteName: string;
  siteId?: string | null;
  siteAddress: string;
  district: string;
  geolocation?: GeoPointLike;
  geofenceRadiusMeters?: number;
  strictGeofence?: boolean;
  clientLocationId?: string | null;
  clientLocationName?: string | null;
  coordinateStatus?: CoordinateStatus;
  coordinateSource?: CoordinateSource;
  placeAccuracy?: string | null;
  placeId?: string | null;
  siteType?: SiteType;
  geocodedAt?: unknown;
  shiftMode?: SiteShiftMode;
  shiftPattern?: SiteShiftPattern | null;
  shiftTemplates?: ShiftTemplate[];
  latString?: string;
  lngString?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};
