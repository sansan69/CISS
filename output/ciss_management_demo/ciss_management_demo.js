const path = require("path");
const PptxGenJS = require("pptxgenjs");
const {
  imageSizingContain,
  imageSizingCrop,
  safeOuterShadow,
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./pptxgenjs_helpers");

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "OpenAI Codex";
pptx.company = "CISS";
pptx.subject = "CISS Workforce management overview";
pptx.title = "CISS Workforce - Management Overview";
pptx.lang = "en-IN";
pptx.theme = {
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  lang: "en-IN",
};

const W = 13.333;
const H = 7.5;

const C = {
  blue: "014C85",
  blueDark: "013A6B",
  blueSoft: "EAF3FB",
  gold: "BD9C55",
  goldSoft: "F6EBD7",
  ink: "1F2937",
  text: "333333",
  muted: "667085",
  line: "E5E7EB",
  soft: "F7F8FA",
  white: "FFFFFF",
  green: "1F9D55",
  amber: "B7791F",
  red: "D14343",
};

const A = {
  logo: path.join(__dirname, "assets", "ciss-logo.png"),
  landing: path.join(__dirname, "assets", "01-landing.png"),
  enroll: path.join(__dirname, "assets", "desktop-enroll-step1.png"),
  attendanceMobile: path.join(__dirname, "assets", "05-attendance.png"),
  attendanceDesktop: path.join(__dirname, "assets", "desktop-attendance.png"),
};

function baseSlide(slide, title, subtitle, pageNo) {
  slide.background = { color: C.white };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: 0.52,
    fill: { color: C.blue },
    line: { color: C.blue },
  });
  slide.addText(title, {
    x: 0.55,
    y: 0.72,
    w: 9.6,
    h: 0.32,
    fontSize: 24,
    bold: true,
    color: C.ink,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.55,
      y: 1.15,
      w: 10.8,
      h: 0.22,
      fontSize: 11.5,
      color: C.muted,
    });
  }
  slide.addText(String(pageNo), {
    x: 12.35,
    y: 0.16,
    w: 0.35,
    h: 0.16,
    fontSize: 10,
    bold: true,
    color: C.goldSoft,
    align: "right",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.55,
    y: 1.48,
    w: 12.2,
    h: 0,
    line: { color: C.line, pt: 1.1 },
  });
  slide.addText("CISS Workforce | Management overview", {
    x: 0.55,
    y: 7.14,
    w: 3.8,
    h: 0.12,
    fontSize: 9,
    color: C.muted,
  });
}

function card(slide, x, y, w, h, title, body, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.08,
    fill: { color: opts.fill || C.white },
    line: { color: opts.line || C.line, pt: 1 },
    shadow: safeOuterShadow("000000", 0.12, 45, 2, 1),
  });
  slide.addText(title, {
    x: x + 0.18,
    y: y + 0.16,
    w: w - 0.36,
    h: 0.22,
    fontSize: opts.titleSize || 16,
    bold: true,
    color: opts.titleColor || C.ink,
  });
  if (body) {
    slide.addText(body, {
      x: x + 0.18,
      y: y + 0.46,
      w: w - 0.36,
      h: h - 0.62,
      fontSize: opts.bodySize || 11,
      color: opts.bodyColor || C.text,
      valign: "top",
      margin: 0,
    });
  }
}

function pill(slide, text, x, y, w, fill = C.blueSoft, color = C.blue) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: 0.3,
    rectRadius: 0.08,
    fill: { color: fill },
    line: { color: fill, pt: 1 },
  });
  slide.addText(text, {
    x: x + 0.08,
    y: y + 0.07,
    w: w - 0.16,
    h: 0.14,
    fontSize: 9.5,
    bold: true,
    align: "center",
    color,
  });
}

function bulletRuns(items) {
  return items.map((item) => ({
    text: item,
    options: { bullet: { indent: 12 }, hanging: 2 },
  }));
}

