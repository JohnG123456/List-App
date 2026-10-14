import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { WEEKDAYS } from "@/lib/display";
import { modelFor } from "@/lib/models";

/**
 * "Which day do new episodes come out?" for every show on the TV lists.
 *
 * Unlike capture, this one is allowed to fill in a day nobody said, because it
 * looks it up rather than remembering it: Claude searches the web for each
 * show's current schedule in Australia. Anything it can't confirm comes back
 * as unknown and is left alone, and the app shows what changed with an undo.
 */

// A web search per show adds up; the default function limit cuts it short.
export const maxDuration = 300;

// Shows per request. The app calls this repeatedly until nothing is due, and
// saves each batch as it comes back, so a batch small enough to finish well
// inside maxDuration on Opus means a timeout only ever loses one batch.
const BATCH_SIZE = 5;

const RECORD_TOOL: Anthropic.Beta.BetaTool = {
  name: "record_release_days",
  description:
    "Record where each show's current season is up to, once for every show asked about.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      shows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_id: { type: "string", description: "The id of the show, as given." },
            status: {
              type: "string",
              enum: ["weekly", "all_released", "not_out", "unknown"],
              description:
                "weekly: a season is releasing an episode a week right now, or " +
                "starts within the next few weeks. all_released: every episode " +
                "of the latest season is out, whether it dropped at once or " +
                "finished airing. not_out: a film, or nothing has been released " +
                "yet. unknown: the search did not settle it.",
            },
            airs_on: {
              type: "string",
              enum: [...WEEKDAYS, ""],
              description:
                "For weekly only, the weekday a new episode becomes available " +
                "in Australia. Empty otherwise.",
            },
            service: {
              type: "string",
              description:
                "Only for a show with no service given: which of the household's " +
                "services it streams on in Australia, spelled exactly as listed. " +
                "Empty when a service was given, or it isn't on any of theirs.",
            },
            latest_episode: {
              type: "string",
              description:
                "The newest episode available in Australia today, as S<season> " +
                "E<episode>, e.g. \"S2 E5\". For all_released, the season's last " +
                "episode. Empty if none is out yet or you could not confirm it.",
            },
            note: {
              type: "string",
              description:
                "A few words on what was found, e.g. \"Season 3 weekly on Apple TV+\" " +
                "or \"Season 2 dropped all at once\".",
            },
          },
          required: ["item_id", "status", "airs_on", "service", "latest_episode", "note"],
        },
      },
    },
    required: ["shows"],
  },
};

type Finding = {
  item_id: string;
  status: string;
  airs_on: string;
  service: string;
  latest_episode: string;
  note: string;
};

const STATUSES = new Set(["weekly", "all_released", "not_out", "unknown"]);

