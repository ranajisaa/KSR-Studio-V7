# KSR Studio V8 — Veo 3.1 Image-to-Video

This version replaces the previous raw REST request with the official `@google/genai` JavaScript SDK image input shape.

## Render
- Build: `npm install`
- Start: `npm start`
- Environment variable: `GEMINI_API_KEY`
- Optional: `VEO_MODEL=veo-3.1-generate-preview`

## Local
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Put your Gemini API key in `.env`.
4. Run `npm install` then `npm start`.
5. Open the URL shown by the server.

Never commit `.env` or expose the API key in browser code.
