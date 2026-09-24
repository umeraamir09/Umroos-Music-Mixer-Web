# Umroo's Music Mixer

An AI playlist maker that turns plain-language intent into a Spotify-ready mix shaped around the listener's own history. The app is built with Next.js, Tailwind CSS, Convex, Vercel AI SDK, TypeSafe AI's Jev, Cloudflare Workers AI (GLM-4.7-Flash planning with a Groq GPT-OSS-120B fallback), Spotify Web API, deterministic track enrichment from ReccoBeats, Last.fm, and MusicBrainz, and cover generation on Cloudflare Workers AI.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill the services you want to exercise.
3. Run the local Convex backend in one terminal with `npm run convex:dev`. Select a local deployment when prompted.
4. Run the app with `npm run dev` and open `http://127.0.0.1:3000`.

The demo flow works with no external credentials. It uses a seeded catalogue, local fit scoring, generated fallback cover art, and browser history. Provider credentials progressively enable Spotify taste data and saving, GLM-4.7-Flash planning, Jev evaluation through OpenCode Zen (falling back to the official TypeSafe API), Last.fm-powered track enrichment, Cloudflare cover generation, Groq voice prompts, and durable Convex history.

Spotify requires the redirect URI to match exactly. Add `http://127.0.0.1:3000/api/auth/callback` to the app's allowlist; current Spotify guidance rejects `http://localhost` for local OAuth.

## Environment

Copy `.env.example` to `.env.local` and fill in the services you want to exercise:

| Variable | Purpose |
| --- | --- |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` | Spotify OAuth for taste retrieval and playlist saving. |
| `SESSION_SECRET` | Seals the encrypted session cookie. |
| `CONVEX_URL` / `NEXT_PUBLIC_CONVEX_URL` | Convex deployment: mix history and the durable enrichment cache. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_ID` | GLM-4.7-Flash planning and cover generation. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Fast primary planner with Cloudflare GLM as fallback. The same Groq key transcribes voice prompts using `whisper-large-v3-turbo`. |
| `OPENCODE_API_KEY`, `TYPESAFE_API_KEY` | Jev evaluation chain (OpenCode Zen first, official TypeSafe second). |
| `JEV_MODEL`, `JEV_OFFICIAL_MODEL`, `JEV_LOGS` | Optional Jev model overrides and request/response logging. |
| `LASTFM_API_KEY` | The one new secret: community tags, vibe summaries, reference similarity, and tag definitions. Without it, the Last.fm tier is skipped and the rest still runs. |
| `MUSICBRAINZ_AGENT` | Optional custom User-Agent for MusicBrainz (its usage policy asks for a contact). |
| `ENRICH_MAX_TRACKS` | Optional cap on candidates enriched per run; default is no limit. |

ReccoBeats and MusicBrainz need no credentials at all.

## The low-cost AI pipeline

The system deliberately avoids one large "make me a playlist" prompt:

1. **Groq plans once.** GPT-OSS-120B produces a schema-bound plan that extracts hard constraints and search queries. Cloudflare GLM is the fallback, then local heuristics. Explicit counts from 1–200 are preserved.
2. **Spotify retrieves candidates.** Search is driven by the plan. A bounded sample of Liked Songs spans the listener's library history and is read while planning runs. The current library-contains endpoint checks search results for familiarity, and the supported single-track endpoint verifies ReccoBeats additions. Search continues into deeper pages when the first judged pool is short. Spotify catalog ISRCs and release years are retained as evidence. The no-login demo uses a seeded catalogue.
3. **Music APIs add targeted evidence.** ReccoBeats batches full audio analysis and supplies recommendations. Last.fm supplies community tags, a short summary, similarity to reference recordings, and definitions for plan terms. MusicBrainz resolves a bounded set of recordings where genre evidence is missing. Provider work respects a generation budget, and results are cached in Convex.
4. **Jev decides in batches.** One shared compact state contains the request, plan, and 60 enriched candidate summaries (audio analysis, genre/mood tags, vibe summary, reference similarity — never popularity or play counts). Sixty typed yes/no questions ask whether each indexed candidate belongs. That structure reuses the prompt context instead of paying for one request per track. OpenCode Zen serves these calls with the free `jev-1.13-free` model, falling back to the official TypeSafe API when OpenCode fails.
5. **Code assembles the mix.** Probability ranking, deduplication, anchor-artist weighting, familiarity quota, and artist-run sequencing are deterministic. Jev never invents songs and cannot bypass a hard constraint.
6. **Cover generation overlaps selection.** Cloudflare SDXL-Lightning receives one short visual prompt while music retrieval and judging proceed. Sharp applies the readability overlay, playlist name, and watermark. Spotify is only mutated when the listener approves the preview.

Generation logs stage durations and the requested versus selected count as `[mix.generate]` for live performance diagnosis. If fewer recordings pass the request, the preview shows the shortfall.

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

`npm run test` also runs the provider smoke tests: offline pacing/backoff and
circuit-breaker checks in `lib/enrich/*.smoke.test.ts`. Set `LIVE_SMOKE=1` to
add the live suite in `lib/smoke.test.ts`, which drives ReccoBeats and
MusicBrainz through the real clients and asserts MusicBrainz requests stay at
least a second apart.
