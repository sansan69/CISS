/**
 * Per-client dashboard visibility configuration.
 * Stored on the client document as `dashboardModules`.
 * Admin controls which modules each client can see.
 */
export type ClientDashboardModule =
  | "summary"
  | "attendance"
  | "sites"
  | "workOrders"
  | "visitReports"
  | "trainingReports"
  | "guardHighlights";

export type ClientDashboardModulesConfig = Partial<Record<ClientDashboardModule, boolean>>;

/** Default: all modules visible */
export const DEFAULT_CLIENT_MODULES: Required<ClientDashboardModulesConfig> = {
  summary: true,
  attendance: true,
  sites: true,
  workOrders: true,
  visitReports: true,
  trainingReports: true,
  guardHighlights: true,
};

/** Human-readable labels for admin UI */
export const CLIENT_MODULE_LABELS: Record<ClientDashboardModule, string> = {
  summary: "Summary Banner & Stats",
  attendance: "Live Attendance Table",
  sites: "Top Sites Snapshot",
  workOrders: "Upcoming Work Orders",
  visitReports: "Visit Reports",
  trainingReports: "Training Reports",
  guardHighlights: "Guard Highlights",
};

/** Descriptions for admin UI */
export const CLIENT_MODULE_DESCRIPTIONS: Record<ClientDashboardModule, string> = {
  summary: "Client name, site count, active guards, and 4 stat cards",
  attendance: "Real-time check-in/check-out table with guard names and sites",
  sites: "Per-site on-duty counts, upcoming duties, GPS status",
  workOrders: "Upcoming exam/deployment duties with manpower counts",
  visitReports: "Field officer visit reports with review status",
  trainingReports: "Training session reports with attendee counts",
  guardHighlights: "Quick access to active guard profiles with photos",
};

export function resolveClientModules(
  config: ClientDashboardModulesConfig | undefined | null,
): Required<ClientDashboardModulesConfig> {
  if (!config) return { ...DEFAULT_CLIENT_MODULES };
  return { ...DEFAULT_CLIENT_MODULES, ...config };
}
