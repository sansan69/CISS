export type ClientDashboardLiveAttendanceRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  status: "In" | "Out";
  siteId: string;
  siteName: string;
  dutyPointName?: string;
  shiftLabel?: string;
  reportedAt: string | null;
};

export type ClientDashboardShiftSnapshot = {
  code: string;
  label: string;
  checkedInToday: number;
  onDutyNow: number;
};

export type ClientDashboardDutyPointSnapshot = {
  id: string;
  name: string;
  checkedInToday: number;
  onDutyNow: number;
  activeShiftLabel?: string | null;
  shifts?: ClientDashboardShiftSnapshot[];
};

export type ClientDashboardSiteSnapshot = {
  siteId: string;
  siteName: string;
  district: string;
  checkedInToday: number;
  onDutyNow: number;
  upcomingDuties: number;
  nextDutyDate: string | null;
  dutyPoints?: ClientDashboardDutyPointSnapshot[];
};

export type ClientDashboardWorkOrderRow = {
  id: string;
  siteId: string;
  siteName: string;
  district: string;
  examName: string;
  date: string | null;
  totalManpower: number;
  assignedCount: number;
};

export type ClientDashboardVisitReportRow = {
  id: string;
  fieldOfficerName: string;
  siteName: string;
  district: string;
  visitDate: string | null;
  createdAt: string | null;
  status: string;
  summary: string;
};

export type ClientDashboardTrainingReportRow = {
  id: string;
  fieldOfficerName: string;
  siteName: string;
  district: string;
  trainingDate: string | null;
  createdAt: string | null;
  status: string;
  topic: string;
  attendeeCount: number;
};

export type ClientDashboardGuardHighlight = {
  id: string;
  fullName: string;
  employeeId: string;
  district: string;
  status: string;
  profilePictureUrl: string | null;
};

export type ClientDashboardSummary = {
  clientId: string;
  clientName: string;
  totalGuards: number;
  activeGuards: number;
  inactiveGuards: number;
  checkedInToday: number;
  checkedOutToday: number;
  onDutyNow: number;
  sitesCovered: number;
  deploymentsToday: number;
  upcomingDuties: number;
  pendingVisitReports: number;
  pendingTrainingReports: number;
};

export type ClientDashboardPayload = {
  summary: ClientDashboardSummary;
  liveAttendance: ClientDashboardLiveAttendanceRow[];
  siteSnapshots: ClientDashboardSiteSnapshot[];
  upcomingWorkOrders: ClientDashboardWorkOrderRow[];
  recentVisitReports: ClientDashboardVisitReportRow[];
  recentTrainingReports: ClientDashboardTrainingReportRow[];
  guardHighlights: ClientDashboardGuardHighlight[];
  dashboardModules?: import("@/types/client-permissions").ClientDashboardModulesConfig;
};
