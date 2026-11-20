import type { Metadata } from 'next';
import { Inter, Lora } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/error-boundary';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Folio & Desk — Library Seat Admin',
  description: 'Admin-only library seat booking, visual floor layout editor, and counter POS system.',
  openGraph: {
    title: 'Folio & Desk — Library Seat Admin',
    description: 'Admin-only library seat booking, visual floor layout editor, and counter POS system.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Folio & Desk — Library Seat Admin',
    description: 'Admin-only library seat booking, visual floor layout editor, and counter POS system.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(inter.variable, lora.variable)}>
      <body suppressHydrationWarning className="min-h-screen bg-[#FDFBF7] text-[#2C2A29] font-sans">
        <ErrorBoundary>
          {children}
          <Toaster position="bottom-right" />
        </ErrorBoundary>
      </body>
    </html>
  );
}
