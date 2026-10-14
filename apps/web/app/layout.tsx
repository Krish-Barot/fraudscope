// apps/web/app/layout.tsx
// Root layout — wraps every page in the app
// Server Component — runs on the server, no browser APIs
//
// Responsibilities:
// - Set HTML lang and metadata
// - Load global CSS
// - Provide the base HTML structure
// No auth logic here — that's in middleware.ts and dashboard/layout.tsx

import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/authContext';

export const metadata: Metadata = {
  title: { default: 'FraudScope', template: '%s | FraudScope' },
  description: 'Real-time transaction fraud detection dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-slate-950 text-slate-100 antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}