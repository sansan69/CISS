import type { MetadataRoute } from "next";

const siteUrl = "https://cisskerala.site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${siteUrl}/download`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/enroll`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
