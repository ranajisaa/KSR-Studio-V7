# KSR Studio V7

KSR Studio V7 is a local image-to-video web app using Google's Gemini API with Veo 3.1.

## Current build

- Image-to-video
- 9:16 portrait / 16:9 landscape
- 720p
- Veo 3.1
- Long-running generation + polling
- Video preview
- MP4 download
- API key kept server-side
- `.env` ignored by Git

## Quick start

1. Install Node.js 18+.
2. Open this folder in a terminal.
3. Run `npm install`
4. Run `npm run setup`
5. Paste your Gemini API key when asked.
6. Run `npm start`
7. Open `http://localhost:3000`

The only account-side requirement is a valid Gemini API key with access/billing appropriate for Veo.

## Important

Do NOT put your API key in `public/index.html`, GitHub, screenshots, or chat messages.

The image-to-video UI uses 8 seconds because the current Veo 3.1 API requires 8 seconds when using image input/reference-image generation. Text-to-video can support 4/6/8 seconds depending on model/configuration.

Official documentation:
https://ai.google.dev/gemini-api/docs/veo
https://ai.google.dev/gemini-api/docs/api-key
