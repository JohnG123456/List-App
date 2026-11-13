import type { Item, ItemUpdate } from "@/lib/types";

/**
 * Where you're up to in a show, from two sources that aren't the streaming
 * apps themselves: a photo of a Continue Watching row, and the viewing history
 * file Netflix lets each profile download.
 *
 * Both end up as ordinary progress updates, so they get the same receipt and
 * one-tap undo as anything said into the capture box.
 */

/** Season and episode from "S2 E5", "s2e5" or "Season 2 Episode 5". */
export function parseEpisode(progress: string | null | undefined) {
  if (!progress) return null;
  const match = progress.match(/s(?:eason)?\s*(\d+)\D*?e(?:p(?:isode)?)?\.?\s*(\d+)/i);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
}

export function formatEpisode(season: number, episode: number) {
  return `S${season} E${episode}`;
}

/**
 * True when `next` is further along than `current`, or there's nothing to
 * compare against. Another profile's history, or an old photo, should never
 * wind a show back.
 */
export function isAhead(current: string | null | undefined, next: string) {
  const was = parseEpisode(current);
  const now = parseEpisode(next);
  if (!was || !now) return true;
  if (now.season !== was.season) return now.season > was.season;
  return now.episode > was.episode;
}

/** An update that changes only where a show is up to. */
export function progressUpdate(itemId: string, progress: string): ItemUpdate {
  return {
    item_id: itemId,
    text: null,
    qty: null,
    service: null,
    progress,
    profile: null,
    due_on: null,
    done: null,
  };
}

// ------------------------------------------------------------------- Netflix

/** One show's most recent line in a Netflix viewing history file. */
export type NetflixLatest = {
  show: string;
  /** "Season 2", "Limited Series", "Part 1" — whatever Netflix wrote. */
  seasonLabel: string;
  season: number | null;
  episodeTitle: string;
  episode: number | null;
  watchedOn: string;
};

/** Just enough CSV for Netflix's two columns, quoted titles included. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

const SEASON_MARKER =
  /^(season|series|part|volume|vol\.?|book|chapter|collection|limited series|miniseries)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function numberIn(text: string) {
  const digits = text.match(/\d+/);
  if (digits) return Number(digits[0]);
  const word = text.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
  return word ? NUMBER_WORDS[word[1]] : null;
}

/**
 * Netflix writes "Show: Season 2: Episode Title". Splits that up, reading the
 * season number from the label and the episode number from the title when the
 * title is just "Episode 5". Lines with no season part are films, or a show's
 * only season, and are kept with no season.
 */
function splitTitle(title: string) {
  const parts = title.split(": ");
  const markerAt = parts.findIndex((part, i) => i > 0 && SEASON_MARKER.test(part));

  if (markerAt > 0) {
    const seasonLabel = parts[markerAt];
    const episodeTitle = parts.slice(markerAt + 1).join(": ");
    const episodeOnly = episodeTitle.match(/^(?:episode|ep\.?|chapter)\s*(\d+)$/i);
    return {
      show: parts.slice(0, markerAt).join(": "),
      seasonLabel,
      season: /limited series|miniseries/i.test(seasonLabel) ? 1 : numberIn(seasonLabel),
      episodeTitle,
      episode: episodeOnly ? Number(episodeOnly[1]) : null,
    };
  }

  return {
    show: parts.length > 1 ? parts[0] : title,
    seasonLabel: "",
    season: null,
    episodeTitle: parts.slice(1).join(": "),
    episode: null,
  };
}

/** Lowercase, no punctuation, no leading "the", no "(2022)". */
export function normaliseTitle(text: string) {
  return text
    .toLowerCase()
    .replace(/\(\d{4}\)/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/**
 * The latest line for every show in a Netflix history file. The file lists
 * newest first, so the first line seen for a show is where it's up to; that
 * also avoids reading dates, which Netflix writes in the account's locale.
 */
export function latestByShow(csv: string): NetflixLatest[] {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const titleAt = header.indexOf("title");
  const dateAt = header.indexOf("date");
  if (titleAt === -1) {
    throw new Error("That doesn't look like a Netflix viewing history file.");
  }

  const seen = new Map<string, NetflixLatest>();
  for (const row of rows.slice(1)) {
    const title = (row[titleAt] ?? "").trim();
    if (!title) continue;
    const parts = splitTitle(title);
    const key = normaliseTitle(parts.show);
    if (!key || seen.has(key)) continue;
    seen.set(key, { ...parts, watchedOn: dateAt === -1 ? "" : (row[dateAt] ?? "").trim() });
  }
  return [...seen.values()];
}

/**
 * Pairs Netflix history with the shows on the lists, by title. Exact after
 * tidying up, so "You" never lands on "Young Sheldon"; a near miss shows up
 * in the not-on-your-lists note instead of updating the wrong show.
 */
export function matchHistory(history: NetflixLatest[], shows: Item[]) {
  const byTitle = new Map<string, Item>();
  for (const show of shows) byTitle.set(normaliseTitle(show.text), show);

  const matched: { item: Item; latest: NetflixLatest }[] = [];
  const unmatched: NetflixLatest[] = [];
  for (const latest of history) {
    const item = byTitle.get(normaliseTitle(latest.show));
    if (item) matched.push({ item, latest });
    else unmatched.push(latest);
  }
  return { matched, unmatched };
}
