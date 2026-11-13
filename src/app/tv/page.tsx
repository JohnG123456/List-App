import type { Metadata } from "next";
import Home from "../page";

/**
 * The "Sorted TV" Home Screen icon: the same app, opening on the TV pill.
 *
 * Its own name, icon and manifest are what let it sit on the Home Screen as a
 * second icon. Everything else, the capture box included, is the main app.
 */
export const metadata: Metadata = {
  title: "Sorted TV",
  manifest: "/tv.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sorted TV",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [{ url: "/tv-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function TvPage() {
  return <Home />;
}