function bullets(slide, items, x, y, w, h, fontSize = 14) {
  slide.addText(bulletRuns(items), {
    x, y, w, h,
    fontSize,
    color: C.text,
    breakLine: true,
    paraSpaceAfterPt: 10,
    margin: 0,
    valign: "top",
  });
}

function statCard(slide, x, y, w, label, value, note, color = C.blue) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: 1.0,
    rectRadius: 0.08,
    fill: { color: C.white },
    line: { color: C.line, pt: 1 },
    shadow: safeOuterShadow("000000", 0.1, 45, 1.5, 1),
  });
  slide.addText(value, {
    x: x + 0.16, y: y + 0.16, w: w - 0.32, h: 0.28,
    fontSize: 20, bold: true, color,
  });
  slide.addText(label, {
    x: x + 0.16, y: y + 0.5, w: w - 0.32, h: 0.18,
    fontSize: 10.5, bold: true, color: C.ink,
  });
  slide.addText(note, {
    x: x + 0.16, y: y + 0.71, w: w - 0.32, h: 0.14,
    fontSize: 8.5, color: C.muted,
  });
}

// Slide 1
{
  const s = pptx.addSlide();
  s.background = { color: C.soft };
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: H, fill: { color: C.soft }, line: { color: C.soft },
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.6, fill: { color: C.blue }, line: { color: C.blue },
  });
  s.addImage({ path: A.logo, ...imageSizingContain(A.logo, 0.72, 1.02, 1.0, 1.0) });
  s.addText("CISS Workforce", {
    x: 1.95, y: 1.1, w: 5.0, h: 0.42, fontSize: 28, bold: true, color: C.ink,
  });
  s.addText("Regional rollout management overview", {
    x: 1.95, y: 1.58, w: 5.0, h: 0.2, fontSize: 15, color: C.muted,
  });
  pill(s, "Live workforce operations platform", 1.95, 2.08, 2.42, C.goldSoft, C.amber);
  pill(s, "Region-ready backend isolation", 4.48, 2.08, 2.28);
  s.addText("What management can see in this session", {
    x: 0.72, y: 2.78, w: 3.0, h: 0.22, fontSize: 15, bold: true, color: C.ink,
  });
  bullets(s, [
    "What is already live and operational today",
    "How Kerala stays protected while new regions get separate databases",
    "How guard onboarding, attendance, and supervision work together",
    "What the next HRM phases add: training, payroll, leave, and branch operations",
  ], 0.82, 3.12, 5.2, 2.3, 15);
  s.addImage({ path: A.landing, ...imageSizingCrop(A.landing, 7.7, 1.05, 4.85, 5.55) });
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.82, y: 6.0, w: 5.15, h: 0.62, rectRadius: 0.06,
    fill: { color: "FFFFFF", transparency: 8 }, line: { color: C.line, pt: 1 },
  });
  s.addText("Presented for senior management | March 2026", {
    x: 1.02, y: 6.18, w: 4.75, h: 0.18, fontSize: 11, color: C.text, align: "center",
  });
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 2
{
  const s = pptx.addSlide();
  baseSlide(s, "Why This Platform Matters", "CISS Workforce is solving daily operational problems first, not just digitising forms.", 2);
  statCard(s, 0.65, 1.8, 2.35, "Single source of truth", "1", "guards, sites, work orders, attendance");
  statCard(s, 3.18, 1.8, 2.35, "Field-ready attendance", "QR", "identity + location + photo proof", C.green);
  statCard(s, 5.71, 1.8, 2.35, "Role control", "4", "super admin, admin, FO, guard", C.gold);
  statCard(s, 8.24, 1.8, 2.35, "Region isolation", "1:1", "one region, one backend", C.blueDark);
  card(s, 0.65, 3.15, 4.0, 2.72, "Problems being removed", "", { fill: C.white });
  bullets(s, [
    "Manual attendance proof and delayed reporting",
    "No clean separation between regional operations",
    "Paper-heavy onboarding of guards and site assignments",
    "Low visibility for management on deployment and compliance",
  ], 0.86, 3.62, 3.55, 1.9, 13.5);
  card(s, 4.9, 3.15, 4.0, 2.72, "Business value now", "", { fill: C.white });
  bullets(s, [
    "Faster region setup with a guided onboarding wizard",
    "Verified attendance from the field with location context",
    "District-level supervision for field officers",
    "Operational data ready for later HRM and payroll expansion",
  ], 5.12, 3.62, 3.55, 1.9, 13.5);
  card(s, 9.15, 3.15, 3.55, 2.72, "Management takeaway", "", { fill: C.blueSoft, line: C.blueSoft });
  bullets(s, [
    "Kerala remains protected",
    "New regions can be started independently",
    "The same codebase can scale without mixing live data",
  ], 9.35, 3.62, 3.15, 1.65, 13.5);
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 3
{
  const s = pptx.addSlide();
  baseSlide(s, "What Is Live Today", "This is already more than an attendance app. It is a workforce operations platform with region onboarding.", 3);
  const data = [
    ["HQ / Super Admin", "Region onboarding, cross-region setup control, admin provisioning"],
    ["Regional Admin", "Clients, field officers, employee records, duty sites, work orders, reports"],
    ["Field Officer", "District-scoped view of attendance and site operations"],
    ["Guard / Candidate", "Mobile-first enrollment, QR identity, attendance-facing flows"],
    ["Attendance Control", "QR scan, location, geofence logic, photo proof, review metadata"],
    ["Operations Masters", "Clients, client locations, duty sites, work orders, exports"],
  ];
  let y = 1.86;
  data.forEach(([title, body], idx) => {
    const x = idx % 2 === 0 ? 0.75 : 6.75;
    if (idx > 0 && idx % 2 === 0) y += 1.62;
    card(s, x, y, 5.75, 1.35, title, body, { bodySize: 11.5, titleSize: 15 });
  });
  pill(s, "Mobile first", 0.75, 6.82, 1.3);
  pill(s, "PWA ready", 2.15, 6.82, 1.2);
  pill(s, "Role based", 3.45, 6.82, 1.35);
  pill(s, "Region isolated", 4.9, 6.82, 1.75, C.goldSoft, C.amber);
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 4
{
  const s = pptx.addSlide();
  baseSlide(s, "How A Region Goes Live", "The model is intentionally simple for non-technical users: manual Firebase setup + guided app onboarding.", 4);
  const steps = [
    ["1. Create region", "HQ creates a region record in the app with region code, name, project id, and web app details."],
    ["2. Finish three Firebase console steps", "Create Firestore, enable Email/Password Auth, and initialize Storage once."],
    ["3. Recheck readiness", "The wizard verifies Firestore, Auth, and Storage and explains what is still missing."],
    ["4. Seed defaults", "The app seeds compliance and runtime defaults for that region backend."],
    ["5. Create first regional admin", "HQ creates the first admin account for that region directly from the wizard."],
    ["6. Start operations", "Regional admin can create clients, field officers, sites, work orders, employees, and attendance immediately."],
  ];
  let y = 1.82;
  steps.forEach((item, idx) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x: 0.82, y, w: 0.52, h: 0.52, rectRadius: 0.12,
      fill: { color: idx < 3 ? C.blue : C.gold },
      line: { color: idx < 3 ? C.blue : C.gold },
    });
    s.addText(String(idx + 1), {
      x: 0.95, y: y + 0.14, w: 0.25, h: 0.16, fontSize: 14, bold: true, color: C.white, align: "center",
    });
    card(s, 1.55, y - 0.04, 10.95, 0.82, item[0], item[1], { bodySize: 10.5, titleSize: 14 });
    y += 0.86;
  });
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 5
{
  const s = pptx.addSlide();
  baseSlide(s, "Enrollment And Employee Readiness", "The guard onboarding flow is structured, mobile-friendly, and designed to improve data quality at entry time.", 5);
  s.addImage({ path: A.enroll, ...imageSizingContain(A.enroll, 0.75, 1.82, 7.0, 4.95) });
  card(s, 8.15, 1.98, 4.4, 1.2, "Why management should care", "Enrollment quality drives better attendance, cleaner records, and fewer downstream HR errors.", { fill: C.goldSoft, line: C.goldSoft, bodySize: 11 });
  bullets(s, [
    "Step-based registration reduces confusion on mobile",
    "Separate document uploads improve clarity and traceability",
    "Draft-safe flow helps staff finish long forms without losing progress",
    "Client-linked onboarding keeps operations aligned from day one",
  ], 8.25, 3.48, 4.0, 1.9, 13.5);
  card(s, 8.15, 5.65, 4.4, 0.95, "Result", "Guards can be enrolled faster with better document completeness and stronger operational records.", { bodySize: 10.5 });
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 6
{
  const s = pptx.addSlide();
  baseSlide(s, "Attendance Built For Real Field Use", "Attendance is designed for shared mobile devices at sites, not office desktops.", 6);
  s.addImage({ path: A.attendanceMobile, ...imageSizingContain(A.attendanceMobile, 0.72, 1.8, 3.1, 5.05) });
  s.addImage({ path: A.attendanceDesktop, ...imageSizingContain(A.attendanceDesktop, 4.2, 1.8, 4.15, 5.05) });
  card(s, 8.7, 1.88, 3.95, 4.7, "Attendance proof chain", "", {});
  bullets(s, [
    "Start attendance from a simple mobile-first screen",
    "Scan guard QR code to identify the person quickly",
    "Capture reporting location, date, and time",
    "Apply geofence checks and site validation",
    "Capture attendance photo and save review metadata",
    "Show the record immediately in admin and field-officer monitoring",
  ], 8.95, 2.35, 3.45, 3.7, 13);
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 7
{
  const s = pptx.addSlide();
  baseSlide(s, "How Operations Stay Under Control", "Different users see the same operation from the right level of visibility.", 7);
  card(s, 0.75, 1.95, 3.95, 2.15, "Regional Admin", "", { fill: C.blueSoft, line: C.blueSoft });
  bullets(s, [
    "Sees full region operations",
    "Creates field officers and clients",
    "Monitors attendance logs and reports",
  ], 0.96, 2.42, 3.5, 1.2, 13);
  card(s, 4.95, 1.95, 3.95, 2.15, "Field Officer", "", { fill: C.goldSoft, line: C.goldSoft });
  bullets(s, [
    "Sees only assigned districts",
    "Tracks local site coverage and attendance",
    "Acts on operational gaps in the field",
  ], 5.16, 2.42, 3.5, 1.2, 13);
  card(s, 9.15, 1.95, 3.45, 2.15, "Guard", "", { fill: C.white });
  bullets(s, [
    "Uses simple mobile flows",
    "Gets QR-based identification",
    "Interacts with attendance and later self-service",
  ], 9.35, 2.42, 3.0, 1.2, 13);
  card(s, 0.75, 4.45, 11.85, 1.7, "What was proven in a real dummy-region test", "", {});
  bullets(s, [
    "HQ created a separate region backend and first admin",
    "That region created field officers, clients, employees, duty sites, and work orders",
    "Attendance was recorded and then seen correctly at both admin and district-scoped field-officer levels",
  ], 0.98, 4.95, 11.3, 0.95, 14);
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 8
{
  const s = pptx.addSlide();
  baseSlide(s, "Architecture And Governance", "The platform is already structured for operational discipline and scalable rollout.", 8);
  card(s, 0.75, 1.85, 4.0, 2.0, "Technology stack", "", {});
  bullets(s, [
    "Next.js 15.5 App Router",
    "Firebase Auth, Firestore, and Storage",
    "Vercel deployment model",
    "Mobile-first PWA usage",
  ], 0.95, 2.28, 3.55, 1.2, 13.5);
  card(s, 4.95, 1.85, 4.0, 2.0, "Control model", "", {});
  bullets(s, [
    "Role-based access across admin, FO, client, and guard layers",
    "Audit-oriented server routes",
    "Geofence-aware attendance validation",
    "Dedicated backend per region",
  ], 5.15, 2.28, 3.55, 1.25, 13.5);
  card(s, 9.15, 1.85, 3.45, 2.0, "What this means", "", {});
  bullets(s, [
    "No cross-region data mixing",
    "Operational accountability",
    "Stronger rollout confidence",
  ], 9.35, 2.28, 3.0, 1.0, 13.5);
  card(s, 0.75, 4.2, 11.85, 1.9, "Management assurance", "Kerala remains the current live region database. New regions are onboarded without migrating or overwriting Kerala data. The setup model is now simple enough for HQ operations: finish 3 Firebase console actions, then let the wizard validate, seed, and create the first admin.", { fill: C.blueSoft, line: C.blueSoft, bodySize: 13 });
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 9
{
  const s = pptx.addSlide();
  baseSlide(s, "What Comes Next", "The current platform already supports operations. The next phases convert it into a full HRM and payroll system.", 9);
  card(s, 0.75, 1.95, 2.85, 2.65, "Phase 1-2", "UI refinement\nTraining modules\nEvaluations\nLeaderboard\nAwards", { bodySize: 14 });
  card(s, 3.9, 1.95, 2.85, 2.65, "Phase 3", "Payroll engine\nClient wage configs\nPayslips\nStatutory compliance\nManual overrides", { bodySize: 14, fill: C.goldSoft, line: C.goldSoft });
  card(s, 7.05, 1.95, 2.85, 2.65, "Phase 4-5", "Leave management\nAttendance hardening\nSite review queue\nHoliday and allowance logic", { bodySize: 14 });
  card(s, 10.2, 1.95, 2.35, 2.65, "Phase 6", "Branch operations\nFO visit reports\nTraining reports\nExpense tracking", { bodySize: 13.5 });
  card(s, 0.75, 5.0, 11.85, 1.15, "Recommended management view", "Approve rollout based on what is already live today for operations, then fund later phases as controlled business expansions rather than treating everything as one big risky transformation.", { fill: C.white, bodySize: 13 });
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

// Slide 10
{
  const s = pptx.addSlide();
  baseSlide(s, "Recommended Demonstration Flow", "Use this sequence for a confident management presentation.", 10);
  card(s, 0.75, 1.85, 5.75, 4.95, "Live demo script", "", {});
  bullets(s, [
    "1. Show Region Onboarding and explain separate backend per region",
    "2. Show client and field-officer setup in a region",
    "3. Show employee enrollment with the guided mobile-friendly flow",
    "4. Record one attendance entry live if possible",
    "5. Open attendance logs and show the same record immediately",
    "6. Close with the roadmap: training, payroll, leave, branch operations",
  ], 0.98, 2.3, 5.25, 3.7, 13.5);
  card(s, 6.85, 1.85, 5.7, 2.05, "What to say in one sentence", "\"CISS Workforce is now a region-ready workforce operations platform, with Kerala protected, new regions isolated, and field attendance controlled in real time.\"", { fill: C.blueSoft, line: C.blueSoft, bodySize: 14 });
  card(s, 6.85, 4.15, 5.7, 2.65, "Management decision ask", "", { fill: C.goldSoft, line: C.goldSoft });
  bullets(s, [
    "Approve rollout to the next region",
    "Use operations first, then extend to payroll and HRM",
    "Treat this as the company’s standard workforce platform",
  ], 7.08, 4.62, 5.2, 1.5, 14);
  warnIfSlideHasOverlaps(s, pptx);
  warnIfSlideElementsOutOfBounds(s, pptx);
}

const out = path.join(__dirname, "CISS_Workforce_Management_Overview.pptx");

(async () => {
  await pptx.writeFile({ fileName: out });
})();
