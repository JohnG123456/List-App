import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sorted",
  description: "Say anything and have it sorted into the right list.",
  // iOS only opens a Home Screen icon as its own app when it is told to. The
  // manifest covers newer versions; this covers the rest.
  appleWebApp: {
    capable: true,
    title: "Sorted",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  // Stops a double-tap zooming the page, which on a list of tick boxes is
  // almost always a mis-tap rather than an intention.
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
