import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, isHouseholdMember } from "@/lib/supabase/server";
import { modelFor } from "@/lib/models";

/**
 * Reads a photo of a streaming app's Continue Watching row (the TV screen, or
 * a screenshot from a phone) and says which episode each show is on.
 *
 * Only reports: the app decides what to change, refuses to wind a show back,
 * and shows a receipt with undo. Shows the photo has but the lists don't come
 * back by name, so nothing is added without asking.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_progress",
  description:
    "Record which episode each show in the photo is on. Always call this exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      shows: {
        type: "array",
        description:
          "One entry per show in the photo that is on their lists AND has a " +
          "season and episode visible on screen.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_id: { type: "string", description: "The id of the show on their lists." },
            season: { type: "integer", description: "Season number shown on screen." },
            episode: { type: "integer", description: "Episode number shown on screen." },
          },
          required: ["item_id", "season", "episode"],
        },
      },
      not_on_lists: {
        type: "array",
        description: "Titles of series in the photo that are not on their lists.",
        items: { type: "string" },
      },
    },
    required: ["shows", "not_on_lists"],
  },
};

type RecordInput = {
  shows: { item_id: string; season: number; episode: number }[];
  not_on_lists: string[];
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isHouseholdMember(supabase, user.id))) {
    return NextResponse.json({ error: "Not part of a household" }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  const form = await request.formData();
  const photo = form.get("photo");

  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "No photo was sent" }, { status: 400 });
  }
  if (photo.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That photo is too large. Try a smaller one." },
      { status: 413 }
    );
  }
  const mediaType = photo.type as (typeof ALLOWED)[number];
  if (!ALLOWED.includes(mediaType)) {
    return NextResponse.json(
      { error: "That file type isn't supported. Use a photo." },
      { status: 415 }
    );
  }

  // Row-level security keeps this to lists this person can see.
  const [listsResult, householdResult] = await Promise.all([
    supabase.from("lists").select("id, is_archive").eq("kind", "watch"),
    supabase.from("households").select("*").limit(1).maybeSingle(),
  ]);
  if (listsResult.error) {
    return NextResponse.json({ error: listsResult.error.message }, { status: 500 });
  }
  const listIds = (listsResult.data ?? []).filter((l) => !l.is_archive).map((l) => l.id);
  if (listIds.length === 0) {
    return NextResponse.json({ error: "No TV list to update." }, { status: 409 });
  }

  const { data: shows, error: showsError } = await supabase
    .from("items")
    .select("id, text, service, progress")
    .in("list_id", listIds)
    .eq("done", false)
    .is("archived_at", null);
  if (showsError) {
    return NextResponse.json({ error: showsError.message }, { status: 500 });
  }
  if (!shows || shows.length === 0) {
    return NextResponse.json({ error: "No shows on your lists yet." }, { status: 409 });
  }

  const data = Buffer.from(await photo.arrayBuffer()).toString("base64");
  const anthropic = new Anthropic({ apiKey });
  const model = modelFor("readPhoto", householdResult.data);
  const started = Date.now();

  const system = [
    "The photo shows a streaming app's Continue Watching row or similar, on a",
    "TV or a phone. For each show in it, read the season and episode it is on",
    "from what is written on screen, such as \"S2:E5\" or \"Season 2, Episode 5\".",
    "Never work it out from a progress bar or from what you know about the show.",
    "A show with no season and episode written on screen is left out.",
    "",
    "Match each show to one on their lists below by title. Allow for small",
    "differences (\"The\" dropped, a year added), but leave out anything you",
    "are not sure is the same show.",
    "",
    "Their shows:",
    ...shows.map(
      (s) =>
        `- ${s.id} | ${s.text}${s.service ? ` | ${s.service}` : ""}` +
        `${s.progress ? ` | up to ${s.progress}` : ""}`
    ),
  ].join("\n");

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      system,
      tools: [RECORD_TOOL],
      tool_choice: { type: "tool", name: "record_progress" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: "Which episode is each show on?" },
          ],
        },
      ],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Claude call failed: ${detail}` }, { status: 502 });
  }

  const via = { model, ms: Date.now() - started };

  if (message.stop_reason === "max_tokens") {
    return NextResponse.json(
      { error: "That was cut short before it finished. Try again.", via },
      { status: 502 }
    );
  }

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    return NextResponse.json(
      { error: "Couldn't read any shows from that photo.", via },
      { status: 502 }
    );
  }

  const input = toolUse.input as RecordInput;
  const validIds = new Set(shows.map((s) => s.id));
  const found = (input.shows ?? []).filter(
    (s) => validIds.has(s.item_id) && s.season > 0 && s.episode > 0
  );

  return NextResponse.json({
    shows: found,
    not_on_lists: (input.not_on_lists ?? []).filter((t) => typeof t === "string" && t.trim()),
    via,
  });
}
