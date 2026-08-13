import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

const SPLIT_TASKS_TOOL: Anthropic.Tool = {
  name: "record_tasks",
  description: "Record the individual to-do items extracted from the text.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "Each distinct task as a short, actionable line.",
      },
    },
    required: ["tasks"],
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

  const { text } = await request.json();
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

  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    tools: [SPLIT_TASKS_TOOL],
    tool_choice: { type: "tool", name: "record_tasks" },
    messages: [
      {
        role: "user",
        content: `Split the following dictated text into a clean list of separate to-do items. Keep each task short and actionable, remove filler words, and don't merge unrelated items.\n\n"""\n${text}\n"""`,
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  const tasks =
    toolUse && Array.isArray((toolUse.input as { tasks?: unknown }).tasks)
      ? ((toolUse.input as { tasks: unknown[] }).tasks.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0
        ))
      : [];

  return NextResponse.json({ tasks });
}
