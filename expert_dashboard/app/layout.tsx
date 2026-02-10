import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { UserProvider } from "@/components/UserContext";
import { DataProvider } from "@/components/DataContext";
import { NotificationProvider } from "@/components/NotificationContext";
import { SidebarProvider } from "@/components/SidebarContext";
import { Toaster } from "@/components/Toaster";
import ChunkErrorHandler from "@/components/ChunkErrorHandler";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BitterScan Dashboard",
  description: "BitterScan expert validation portal",
  icons: {
    icon: '/logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased bg-[var(--background)]`} style={{ fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif' }}>
        <ChunkErrorHandler />
        <UserProvider>
          <SidebarProvider>
            <DataProvider>
              <NotificationProvider>
                {children}
                <Toaster />
              </NotificationProvider>
            </DataProvider>
          </SidebarProvider>
        </UserProvider>
      </body>
    </html>
  );
}
