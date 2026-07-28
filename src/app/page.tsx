import type { Metadata } from "next";
import LandingPage from "@/components/landing-page";

const title = "CISS Workforce | Secure Attendance & Workforce Operations";
const description =
  "Official CISS Workforce portal for guard attendance, enrolment, field coordination, duty operations, and secure role-based access.";

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "CISS Workforce",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CISS Workforce secure attendance and workforce operations",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image"],
  },
};

export default function Page() {
  return <LandingPage />;
}
