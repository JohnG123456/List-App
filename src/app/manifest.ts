import type { MetadataRoute } from "next";

/**
 * What makes the Home Screen icon open as its own app rather than a Safari tab.
 *
 * `display: standalone` is the part that matters: without a manifest saying so,
 * iOS treats the icon as an ordinary bookmark and hands it back to the browser
 * with its address bar and toolbars intact.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sorted",
    short_name: "Sorted",
    description: "Say anything and have it sorted into the right list.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches the app's own background, so the launch screen doesn't flash
    // white before the page paints.
    background_color: "#05070d",
    theme_color: "#05070d",
    icons: [
      { src: "/app-icon-128.png", sizes: "128x128", type: "image/png" },
      {
        src: "/app-icon-180.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
