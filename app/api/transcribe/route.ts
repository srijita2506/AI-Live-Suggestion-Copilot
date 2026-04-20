import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const groqApiKey = request.headers.get("x-groq-api-key");

    if (!groqApiKey) {
      return NextResponse.json(
        { error: "Missing Groq API key." },
        { status: 400 },
      );
    }

    const incoming = await request.formData();
    const audio = incoming.get("audio");
    const model = incoming.get("model");
    const language = incoming.get("language");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Missing audio file." },
        { status: 400 },
      );
    }

    const upstreamBody = new FormData();
    upstreamBody.append("file", audio, audio.name || "chunk.webm");
    upstreamBody.append(
      "model",
      typeof model === "string" ? model : "whisper-large-v3",
    );

    if (typeof language === "string" && language.trim()) {
      upstreamBody.append("language", language);
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: upstreamBody,
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            typeof data?.error?.message === "string"
              ? data.error.message
              : "Groq transcription failed.",
        },
        { status: response.status },
      );
    }

    return NextResponse.json({
      text: typeof data?.text === "string" ? data.text : "",
    });
  } catch {
    return NextResponse.json(
      { error: "Unexpected transcription error." },
      { status: 500 },
    );
  }
}
