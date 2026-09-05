import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * "What should we watch tonight?"
 *
 * Only ever picks from titles already on the want list. Recommending something
 * new would mean knowing what is on Stan this month, which changes constantly
 * and is not something this can know reliably — a confident suggestion for
 * something that left the service six months ago is worse than no suggestion.
 */

const PICK_TOOL: Anthropic.Tool = {
  name: "record_picks",
  description: "Record which saved titles to suggest, and why each one.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      picks: {
        type: "array",
        description: "Two suggestions, or one if there is only one sensible option.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_id: { type: "string", description: "The id of the title being suggested." },
            reason: {
              type: "string",
              description:
                "One sentence on why tonight, in plain speech. Mention length, " +
                "service, or effort required — something that actually helps " +
                "them choose, not a plot summary.",
            },
          },
          required: ["item_id", "reason"],
        },
      },
    },
    required: ["picks"],
  },
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  let listIds: string[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body?.listIds)) {
      listIds = body.listIds.filter((id: unknown) => typeof id === "string");
    }
  } catch {
    // No body is fine; fall back to every watch list below.
  }

  const [listsResult, householdResult] = await Promise.all([
    supabase.from("lists").select("id, name, kind, is_archive").eq("kind", "watch"),
    supabase.from("households").select("services").limit(1).maybeSingle(),
  ]);

  if (listsResult.error) {
    return NextResponse.json({ error: listsResult.error.message }, { status: 500 });
  }

  const watchLists = (listsResult.data ?? []).filter((l) => !l.is_archive);
  const chosen = listIds.length
    ? watchLists.filter((l) => listIds.includes(l.id))
    : watchLists;

  if (chosen.length === 0) {
    return NextResponse.json({ error: "No watchlist to pick from" }, { status: 409 });
  }

  const { data: candidates, error: itemsError } = await supabase
    .from("items")
    .select("id, text, service, progress, profile, suggested_by, list_id")
    .in(
      "list_id",
      chosen.map((l) => l.id)
    )
    .eq("done", false)
    .is("archived_at", null);

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const options = candidates ?? [];
  if (options.length === 0) {
    return NextResponse.json(
      { error: "Nothing saved to watch yet. Add a few titles first." },
      { status: 409 }
    );
  }

  const services = householdResult.data?.services ?? [];
  const listName = new Map(chosen.map((l) => [l.id, l.name]));

  const anthropic = new Anthropic({ apiKey });

  const system = [
    "Pick what this household should watch tonight, from the titles they have",
    "already saved. Suggest two, or one if there is genuinely only one sensible",
    "option. Never invent a title that is not in the list below.",
    "",
    services.length
      ? `They subscribe to: ${services.join(", ")}. Prefer something they can actually watch, and say so when a title has no service recorded.`
      : "",
    "",
    "Saved titles:",
    ...options.map(
      (o) =>
        `- ${o.id} | ${o.text} | ${listName.get(o.list_id) ?? "list"}` +
        `${o.service ? ` | ${o.service}` : " | service not recorded"}` +
        `${o.progress ? ` | up to ${o.progress}` : ""}` +
        `${o.suggested_by ? ` | suggested by ${o.suggested_by}` : ""}`
    ),
    "",
    "Something already part-watched is a strong pick: they can carry on rather",
    "than commit to something new. A film suits a night with less time left than",
    "the start of a series does.",
  ]
    .filter(Boolean)
    .join("\n");

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system,
      tools: [PICK_TOOL],
      tool_choice: { type: "tool", name: "record_picks" },
      messages: [{ role: "user", content: "What should we watch tonight?" }],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Claude call failed: ${detail}` }, { status: 502 });
  }

  if (message.stop_reason === "max_tokens") {
    return NextResponse.json(
      { error: "That was cut short before it finished. Try again." },
      { status: 502 }
    );
  }

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUse) {
    return NextResponse.json({ error: "No suggestion came back." }, { status: 502 });
  }

  const raw = (toolUse.input as { picks?: Array<{ item_id: string; reason: string }> })
    .picks ?? [];

  // A suggestion for something not on the list is worse than no suggestion, so
  // anything that doesn't match a saved title is dropped rather than shown.
  const byId = new Map(options.map((o) => [o.id, o]));
  const picks = raw
    .filter((p) => byId.has(p.item_id))
    .map((p) => {
      const item = byId.get(p.item_id)!;
      return {
        item_id: item.id,
        text: item.text,
        service: item.service,
        reason: p.reason,
      };
    });

  if (picks.length === 0) {
    return NextResponse.json(
      { error: "Nothing came back that matched your list. Try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ picks });
}
