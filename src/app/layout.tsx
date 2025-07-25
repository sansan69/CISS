
import type {Metadata, Viewport} from 'next';
import {Geist, Geist_Mono} from 'next/font/google';
import './globals.css';
import PwaLoader from '@/components/pwa-loader';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'CISS Workforce',
  description: 'CISS Workforce Employee Management System',
  applicationName: 'CISS Workforce',
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
    'msapplication-TileColor': '#3F51B5',
    'msapplication-tap-highlight': 'no',
  },
  icons: {
    icon: [
      { url: '/ciss-logo.png', sizes: 'any', type: 'image/png' },
    ],
    apple: [
      { url: '/ciss-logo.png', sizes: '180x180' },
    ],
    shortcut: ['/ciss-logo.png'],
  }
};

export const viewport: Viewport = {
  themeColor: '#3F51B5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Meta tags for PWA defined in metadata object now */}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <PwaLoader />
      </body>
    </html>
  );
}
