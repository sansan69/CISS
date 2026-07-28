
import type {Metadata, Viewport} from 'next';
import {Geist, Geist_Mono, Exo_2} from 'next/font/google';
import './globals.css';
import PwaLoader from '@/components/pwa-loader';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const exoDisplay = Exo_2({
  variable: '--font-exo-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'CISS Workforce',
    template: '%s · CISS Workforce',
  },
  description: 'Secure attendance and workforce operations for CISS Services.',
  applicationName: 'CISS Workforce',
  metadataBase: new URL('https://cisskerala.site'),
  openGraph: {
    title: 'CISS Workforce',
    description: 'Secure attendance and workforce operations for CISS Services.',
    siteName: 'CISS Workforce',
    type: 'website',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'CISS Workforce',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'msapplication-config': '/icons/browserconfig.xml',
    'msapplication-TileColor': '#014c85',
    'msapplication-tap-highlight': 'no',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: ['/icons/icon-192x192.png'],
  }
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#061521' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: true,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;var m=window.matchMedia('(prefers-color-scheme: dark)');function s(){var dark=m.matches;d.classList.toggle('dark',dark);d.dataset.theme=dark?'dark':'light';d.style.colorScheme=dark?'dark':'light'}s();if(m.addEventListener)m.addEventListener('change',s);else if(m.addListener)m.addListener(s)})();`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${exoDisplay.variable} antialiased`}>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <Toaster />
        <PwaLoader />
      </body>
    </html>
  );
}
