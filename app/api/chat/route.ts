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

    const body = (await request.json()) as {
      model?: string;
      mode?: "detail" | "chat";
      prompt?: string;
      question?: string;
      transcript?: string;
    };

    if (!body.question?.trim()) {
      return NextResponse.json(
        { error: "Missing question." },
        { status: 400 },
      );
    }

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
          temperature: 0.4,
          stream: true,
          messages: [
            {
              role: "system",
              content:
                body.prompt?.trim() ||
                (body.mode === "detail"
                  ? "You are a meeting copilot. The user clicked a live suggestion and wants a more detailed answer grounded in the supplied meeting transcript. Be concrete, helpful, and concise. If the transcript is insufficient, say what is missing instead of inventing facts."
                  : "You are a meeting copilot. Answer the user's question using only the supplied meeting transcript context. Be concrete, helpful, and concise. If the transcript is insufficient, say what is missing instead of inventing facts."),
            },
            {
              role: "user",
              content: `Question:\n${body.question}\n\nMeeting transcript context:\n${body.transcript}`,
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const data = await response.json();

      return NextResponse.json(
        {
          error:
            typeof data?.error?.message === "string"
              ? data.error.message
              : "Detailed answer generation failed.",
        },
        { status: response.status },
      );
    }

    if (!response.body) {
      return NextResponse.json(
        { error: "Model returned an empty stream." },
        { status: 500 },
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";

            for (const event of events) {
              const lines = event.split("\n");

              for (const line of lines) {
                if (!line.startsWith("data: ")) {
                  continue;
                }

                const payload = line.slice(6).trim();

                if (payload === "[DONE]") {
                  controller.close();
                  return;
                }

                try {
                  const parsed = JSON.parse(payload) as {
                    choices?: Array<{
                      delta?: {
                        content?: string;
                      };
                    }>;
                  };

                  const chunk = parsed.choices?.[0]?.delta?.content;
                  if (chunk) {
                    controller.enqueue(encoder.encode(chunk));
                  }
                } catch {
                  // Ignore malformed SSE chunks and keep streaming.
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Unexpected chat error." },
      { status: 500 },
    );
  }
}
