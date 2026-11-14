import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@/lib/supabase/server";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.email) {
    return NextResponse.json(
      { error: "No email address on this account" },
      { status: 400 }
    );
  }

  const gmailAddress = process.env.GMAIL_ADDRESS;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailAddress || !gmailAppPassword) {
    return NextResponse.json(
      {
        error:
          "Email isn't set up on this deployment. Add GMAIL_ADDRESS and " +
          "GMAIL_APP_PASSWORD in the Vercel project settings, for the Preview " +
          "environment as well as Production, then redeploy.",
      },
      { status: 500 }
    );
  }

  // Which lists to send. An empty or missing selection means everything the
  // signed-in person can see, which is what the old single-list version did.
  let listIds: string[] = [];
  // Or a chosen set of items from the Share sheet, e.g. recommended shows.
  let itemIds: string[] = [];
  let title = "";
  let recommended = false;
  let to: string | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.listIds)) {
      listIds = body.listIds.filter((id: unknown) => typeof id === "string");
    }
    if (Array.isArray(body?.itemIds)) {
      itemIds = body.itemIds.filter((id: unknown) => typeof id === "string").slice(0, 500);
    }
    if (typeof body?.title === "string") {
      title = body.title.replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
    }
    recommended = body?.recommended === true;
    if (typeof body?.to === "string" && body.to) to = body.to;
  } catch {
    // No body at all is fine — treat it as "everything".
  }

  // Only ever to yourself or someone in your household, checked here rather
  // than trusted from the browser, so this can never email a stranger.
  let recipient = user.email;
  if (to && to !== user.id) {
    const { data: members } = await supabase.rpc("household_member_emails");
    const match = ((members ?? []) as { user_id: string; email: string }[]).find(
      (m) => m.user_id === to
    );
    if (!match?.email) {
      return NextResponse.json(
        { error: "You can only email people in your household." },
        { status: 403 }
      );
    }
    recipient = match.email;
  }

  if (itemIds.length > 0) {
    return sendItems({
      supabase,
      itemIds,
      title: title || "From Sorted",
      recommended,
      recipient,
      sender: user.email,
      gmailAddress,
      gmailAppPassword,
    });
  }

  // Row-level security keeps this to lists this person is allowed to see, so
  // a list id from somewhere else simply returns nothing.
  // Archives are excluded whichever way the lists were chosen: Watched is a
  // record of what you finished, and it only ever grows.
  const listQuery = supabase
    .from("lists")
    .select("id, name, position")
    .eq("is_archive", false)
    .order("position");
  const { data: lists, error: listError } = listIds.length
    ? await listQuery.in("id", listIds)
    : await listQuery;

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const chosen = (lists ?? []).filter((l) => l.id);
  if (chosen.length === 0) {
    return NextResponse.json({ error: "No lists to send" }, { status: 400 });
  }

  const { data: items, error: itemsError } = await supabase
    .from("items")
    .select("text, qty, service, progress, list_id")
    .in(
      "list_id",
      chosen.map((l) => l.id)
    )
    .eq("done", false)
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  type Row = {
    text: string;
    qty: string | null;
    service: string | null;
    progress: string | null;
    list_id: string;
  };

  const rows = (items ?? []) as Row[];

  /** The trailing detail that makes a line useful: "2L", "Netflix, S2 E4". */
  function detailFor(row: Row) {
    const bits = [row.qty, row.service, row.progress].filter(Boolean);
    return bits.length ? ` (${bits.join(", ")})` : "";
  }

  const sections = chosen.map((list) => ({
    name: list.name,
    rows: rows.filter((r) => r.list_id === list.id),
  }));

  const textBody = sections
    .map((section) =>
      section.rows.length === 0
        ? `${section.name}\n  Nothing open.`
        : `${section.name}\n${section.rows
            .map((r, i) => `  ${i + 1}. ${r.text}${detailFor(r)}`)
            .join("\n")}`
    )
    .join("\n\n");

  const htmlBody = sections
    .map((section) =>
      section.rows.length === 0
        ? `<h3>${escapeHtml(section.name)}</h3><p>Nothing open.</p>`
        : `<h3>${escapeHtml(section.name)}</h3><ol>${section.rows
            .map((r) => `<li>${escapeHtml(r.text + detailFor(r))}</li>`)
            .join("")}</ol>`
    )
    .join("");

  const subject =
    chosen.length === 1 ? `Your ${chosen[0].name} list` : "Your lists";

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: gmailAddress, pass: gmailAppPassword },
  });

  try {
    await transporter.sendMail({
      from: `"Sorted" <${gmailAddress}>`,
      to: recipient,
      subject,
      text: textBody,
      html: htmlBody,
    });
  } catch {
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * A chosen set of items as one list: the Share sheet's "Recommended shows",
 * "Dawn's shows" and the like. Row-level security means an id from another
 * household just doesn't come back. Unlike the list email this keeps ticked
 * and archived items, since recommendations mostly live on Watched.
 */
async function sendItems({
  supabase,
  itemIds,
  title,
  recommended,
  recipient,
  sender,
  gmailAddress,
  gmailAppPassword,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  itemIds: string[];
  title: string;
  recommended: boolean;
  recipient: string;
  sender: string;
  gmailAddress: string;
  gmailAppPassword: string;
}) {
  // "*" so a database without migration 0015's note still answers.
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .in("id", itemIds)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as {
    text: string;
    qty: string | null;
    service: string | null;
    progress: string | null;
    recommend_note?: string | null;
  }[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "Nothing to send" }, { status: 400 });
  }

  const lineFor = (r: (typeof rows)[number]) => {
    const bits = [r.qty, r.service, r.progress].filter(Boolean);
    const note = recommended && r.recommend_note ? ` — ${r.recommend_note}` : "";
    return `${r.text}${bits.length ? ` (${bits.join(", ")})` : ""}${note}`;
  };

  const fromNote = recipient === sender ? "" : `Sent from Sorted by ${sender}.`;
  const text =
    `${title}\n\n${rows.map((r, i) => `  ${i + 1}. ${lineFor(r)}`).join("\n")}` +
    (fromNote ? `\n\n${fromNote}` : "");
  const html =
    `<h3>${escapeHtml(title)}</h3><ol>${rows
      .map((r) => `<li>${escapeHtml(lineFor(r))}</li>`)
      .join("")}</ol>` + (fromNote ? `<p>${escapeHtml(fromNote)}</p>` : "");

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: gmailAddress, pass: gmailAppPassword },
  });

  try {
    await transporter.sendMail({
      from: `"Sorted" <${gmailAddress}>`,
      to: recipient,
      subject: title,
      text,
      html,
    });
  } catch {
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
