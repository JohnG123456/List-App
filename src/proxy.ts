import type { NextRequest } from "next/server";
import { updateAuthSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateAuthSession(request);
}

export const config = {
  // Manifests and icons are fetched without a session, and a redirect to the
  // login page instead of the file breaks adding the app to the Home Screen.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.webmanifest$|.*\\.png$).*)"],
};
