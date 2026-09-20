# Umroo's Music Mixer

An AI playlist maker that turns plain-language intent into a Spotify-ready mix shaped around the listener's own history. The app is built with Next.js, Tailwind CSS, Convex, Vercel AI SDK, TypeSafe AI's Jev, a DeepSeek v4.1 Flash Modal endpoint, Spotify Web API, and Cloudflare Workers AI.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill the services you want to exercise.
3. Run the local Convex backend in one terminal with `npm run convex:dev`. Select a local deployment when prompted.
4. Run the app with `npm run dev` and open `http://127.0.0.1:3000`.

The demo flow works with no external credentials. It uses a seeded catalogue, local fit scoring, generated fallback cover art, and browser history. Provider credentials progressively enable Spotify taste data and saving, DeepSeek planning, Jev evaluation, Cloudflare cover generation, and durable Convex history.

Spotify requires the redirect URI to match exactly. Add `http://127.0.0.1:3000/api/auth/callback` to the app's allowlist; current Spotify guidance rejects `http://localhost` for local OAuth.

## The low-cost AI pipeline

The system deliberately avoids one large "make me a playlist" prompt:

1. **DeepSeek plans once.** A compact, schema-bound request extracts hard constraints, target energy, artist anchors, familiarity/discovery ratio, metadata, and a few Spotify search queries. The 15–200 quantity guard is also enforced in deterministic code.
2. **Spotify retrieves candidates.** Top tracks across three time ranges, recent plays, saved tracks, and tightly bounded search results form the pool. Audio features are best-effort enrichment because availability differs by Spotify quota mode.
3. **Jev decides in batches.** One shared compact state contains the request, plan, and 30 candidate summaries. Thirty typed boolean questions ask whether each indexed candidate belongs. That structure reuses the prompt context instead of paying for one request per track.
4. **Code assembles the mix.** Probability ranking, deduplication, anchor-artist weighting, familiarity quota, and artist-run sequencing are deterministic. Jev never invents songs and cannot bypass a hard constraint.
5. **Cover and save happen last.** Cloudflare SDXL-Lightning receives one short visual prompt. Sharp applies the black readability overlay, playlist name, and watermark, producing a Spotify-compatible JPEG. Spotify is only mutated when the listener approves the preview.

## Spotify API notes

- Tokens are encrypted into an HttpOnly, SameSite cookie and refreshed server-side.
- The app requests only taste, library, private playlist, and cover-upload scopes it uses.
- Tracks are added through the current `/playlists/{id}/items` endpoint in batches of 100.
- Spotify-sourced metadata is used transiently for the requested mix and is not used to train a model.
- This product creates playlists; it does not stream, alter, synchronize, or download Spotify audio.

## Useful commands

```text
npm run dev
npm run test
npm run lint
npm run build
npm run convex:dev
```
