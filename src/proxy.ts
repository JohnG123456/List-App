import type { NextRequest } from "next/server";
import { updateAuthSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateAuthSession(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
