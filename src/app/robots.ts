import type { MetadataRoute } from "next";

const siteUrl = "https://cisskerala.site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/download", "/enroll"],
        disallow: [
          "/api/",
          "/admin/",
          "/admin-login",
          "/attendance",
          "/dashboard",
          "/employees",
          "/evaluations",
          "/field-officers",
          "/guard/",
          "/guard-forgot-pin",
          "/guard-login",
          "/leaderboard",
          "/patrol-activity",
          "/payroll",
          "/profile/",
          "/record-attendance",
          "/settings",
          "/super-admin",
          "/training",
          "/visit-reports",
          "/wizard",
          "/work-orders",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
