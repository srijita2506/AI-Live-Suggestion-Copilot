import { NextRequest, NextResponse } from "next/server";

type SuggestionType =
  | "QUESTION TO ASK"
  | "TALKING POINT"
  | "FACT-CHECK"
  | "ANSWER"
  | "CLARIFYING INFO";

type Suggestion = {
  type: SuggestionType;
  text: string;
};

function extractJsonArray(content: string): Suggestion[] | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as Suggestion[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const groqApiKey = request.headers.get("x-groq-api-key");

    if (!groqApiKey) {
      return NextResponse.json(
        { error: "Missing Groq API key." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      model?: string;
      prompt?: string;
      transcript?: string;
    };

    if (!body.transcript?.trim()) {
      return NextResponse.json(
        { error: "Missing transcript context." },
        { status: 400 },
      );
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: body.model || "openai/gpt-oss-120b",
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content:
                body.prompt?.trim() ||
                "You are a real-time meeting copilot. Return exactly 3 useful suggestions based only on the latest meeting transcript context. Each suggestion must be one of these types: QUESTION TO ASK, TALKING POINT, FACT-CHECK, ANSWER, CLARIFYING INFO. Respond with JSON only as an array of exactly 3 objects in the shape [{\"type\":\"QUESTION TO ASK\",\"text\":\"...\"}]. Keep each text concise, actionable, and under 160 characters.",
            },
            {
              role: "user",
              content: `Latest transcript context:\n${body.transcript}`,
            },
          ],
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            typeof data?.error?.message === "string"
              ? data.error.message
              : "Suggestion generation failed.",
        },
        { status: response.status },
      );
    }

    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Model returned an empty suggestions payload." },
        { status: 500 },
      );
    }

    const suggestions = extractJsonArray(content);

    if (!suggestions || suggestions.length !== 3) {
      return NextResponse.json(
        {
          error:
            "Could not parse an exact batch of 3 suggestions from the model response.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      suggestions,
    });
  } catch {
    return NextResponse.json(
      { error: "Unexpected suggestion error." },
      { status: 500 },
    );
  }
}
