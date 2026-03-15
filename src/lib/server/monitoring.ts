export const SYSTEM_METRIC_NAMES = {
  attendanceSubmitFailure: "attendance_submit_failure",
  attendanceSubmitSuccess: "attendance_submit_success",
  geocodeFailure: "geocode_failure",
  geocodeSuccess: "geocode_success",
  adminProvisionFailure: "admin_provision_failure",
  adminProvisionSuccess: "admin_provision_success",
} as const;

export type SystemMetricName =
  (typeof SYSTEM_METRIC_NAMES)[keyof typeof SYSTEM_METRIC_NAMES];

const INDIA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

export async function incrementSystemMetric(
  metric: SystemMetricName,
  amount = 1,
) {
  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const dateKey = INDIA_DATE_FORMATTER.format(new Date());

    await adminDb
      .collection("systemMetrics")
      .doc(dateKey)
      .set(
        {
          dateKey,
          updatedAt: new Date(),
          [`counters.${metric}`]: FieldValue.increment(amount),
        },
        { merge: true },
      );
  } catch (error) {
    console.error("Could not record system metric:", metric, error);
  }
}
