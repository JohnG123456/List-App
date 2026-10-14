import type { NextConfig } from "next";

// Sent with every page and API response. None of these restrict the app's own
// scripts, so they can't break anything that works today; a full
// Content-Security-Policy would, and needs testing against Supabase realtime
// and the Web Speech API before it goes on.
const securityHeaders = [
  // Don't guess a file's type from its contents.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nobody can show the app inside a frame on their own site and trick a tap.
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera for photos and microphone for dictation, from this app only.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
