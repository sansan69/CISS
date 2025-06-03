
import type {Metadata} from 'next';
import {Geist, Geist_Mono} from 'next/font/google';
import './globals.css';

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
  manifest: '/manifest.json',
  applicationName: 'CISS Workforce',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'CISS Workforce',
    // startupImage: [...] // You can add startup images here
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'msapplication-config': '/icons/browserconfig.xml',
    'msapplication-TileColor': '#3F51B5',
    'msapplication-tap-highlight': 'no',
  },
  themeColor: '#3F51B5',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
    ],
    shortcut: ['/favicon.ico'],
  }
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
      </body>
    </html>
  );
}
