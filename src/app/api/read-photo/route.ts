import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads a photographed list — the one on the fridge, a recipe page, a receipt —
 * into plain text, which then goes through the normal capture box rather than
 * straight onto a list. Someone else's handwriting is the least reliable input
 * here, so it gets a look before it becomes rows.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

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

  const data = Buffer.from(await photo.arrayBuffer()).toString("base64");
  const anthropic = new Anthropic({ apiKey });

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            {
              type: "text",
              text:
                "Read the list in this photo and write it out as one line per " +
                "item, separated by commas. Keep the wording as written, " +
                "including quantities. Don't add anything that isn't there, " +
                "and don't guess at words you can't read — leave those out. " +
                "Reply with the items only, no preamble.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Claude call failed: ${detail}` }, { status: 502 });
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .trim();

  if (!text) {
    return NextResponse.json(
      { error: "Nothing readable in that photo." },
      { status: 422 }
    );
  }

  return NextResponse.json({ text });
}
