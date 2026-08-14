import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@/lib/supabase/server";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function POST() {
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
      { error: "Server is missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD" },
      { status: 500 }
    );
  }

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("text")
    .eq("done", false)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const openTasks = tasks ?? [];

  const text =
    openTasks.length === 0
      ? "You have no open tasks."
      : openTasks.map((t, i) => `${i + 1}. ${t.text}`).join("\n");

  const html =
    openTasks.length === 0
      ? "<p>You have no open tasks.</p>"
      : `<ol>${openTasks
          .map((t) => `<li>${escapeHtml(t.text)}</li>`)
          .join("")}</ol>`;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: gmailAddress, pass: gmailAppPassword },
  });

  try {
    await transporter.sendMail({
      from: `"Voice Task List" <${gmailAddress}>`,
      to: user.email,
      subject: "Your task list",
      text,
      html,
    });
  } catch {
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
