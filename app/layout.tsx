import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PARALLAX — Find the gap in agreement',
  description: 'Source-grounded agents use FalkorDB to find hidden disagreements, coordinate human decisions, and remember what your team learned.',
  applicationName: 'PARALLAX',
  icons: { icon: '/icon.svg' },
  openGraph: { title: 'PARALLAX', description: 'Sixteen teams can agree. One customer can prove otherwise.', type: 'website' }
};
export const viewport: Viewport = {width:'device-width',initialScale:1,themeColor:'#222723'};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
