import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildDigest } from "@/lib/digest";
import type { Item, List } from "@/lib/types";

/**
 * The morning email.
 *
 * GET is the scheduled run and is for Vercel Cron only. It needs to read other
 * people's lists to email them, which no signed-in session can do, so it uses
 * the service key — the one credential that bypasses every security policy in
 * the database.
 *
 * Three things keep that contained. The key is server-only and never reaches
 * the browser. The route refuses anything without the shared secret, so it
 * cannot be triggered from outside. And it only ever sends a person their own
 * lists, at the address on their own account, so even a successful call sends
 * nothing anywhere new.
 *
 * POST is the "send mine now" button: it uses the ordinary signed-in session
 * and the normal policies, with no elevated access at all.
 */

function transport() {
  const user = process.env.GMAIL_ADDRESS;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return {
    from: user,
    mailer: nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user, pass },
    }),
  };
}

function greetingFor(email: string) {
  const name = email.split("@")[0].split(/[.\-_]/)[0];
  return `Morning ${name.charAt(0).toUpperCase()}${name.slice(1)},`;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Server is missing CRON_SECRET" },
      { status: 500 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const mail = transport();
  if (!mail) {
    return NextResponse.json(
      { error: "Server is missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD" },
      { status: 500 }
    );
  }

  const admin = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [membersResult, listsResult, itemsResult, usersResult] = await Promise.all([
    admin.from("household_members").select("household_id, user_id"),
    admin.from("lists").select("*"),
    admin.from("items").select("*").is("archived_at", null).eq("done", false),
    admin.auth.admin.listUsers(),
  ]);

  if (membersResult.error || listsResult.error || itemsResult.error) {
    const detail =
      membersResult.error?.message ??
      listsResult.error?.message ??
      itemsResult.error?.message;
    return NextResponse.json({ error: detail }, { status: 500 });
  }

  const members = membersResult.data ?? [];
  const allLists = (listsResult.data ?? []) as List[];
  const allItems = (itemsResult.data ?? []) as Item[];
  const emails = new Map(
    (usersResult.data?.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  let sent = 0;
  const failures: string[] = [];

  for (const member of members) {
    const email = emails.get(member.user_id);
    if (!email) continue;

    // The visibility rule from the database policies, applied by hand because
    // the service key has bypassed the policies that would normally do it.
    const visible = allLists.filter(
      (l) =>
        l.household_id === member.household_id &&
        (l.private_to === null || l.private_to === member.user_id)
    );
    const visibleIds = new Set(visible.map((l) => l.id));
    const theirItems = allItems.filter((i) => visibleIds.has(i.list_id));

    const digest = buildDigest(visible, theirItems, greetingFor(email));
    if (!digest) continue;

    try {
      await mail.mailer.sendMail({
        from: `"Sorted" <${mail.from}>`,
        to: email,
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
      });
      sent += 1;
    } catch {
      failures.push(email);
    }
  }

  return NextResponse.json({ sent, skipped: members.length - sent, failures });
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mail = transport();
  if (!mail) {
    return NextResponse.json(
      {
        error:
          "Email isn't set up on this deployment. Add GMAIL_ADDRESS and " +
          "GMAIL_APP_PASSWORD in the Vercel project settings, then redeploy.",
      },
      { status: 500 }
    );
  }

  // No elevated access here: the ordinary policies already scope these to
  // exactly what this person is allowed to see.
  const [listsResult, itemsResult] = await Promise.all([
    supabase.from("lists").select("*"),
    supabase.from("items").select("*").is("archived_at", null).eq("done", false),
  ]);

  if (listsResult.error || itemsResult.error) {
    return NextResponse.json(
      { error: listsResult.error?.message ?? itemsResult.error?.message },
      { status: 500 }
    );
  }

  const digest = buildDigest(
    (listsResult.data ?? []) as List[],
    (itemsResult.data ?? []) as Item[],
    greetingFor(user.email)
  );

  if (!digest) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: "Nothing due and nothing waiting, so there'd be no email.",
    });
  }

  try {
    await mail.mailer.sendMail({
      from: `"Sorted" <${mail.from}>`,
      to: user.email,
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
    });
  } catch {
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
