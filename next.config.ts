
import type {NextConfig} from 'next';
import androidRelease from './public/downloads/ciss-workforce-android.json';

const androidDownloadAliases = [
  "/downloads/ciss-workforce-latest.apk",
  "/downloads/ciss-mobile.apk",
];
const apkContentType = {
  key: "Content-Type",
  value: "application/vnd.android.package-archive",
};
const noStore = { key: "Cache-Control", value: "no-store, max-age=0" };
const redirectAndroidApk = process.env.CISS_REDIRECT_ANDROID_APK === "true";
const androidStreamRoute = "/api/public/download/android/file";
const previousAndroidApk = "/downloads/ciss-workforce-1.0.21.apk";

// Build-time check that NEXT_PUBLIC_FIREBASE_* env vars are present
const missingFirebaseVars = [
  ["NEXT_PUBLIC_FIREBASE_API_KEY", process.env.NEXT_PUBLIC_FIREBASE_API_KEY],
  ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN],
  ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID],
  ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET],
  ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID],
  ["NEXT_PUBLIC_FIREBASE_APP_ID", process.env.NEXT_PUBLIC_FIREBASE_APP_ID],
].filter(([, value]) => !value).map(([name]) => name);

if (missingFirebaseVars.length > 0) {
  console.warn(
    `Missing Firebase client env vars at build time: ${missingFirebaseVars.join(", ")}. ` +
    "Ensure they are set in your .env file or deployment environment.",
  );
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      // Next's standalone server only receives traced files. Include the
      // public assets it serves directly. APK downloads use redirects.
      "./public/*.{png,ico,json,js,html}",
      "./public/icons/**/*",
      "./public/downloads/ciss-workforce-android.json",
    ],
    // The regional database-setup route reads the repository rules/index
    // manifest at runtime to deploy them to the state's Firebase project.
    "/api/super-admin/regions/**": [
      "./firestore.rules",
      "./storage.rules",
      "./firestore.indexes.json",
    ],
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  poweredByHeader: false,
  async rewrites() {
    const aliases = androidDownloadAliases.map((source) => ({
      source,
      destination: redirectAndroidApk ? androidStreamRoute : androidRelease.apkPath,
    }));
    return {
      beforeFiles: redirectAndroidApk
        ? [
            ...aliases,
            { source: androidRelease.apkPath, destination: androidStreamRoute },
            { source: previousAndroidApk, destination: `${androidStreamRoute}/legacy` },
          ]
        : aliases,
    };
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self), geolocation=(self)",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Permitted-Cross-Domain-Policies",
            value: "none",
          },
        ],
      },
      {
        source: "/downloads/ciss-workforce-android.json",
        headers: [{ key: "Content-Type", value: "application/json; charset=utf-8" }, noStore],
      },
      {
        source: "/downloads/:release.apk",
        headers: [
          apkContentType,
          redirectAndroidApk ? noStore : { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      ...androidDownloadAliases.map((source) => ({
        source,
        headers: [apkContentType, noStore],
      })),
    ];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    NEXT_PUBLIC_MAP_TILE_URL: process.env.NEXT_PUBLIC_MAP_TILE_URL,
  },
};

export default nextConfig;
