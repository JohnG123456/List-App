import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * One box, one microphone, four things it can mean.
 *
 * Everything the user says or types comes through here, and Claude decides
 * whether it is new items, a change to something already on a list, a question
 * to answer, or an action to run. The caller shows a receipt for whichever it
 * was, so a wrong guess costs one tap rather than going unnoticed.
 */

// Enough recent items for Claude to match "we're up to episode six of
// Severance" or "have we watched Ripley" against, without sending the whole
// history of every shop.
const ITEM_CONTEXT_LIMIT = 300;

const ROUTE_TOOL: Anthropic.Tool = {
  name: "route_capture",
  description:
    "Record what the person meant. Always call this exactly once. Fields that " +
    "do not apply to the chosen intent must be sent empty.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: ["add", "update", "ask", "do"],
        description:
          "add: new things to put on a list. update: a change to an item that " +
          "already exists, such as the episode they are up to. ask: a question " +
          "about what is on the lists, answered rather than stored. do: an " +
          "action to run, such as reading a list aloud or emailing it.",
      },
      items: {
        type: "array",
        description: "For intent 'add' only. One entry per distinct thing.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", description: "Short and plain, no filler words." },
            list_id: { type: "string", description: "The id of the list it belongs on." },
            qty: { type: "string", description: "Grocery quantity such as 2L or 1kg. Empty if none." },
            aisle: { type: "string", description: "Supermarket section, from the household's aisle order. Empty for non-grocery items." },
            service: { type: "string", description: "Streaming service, exactly as spelled in the household's service list. Empty if not known or not a show." },
            progress: { type: "string", description: "Season and episode, e.g. S1 E1. Empty if unknown." },
            profile: { type: "string", description: "Viewing profile, from the household's profiles. Empty if unknown." },
            suggested_by: { type: "string", description: "Who recommended it, if they said. Empty otherwise." },
          },
          required: ["text", "list_id", "qty", "aisle", "service", "progress", "profile", "suggested_by"],
        },
      },
      updates: {
        type: "array",
        description: "For intent 'update' only. Leave a field empty to keep what is already there.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_id: { type: "string", description: "The id of the existing item." },
            text: { type: "string", description: "New wording, or empty to leave alone." },
            qty: { type: "string", description: "New quantity, or empty to leave alone." },
            service: { type: "string", description: "New service, or empty to leave alone." },
            progress: { type: "string", description: "New season and episode, or empty to leave alone." },
            profile: { type: "string", description: "New profile, or empty to leave alone." },
            done: {
              type: "string",
              enum: ["done", "not_done", "unchanged"],
              description: "Whether this ticks the item off.",
            },
          },
          required: ["item_id", "text", "qty", "service", "progress", "profile", "done"],
        },
      },
      answer: {
        type: "string",
        description:
          "For intent 'ask' only. One or two sentences in plain speech, since it " +
          "may be read aloud. Say what the lists actually show, including the " +
          "service and whose profile when the question is about a show. If " +
          "nothing matches, say so plainly and note that anything watched before " +
          "this app existed will not be on the list.",
      },
      action_type: {
        type: "string",
        enum: ["read_aloud", "email", "none"],
        description: "For intent 'do' only. 'none' for every other intent.",
      },
      action_list_ids: {
        type: "array",
        description:
          "Which lists the action applies to. Empty means the list on screen.",
        items: { type: "string" },
      },
      needs_confirmation: {
        type: "boolean",
        description:
          "True when the action sends something to another person or cannot be " +
          "undone, so the app should ask before running it.",
      },
    },
    required: [
      "intent",
      "items",
      "updates",
      "answer",
      "action_type",
      "action_list_ids",
      "needs_confirmation",
    ],
  },
};

type ToolInput = {
  intent: "add" | "update" | "ask" | "do";
  items: Array<Record<string, string>>;
  updates: Array<Record<string, string>>;
  answer: string;
  action_type: "read_aloud" | "email" | "none";
  action_list_ids: string[];
  needs_confirmation: boolean;
};

