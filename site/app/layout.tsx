import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '我的私密兌換券', description: '私密兌換券保管箱', robots: { index: false, follow: false } };
export default function RootLayout({children}: {children: React.ReactNode}) { return <html lang="zh-Hant"><body>{children}</body></html>; }
