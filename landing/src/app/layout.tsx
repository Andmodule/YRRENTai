import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RentAI — AI-Powered Rental Management',
  description: 'Manage your short-term rental properties with AI assistance',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