/** Empty strings from the tool mean "not set", which the database wants as null. */
function orNull(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const text: unknown = body?.text;
  const activeGroup: string | null = body?.activeGroup ?? null;

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  // Row-level security scopes both of these to lists this user can actually
  // see, so a private list never reaches the prompt for anyone else.
  const [listsResult, householdResult, itemsResult] = await Promise.all([
    supabase
      .from("lists")
      .select("id, name, group_name, kind, group_by, is_archive, position")
      .order("position", { ascending: true }),
    supabase
      .from("households")
      .select("services, profiles, aisle_order")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("items")
      .select("id, list_id, text, done, service, progress, profile, qty")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(ITEM_CONTEXT_LIMIT),
  ]);

  if (listsResult.error) {
    return NextResponse.json({ error: listsResult.error.message }, { status: 500 });
  }

  const lists = listsResult.data ?? [];
  if (lists.length === 0) {
    return NextResponse.json(
      { error: "No lists yet — run the household migration first." },
      { status: 409 }
    );
  }

  const household = householdResult.data;
  const items = itemsResult.data ?? [];

  const anthropic = new Anthropic({ apiKey });

  const system = [
    "You sort what someone says into their household lists. Be decisive: pick a",
    "list for every item rather than asking. Keep item text short and plain.",
    "",
    "The lists, with the id to use:",
    ...lists.map(
      (l) =>
        `- ${l.id} — "${l.name}" (pill: ${l.group_name}, kind: ${l.kind}` +
        `${l.group_by ? `, grouped by ${l.group_by}` : ""}${l.is_archive ? ", archive" : ""})`
    ),
    "",
    household
      ? `Streaming services they pay for: ${household.services.join(", ")}. Use these spellings exactly, and leave the service empty rather than inventing one.`
      : "",
    household ? `Viewing profiles: ${household.profiles.join(", ")}.` : "",
    household
      ? `Supermarket sections, in walking order: ${household.aisle_order.join(", ")}.`
      : "",
    "",
    "Items already on the lists, for matching updates and answering questions:",
    ...items.map(
      (i) =>
        `- ${i.id} | ${i.text} | list ${i.list_id}${i.service ? ` | ${i.service}` : ""}` +
        `${i.progress ? ` | ${i.progress}` : ""}${i.profile ? ` | ${i.profile}'s profile` : ""}` +
        `${i.done ? " | finished" : ""}`
    ),
    "",
    activeGroup ? `They are currently looking at the "${activeGroup}" pill.` : "",
    "",
    "Choose the intent carefully. A sentence naming a show and an episode number",
    "is almost always an update to that show, not a new item. A question is an",
    "'ask' even when it names something that could be added.",
    "",
    "When adding, one entry per distinct thing, and never merge two things into",
    "one entry. People routinely say everything in a single breath, and one",
    "sentence usually carries items belonging to several different lists:",
    "\"we need milk, book the car service, and we started Severance on Netflix\"",
    "is three entries on three different lists, not one. Work through the whole",
    "sentence to the end and account for every thing mentioned in it.",
  ]
    .filter(Boolean)
    .join("\n");

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-opus-5",
      // Reasoning is on by default and its tokens come out of this budget, so
      // a tight ceiling truncates the tool call rather than the prose. A
      // truncated arrival looked exactly like "it only found one item".
      max_tokens: 16000,
      // This was set to low effort for latency and that was the wrong trade.
      // Low effort consolidates, and consolidating is precisely the failure
      // here: three unrelated things in one sentence came back as one item.
      output_config: { effort: "high" },
      system,
      tools: [ROUTE_TOOL],
      tool_choice: { type: "tool", name: "route_capture" },
      messages: [{ role: "user", content: text }],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Claude call failed: ${detail}` }, { status: 502 });
  }

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  // Running out of room mid-tool-call yields a partial answer that looks like
  // a confident short one. Say so instead of acting on half a sentence.
  if (message.stop_reason === "max_tokens") {
    console.error("[capture] hit max_tokens", { chars: text.length });
    return NextResponse.json(
      { error: "That was cut short before it finished. Try saying it again." },
      { status: 502 }
    );
  }

  if (!toolUse) {
    return NextResponse.json(
      { error: "Could not work out what that meant. Try rephrasing." },
      { status: 502 }
    );
  }

  const input = toolUse.input as ToolInput;

  console.log("[capture]", {
    chars: text.length,
    intent: input.intent,
    items: input.items?.length ?? 0,
    updates: input.updates?.length ?? 0,
    stop: message.stop_reason,
  });
  const validListIds = new Set(lists.map((l) => l.id));
  const validItemIds = new Set(items.map((i) => i.id));

  if (input.intent === "ask") {
    return NextResponse.json({ intent: "ask", answer: input.answer });
  }

  if (input.intent === "do") {
    return NextResponse.json({
      intent: "do",
      action: {
        type: input.action_type,
        list_ids: (input.action_list_ids ?? []).filter((id) => validListIds.has(id)),
        needs_confirmation: Boolean(input.needs_confirmation),
      },
    });
  }

  if (input.intent === "update") {
    const updates = (input.updates ?? [])
      .filter((u) => validItemIds.has(u.item_id))
      .map((u) => ({
        item_id: u.item_id,
        text: orNull(u.text),
        qty: orNull(u.qty),
        service: orNull(u.service),
        progress: orNull(u.progress),
        profile: orNull(u.profile),
        done: u.done === "done" ? true : u.done === "not_done" ? false : null,
      }));

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "Could not tell which item that was about." },
        { status: 422 }
      );
    }

    return NextResponse.json({ intent: "update", updates });
  }

  // Anything reaching here is an add. A hallucinated list id would fail the
  // insert anyway, so fall back to the first list rather than dropping it.
  const fallbackListId = lists[0].id;
  const newItems = (input.items ?? [])
    .filter((i) => typeof i.text === "string" && i.text.trim().length > 0)
    .map((i) => ({
      text: i.text.trim(),
      list_id: validListIds.has(i.list_id) ? i.list_id : fallbackListId,
      qty: orNull(i.qty),
      aisle: orNull(i.aisle),
      service: orNull(i.service),
      progress: orNull(i.progress),
      profile: orNull(i.profile),
      suggested_by: orNull(i.suggested_by),
    }));

  if (newItems.length === 0) {
    return NextResponse.json(
      { error: "Nothing to add was found in that." },
      { status: 422 }
    );
  }

  return NextResponse.json({ intent: "add", items: newItems });
}
