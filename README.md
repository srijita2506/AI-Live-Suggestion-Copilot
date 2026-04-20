# TwinMind

A Next.js meeting copilot prototype for the TwinMind live suggestions assignment.

**Live Demo:** [AI Live Suggestion Copilot](https://ai-live-suggestion-copilot.onrender.com/)

## What It Does

- Records live microphone audio in the browser
- Transcribes audio chunks with Groq `whisper-large-v3`
- Generates exactly 3 live suggestions per refresh with Groq `openai/gpt-oss-120b`
- Lets users click a suggestion to get a more detailed answer in the chat panel
- Supports direct user chat questions in the same session
- Exports transcript, suggestion batches, and chat history with timestamps
- Stores API key, prompts, and context settings locally in the browser

## Assignment Alignment

- Left column: mic controls and chunked transcript
- Middle column: live suggestions with newest batch on top and older batches preserved
- Right column: one continuous session chat
- Manual refresh: flushes the current in-progress audio chunk, waits for transcription, then refreshes suggestions
- Automatic flow: transcript updates on each chunk and suggestions refresh immediately from the newest transcript context
- Models:
  - Transcription: `whisper-large-v3`
  - Suggestions: `openai/gpt-oss-120b`
  - Chat and expanded answers: `openai/gpt-oss-120b`

## Prompt Strategy

The app exposes 3 editable prompts in Settings:

- Live suggestions prompt
- Detailed answer prompt for clicked suggestions
- Chat prompt for user-typed questions

The default live suggestion prompt is optimized for:

- timing-sensitive suggestions
- variety across question, talking point, fact-check, answer, and clarifying info
- short previews that are useful even before click
- exactly 3 non-overlapping suggestions

The detailed-answer and chat prompts are separated because clicked suggestions and direct chat questions are different user intents. Clicked suggestions should expand a suggestion that already exists, while typed chat should behave more like an active copilot answer.

## Context Windows

Settings lets you edit:

- live suggestion transcript window
- expanded answer transcript window
- chat transcript window
- refresh interval

The defaults are intentionally small to keep latency low while still passing enough local context for live usefulness.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Groq API

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Open `http://localhost:3000`

4. Open `Settings` and paste your Groq API key.

## Export Format

The session export is JSON and includes:

- transcript entries with timestamps
- suggestion batches with timestamps
- chat history with timestamps
- current settings snapshot with the API key redacted

## Tradeoffs

- API keys are stored in browser `localStorage` because the assignment asks users to paste their own key and does not require authentication.
- Suggestion parsing still uses JSON text parsing from the model response, but the server now rejects any batch that is not exactly 3 items.
- The app is optimized for assignment clarity and prompt iteration rather than production-grade persistence or collaboration features.
