import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Download CISS Workforce App",
  description: "Download the CISS Workforce mobile app for Android guards and field officers.",
};

export default function DownloadPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-primary/40 to-primary px-4 py-12">
      <div className="max-w-md w-full text-center">
        {/* Logo */}
        <div className="mx-auto w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center mb-6 ring-1 ring-white/10">
          <span className="text-3xl font-black text-accent">C</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">CISS Workforce</h1>
        <p className="text-sm text-white/60 mb-8">
          Mobile operations app for guards and field officers
        </p>

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 mb-8 text-left">
          {[
            { icon: "📍", text: "GPS attendance with geofence" },
            { icon: "📸", text: "In-app photo capture" },
            { icon: "📋", text: "Work orders & duty tracking" },
            { icon: "📊", text: "Reports & dashboards" },
            { icon: "🔐", text: "Biometric login" },
            { icon: "🌙", text: "Night shift support" },
          ].map((f) => (
            <div key={f.text} className="bg-white/5 rounded-xl px-3 py-2.5 flex items-center gap-2">
              <span className="text-lg">{f.icon}</span>
              <span className="text-xs text-white/70 leading-tight">{f.text}</span>
            </div>
          ))}
        </div>

        {/* Primary Download — Direct APK */}
        <a
          href="/downloads/ciss-workforce-latest.apk"
          download
          className="inline-flex items-center gap-2 px-8 py-4 bg-accent text-primary font-bold text-lg rounded-2xl hover:bg-accent/90 transition-colors shadow-lg shadow-black/20"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 13.5v-6h2v6l3-3 1.41 1.41L12 18.59l-5.41-5.41L8 11.83l3 3z"/>
          </svg>
          Download APK
        </a>

        <p className="text-xs text-white/40 mt-4">
          Version 1.0.15 · Latest release · Android 7.0+ (API 24)
        </p>

        {/* Alternative download — GitHub Release */}
        <p className="text-xs text-white/30 mt-3">
          Also available on{" "}
          <a
            href="https://github.com/sansan69/CISS-Mobile/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/50 underline hover:text-white/70"
          >
            GitHub Releases
          </a>
          {" "}(ARM64 · ARMv7)
        </p>

        <p className="text-xs text-white/30 mt-3">
          You may need to enable &quot;Install from unknown sources&quot; in your device settings.
        </p>

        {/* Instructions */}
        <div className="mt-8 bg-white/5 rounded-2xl p-4 text-left">
          <h3 className="text-sm font-semibold text-white/80 mb-3">Installation Steps</h3>
          <ol className="text-xs text-white/50 space-y-2 list-decimal list-inside">
            <li>Tap the <strong className="text-white/70">Download APK</strong> button above</li>
            <li>Open the downloaded file from notifications</li>
            <li>If prompted, allow installation from your browser</li>
            <li>Tap <strong className="text-white/70">Install</strong> and open the app</li>
            <li>Log in with your guard or field officer credentials</li>
          </ol>
        </div>

        {/* Troubleshooting */}
        <div className="mt-4 bg-white/5 rounded-2xl p-4 text-left">
          <h3 className="text-sm font-semibold text-white/80 mb-3">Troubleshooting</h3>
          <ul className="text-xs text-white/50 space-y-2 list-disc list-inside">
            <li>
              <strong className="text-white/70">Install blocked?</strong> Go to Settings → Security → Enable &quot;Unknown sources&quot;
            </li>
            <li>
              <strong className="text-white/70">App not installing?</strong> Make sure you have enough storage space (at least 50MB free)
            </li>
            <li>
              <strong className="text-white/70">Login issues?</strong> Contact your supervisor to verify your account is active
            </li>
          </ul>
        </div>

        <div className="mt-6">
          <Link href="/" className="text-xs text-white/40 hover:text-white/60 underline">
            Back to CISS Workforce
          </Link>
        </div>
      </div>
    </main>
  );
}
