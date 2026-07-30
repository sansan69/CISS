import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  DownloadSimple,
  Fingerprint,
  MapPin,
  QrCode,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import {
  ANDROID_DOWNLOAD_PATH,
  createAndroidDownloadQr,
  formatReleaseSize,
  getAndroidRelease,
} from "@/lib/android-release";

export const metadata: Metadata = {
  title: "Download CISS Workforce App",
  description:
    "Download the verified CISS Workforce Android app for guards and field officers.",
};

const capabilities = [
  {
    icon: MapPin,
    title: "Verified attendance",
    detail: "Location and site-bound duty records.",
  },
  {
    icon: Fingerprint,
    title: "Secure access",
    detail: "Role-based and biometric sign-in.",
  },
  {
    icon: ShieldCheck,
    title: "Active-duty services",
    detail: "Shift tracking, reports, and alerts.",
  },
] as const;

export default async function DownloadPage() {
  const [release, qrCode] = await Promise.all([
    getAndroidRelease(),
    createAndroidDownloadQr(),
  ]);
  const releaseSize = formatReleaseSize(release.sizeBytes);

  return (
    <main className="min-h-[100dvh] bg-brand-blue-darker text-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
        <header className="flex items-center justify-between border-b border-white/12 pb-5">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/75 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-light"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            CISS Workforce
          </Link>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-gold-light">
            Official Android release
          </span>
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:gap-20">
          <section aria-labelledby="android-download-heading">
            <div className="flex items-center gap-3">
              <Image
                src="/ciss-logo.png"
                alt="CISS Workforce"
                width={56}
                height={56}
                priority
                className="h-14 w-14"
              />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-gold-light">
                  CISS Services Limited
                </p>
                <p className="mt-1 text-sm text-white/68">
                  Security workforce operations
                </p>
              </div>
            </div>

            <h1
              id="android-download-heading"
              className="mt-8 max-w-2xl font-exo2 text-[clamp(2.4rem,7vw,5.4rem)] font-bold leading-[0.94] tracking-[-0.055em]"
            >
              Your duty workspace, on Android.
            </h1>
            <p className="mt-6 max-w-[58ch] text-base leading-7 text-white/72 sm:text-lg sm:leading-8">
              Install the verified CISS Workforce app for attendance, active-shift
              tracking, field coordination, and secure duty services.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={ANDROID_DOWNLOAD_PATH}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-gold-light px-5 text-sm font-bold text-brand-blue-darker transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-darker"
              >
                <DownloadSimple className="h-5 w-5" aria-hidden="true" />
                Download verified APK
              </a>
              <span className="text-xs text-white/58">
                Version {release.latestVersionName} · {releaseSize} · Android 7+
              </span>
            </div>

            <div className="mt-10 grid gap-5 border-y border-white/12 py-6 sm:grid-cols-3">
              {capabilities.map(({ icon: Icon, title, detail }) => (
                <div key={title} className="flex gap-3 sm:block">
                  <Icon
                    className="h-5 w-5 shrink-0 text-brand-gold-light"
                    aria-hidden="true"
                  />
                  <div>
                    <h2 className="sm:mt-3 text-sm font-semibold">{title}</h2>
                    <p className="mt-1 text-xs leading-5 text-white/58">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside
            className="lg:border-l lg:border-white/12 lg:pl-12"
            aria-labelledby="phone-handoff-heading"
          >
            <div className="hidden lg:block">
              <div className="inline-flex bg-[#F4F7FB] p-3">
                <Image
                  src={qrCode}
                  alt="QR code to open this Android installation page on a phone"
                  width={216}
                  height={216}
                  unoptimized
                  className="h-[216px] w-[216px]"
                />
              </div>
              <div className="mt-5 flex items-center gap-2 text-brand-gold-light">
                <QrCode className="h-5 w-5" aria-hidden="true" />
                <h2 id="phone-handoff-heading" className="font-exo2 text-xl font-bold">
                  Scan with your Android phone
                </h2>
              </div>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/62">
                The code opens this verified CISS page. Download only from this
                page or an organization-managed Google Play listing.
              </p>
            </div>

            <div className="lg:mt-10">
              <h2 className="font-exo2 text-lg font-bold">Install safely</h2>
              <ol className="mt-4 space-y-4">
                {[
                  "Download the APK from this page.",
                  "Open the completed download from your browser.",
                  "Allow installation for the browser only if Android asks.",
                  "Confirm CISS Workforce, then sign in with your duty account.",
                ].map((instruction, index) => (
                  <li key={instruction} className="flex gap-3 text-sm leading-6 text-white/68">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-gold-light/45 text-xs font-bold text-brand-gold-light">
                      {index + 1}
                    </span>
                    {instruction}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-8 flex items-start gap-3 border-t border-white/12 pt-5">
              <CheckCircle
                className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-light"
                aria-hidden="true"
              />
              <p className="text-xs leading-5 text-white/58">
                Release checksum:{" "}
                <span className="font-semibold text-white/78">
                  {release.sha256.slice(0, 12)}…{release.sha256.slice(-12)}
                </span>
              </p>
            </div>
          </aside>
        </div>

        <footer className="border-t border-white/12 pt-5 text-xs text-white/45">
          © 2026 CISS Services Limited · Verified workforce operations
        </footer>
      </div>
    </main>
  );
}
