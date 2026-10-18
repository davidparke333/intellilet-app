import './globals.css';
import HomeShortcut from '@/components/HomeShortcut';

export const metadata = { title: 'IntelliLet', description: 'Lettings with compliance done in-house' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#1F5E4B' };

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap" />
      </head>
      <body><main className="app">{children}</main><HomeShortcut /></body>
    </html>
  );
}