export async function POST(request: Request) {
  // Shows the app has already sent this run, so a show whose result couldn't
  // be saved isn't asked about again in a loop.
  let exclude = new Set<string>();
  try {
    const body = await request.json();
    if (Array.isArray(body?.exclude)) {
      exclude = new Set(body.exclude.filter((id: unknown) => typeof id === "string"));
    }
  } catch {
    // No body is fine: nothing to exclude.
  }

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

  const [{ data: lists, error: listsError }, { data: household }] = await Promise.all([
    supabase.from("lists").select("id, kind, is_archive").eq("kind", "watch"),
    // "*" so a database without migration 0010's model column still answers.
    supabase.from("households").select("*").limit(1).maybeSingle(),
  ]);

  // Chosen in Settings, Opus 5.5 by default. Haiku only has the basic web
  // search, which reads results as they come, and no server-side fallback;
  // the larger models get the search that filters results first, and a
  // fallback model if a request is declined.
  const model = modelFor("releaseDays", household);
  const isHaiku = model.startsWith("claude-haiku");
  const services: string[] = household?.services ?? [];

  if (listsError) {
    return NextResponse.json({ error: listsError.message }, { status: 500 });
  }

  // Watched is history; only what they're watching or want to watch matters.
  const listIds = (lists ?? []).filter((l) => !l.is_archive).map((l) => l.id);
  if (listIds.length === 0) {
    return NextResponse.json({ error: "No TV list to look up" }, { status: 409 });
  }

  const { data: allShows, error: itemsError } = await supabase
    .from("items")
    // "*" so a database without migration 0010's release_checked_at still
    // answers; every show then counts as never checked.
    .select("*")
    .in("list_id", listIds)
    .eq("done", false)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  if (!allShows || allShows.length === 0) {
    return NextResponse.json(
      { error: "No shows on the list to look up yet." },
      { status: 409 }
    );
  }

  // Each search costs money, so a show is only looked up when its details
  // could have changed since the last time.
  const now = new Date();
  const shows: {
    id: string;
    text: string;
    service: string | null;
    progress: string | null;
  }[] = allShows.filter((show) => isDue(show, now) && !exclude.has(show.id));
  const upToDate = allShows.length - shows.length - exclude.size;
  // What's left after this batch, for the app to decide whether to ask again.
  const remaining = Math.max(shows.length - BATCH_SIZE, 0);
  shows.splice(BATCH_SIZE);

  if (shows.length === 0) {
    return NextResponse.json({ results: [], upToDate, remaining: 0 });
  }

  const today = new Date().toLocaleDateString("en-AU", {
    timeZone: "Australia/Perth",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const system = [
    "You find out where TV shows' current seasons are up to, for",
    "a household in Perth, Western Australia. Use web search; schedules change",
    "every season, so don't rely on memory.",
    "",
    `Today is ${today}.`,
    "",
    "For each show, work out on the service given and in Australia:",
    "- whether a season is releasing weekly right now (or starts within the",
    "  next few weeks), or every episode of the latest season is already out;",
    "- if weekly, the weekday a new episode becomes available;",
    "- the newest episode available today.",
    "Australian streaming releases often land a day after the US because of the",
    "time difference, so prefer an Australian source or convert the US release",
    "time to Perth time, including for which episode is out as of today.",
    "",
    services.length
      ? `Their streaming services: ${services.join(", ")}. For a show with no ` +
        "service given, also find which of these it streams on in Australia."
      : "",
    "",
    "Answer \"unknown\" when you can't confirm it, and leave latest_episode",
    "empty rather than estimating it. A wrong answer is worse than none.",
    "",
    "When you have looked up every show, call record_release_days once with an",
    "entry for each of them.",
  ].join("\n");

  const showList = shows
    .map(
      (s) =>
        `- ${s.id} | ${s.text}` +
        `${s.service ? ` | watched on ${s.service}` : " | service not known"}` +
        `${s.progress ? ` | they are up to ${s.progress}` : ""}`
    )
    .join("\n");

  const anthropic = new Anthropic({ apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Which day do new episodes of these come out?\n\n${showList}` },
  ];

  let message: Anthropic.Beta.BetaMessage | null = null;
  try {
    // Web search runs a loop on Anthropic's side that can pause part way;
    // sending the paused turn back carries on from where it stopped.
    for (let round = 0; round < 4; round++) {
      message = await anthropic.beta.messages.create({
        model,
        max_tokens: 16000,
        ...(isHaiku
          ? {}
          : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        output_config: { effort: "medium" },
        system,
        tools: [
          {
            type: isHaiku ? "web_search_20250305" : "web_search_20260209",
            name: "web_search",
            max_uses: Math.min(shows.length * 2, 30),
            user_location: {
              type: "approximate",
              city: "Perth",
              region: "Western Australia",
              country: "AU",
              timezone: "Australia/Perth",
            },
          },
          RECORD_TOOL,
        ],
        tool_choice: { type: "auto" },
        messages,
      });

      if (message.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: message.content });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Claude call failed: ${detail}` }, { status: 502 });
  }

  if (message?.stop_reason === "refusal") {
    return NextResponse.json({ error: "Claude declined to look those up." }, { status: 502 });
  }

  const toolUse = message?.content.find(
    (block): block is Anthropic.Beta.BetaToolUseBlock =>
      block.type === "tool_use" && block.name === "record_release_days"
  );

  if (!toolUse) {
    return NextResponse.json(
      { error: "The lookup didn't finish. Try again." },
      { status: 502 }
    );
  }

  const raw = (toolUse.input as { shows?: Finding[] }).shows ?? [];
  const byId = new Map(shows.map((s) => [s.id, s]));

  // Only answers about shows that were asked about, in a shape the database
  // accepts, get back to the app. A weekday only means something for a show
  // still releasing weekly, so it is dropped for anything else.
  const results = raw
    .filter((r) => byId.has(r.item_id) && STATUSES.has(r.status))
    .map((r) => {
      const weekly = r.status === "weekly" && WEEKDAYS.includes(r.airs_on);
      // A service is only ever filled in, never changed, and only to one of
      // the household's own, in the household's spelling.
      const service = byId.get(r.item_id)!.service
        ? null
        : (services.find((s) => s.toLowerCase() === r.service.trim().toLowerCase()) ?? null);
      return {
        item_id: r.item_id,
        text: byId.get(r.item_id)!.text,
        status: r.status === "weekly" && !weekly ? "unknown" : r.status,
        airs_on: weekly ? r.airs_on : null,
        service,
        latest_episode: normaliseEpisode(r.latest_episode),
        all_released: r.status === "all_released",
        note: r.note,
      };
    });

  return NextResponse.json({ results, upToDate, remaining });
}

/** "s2e5", "S2 E5" and "Season 2 Episode 5" all become "S2 E5"; anything else is dropped. */
function normaliseEpisode(value: string) {
  const match = value.match(/s(?:eason)?\s*(\d+)\D*?e(?:p(?:isode)?)?\.?\s*(\d+)/i);
  return match ? `S${Number(match[1])} E${Number(match[2])}` : null;
}

/** A date as YYYY-MM-DD in Perth, so "a new day" means a new day there. */
function perthDate(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Australia/Perth" });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a show is worth searching for again.
 *
 * - Never checked, or checked before this existed: yes.
 * - Releasing weekly: once its release day has come round since the check,
 *   because that's when the latest episode moves on.
 * - Whole season out: monthly, to catch a new season being announced.
 * - Anything else (not out yet, couldn't confirm, details missing): weekly.
 */
function isDue(
  show: {
    release_checked_at?: string | null;
    airs_on?: string | null;
    all_released?: boolean;
    latest_episode?: string | null;
  },
  now: Date
) {
  if (!show.release_checked_at) return true;
  const checked = new Date(show.release_checked_at);
  const age = now.getTime() - checked.getTime();

  const day = show.airs_on ? WEEKDAYS.indexOf(show.airs_on) : -1;
  if (day >= 0) {
    // Walk back from today (Perth) to the most recent release day.
    const today = new Date(`${perthDate(now)}T00:00:00Z`);
    const todayIndex = (today.getUTCDay() + 6) % 7;
    const back = (todayIndex - day + 7) % 7;
    const lastRelease = new Date(today.getTime() - back * DAY_MS)
      .toISOString()
      .slice(0, 10);
    return lastRelease > perthDate(checked);
  }

  if (show.all_released && show.latest_episode) return age > 30 * DAY_MS;
  return age > 7 * DAY_MS;
}
