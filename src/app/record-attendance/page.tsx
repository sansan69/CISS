import { redirect } from "next/navigation";

/**
 * Legacy attendance entry point.
 *
 * Keep one canonical attendance implementation so identification, location,
 * photo, shift, and session rules cannot drift between two public flows.
 */
export default function RecordAttendanceRedirect() {
  redirect("/attendance");
}
