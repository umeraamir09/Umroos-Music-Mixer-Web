# Umroo's Music Mixer

An AI playlist maker that turns plain-language intent into a Spotify-ready mix shaped around the listener's own history. The app is built with Next.js, Tailwind CSS, Convex, Vercel AI SDK, Cloudflare Workers AI (GLM-4.7-Flash planning with a Groq GPT-OSS-120B fallback), Spotify Web API, deterministic track enrichment from ReccoBeats, Last.fm, and MusicBrainz, and cover generation on Cloudflare Workers AI.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill the services you want to exercise.
3. Run the local Convex backend in one terminal with `npm run convex:dev`. Select a local deployment when prompted.
4. Run the app with `npm run dev` and open `http://127.0.0.1:3000`.

The public demo uses Spotify's client credentials flow to search its live catalog without asking visitors to log in. It runs the same catalog search, music enrichment, local track scoring, cover generation, and preview pipeline as connected mixes. It cannot read a visitor's library or save a playlist to their account. When Spotify credentials are absent in local development, a seeded catalog keeps the demo usable. Provider credentials progressively enable AI planning, Last.fm enrichment, Cloudflare cover generation, Groq voice prompts for invited users, and durable Convex history. Spotify supplied metadata is scored locally instead of being sent to an AI judge.

For a public deployment, configure a production Convex deployment, `SESSION_SECRET`, and Cloudflare Turnstile site/secret keys. Anonymous generation requires server-side Turnstile verification and uses atomic Convex counters: 3 attempts per visitor and 20 total attempts per UTC day. The visitor identity is stored in a sealed HttpOnly cookie; clearing cookies can reset its individual count, but cannot bypass the global ceiling. Voice transcription requires a Spotify session. Turnstile and quota checks fail closed in production if unavailable.

Set `NEXT_PUBLIC_APP_URL` to the exact public origin, register its hostname in Turnstile, and set `TURNSTILE_HOSTNAMES` to that hostname in production. Keep `localhost` and `127.0.0.1` only in local development. Configure provider-side spending limits as a second ceiling, then deploy the updated Convex schema/functions before sending traffic to the Vercel app. The quotas count attempts, including generations that later fail.

Spotify development mode only permits five allowlisted users. Public visitors see an access request dialog before Spotify login, and can submit an email for manual review or try the demo. Requests are stored in the Convex `accessRequests` table, limited to 30 new addresses per UTC day, and do not send an email or automatically grant access. To invite someone, review that table and add their Spotify account in the Spotify Developer Dashboard. Demo mix pages offer CSV export and browser-local playlist art; sample tracks cannot be saved to Spotify.

Spotify requires the redirect URI to match exactly. Add `http://127.0.0.1:3000/api/auth/callback` to the app's allowlist; current Spotify guidance rejects `http://localhost` for local OAuth.

## Environment

Copy `.env.example` to `.env.local` and fill in the services you want to exercise:

| Variable | Purpose |
| --- | --- |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SPOTIFY_MARKET` | Server-side catalog search for the public demo; OAuth for invited users' taste retrieval and playlist saving. The default catalog market is US. |
| `SESSION_SECRET` | Seals the encrypted session cookie. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES` | Turnstile challenge for public demo generations and access requests. The server checks the token, action, and deployment-specific hostname. Required in production. |
| `CONVEX_URL` / `NEXT_PUBLIC_CONVEX_URL` | Convex deployment: Spotify profiles, account-scoped mix history, and the shared enrichment cache. |
| `CONVEX_SERVICE_SECRET` | Random 32+ character secret set to the same value in the Next.js server and the Convex deployment. Keep it out of `NEXT_PUBLIC_` variables. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_ID` | GLM-4.7-Flash planning and cover generation. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Fast primary planner with Cloudflare GLM as fallback. The same Groq key transcribes voice prompts using `whisper-large-v3-turbo`. |
| `OPENCODE_API_KEY`, `TYPESAFE_API_KEY`, `JEV_MODEL`, `JEV_OFFICIAL_MODEL`, `JEV_LOGS` | Legacy Jev judge integration; public demo and Spotify-connected generation use local scoring to keep track metadata out of AI model inputs. |
| `LASTFM_API_KEY` | The one new secret: community tags, vibe summaries, reference similarity, and tag definitions. Without it, the Last.fm tier is skipped and the rest still runs. |
| `MUSICBRAINZ_AGENT` | Optional custom User-Agent for MusicBrainz (its usage policy asks for a contact). |
| `ENRICH_MAX_TRACKS` | Optional cap on candidates enriched per run; default is no limit. |

ReccoBeats and MusicBrainz need no credentials at all.

Spotify login creates or updates a Convex profile. Signed-in mix history is keyed by the Spotify account, while demo history remains in that browser. The enrichment cache is shared because it stores provider metadata keyed by track, reference, or tag. Its Convex functions require the server secret, as do profile and mix functions. Set the service secret in both environments before deploying the new Convex functions; existing mix rows remain associated with their current Spotify IDs.

## The low-cost AI pipeline

The system deliberately avoids one large "make me a playlist" prompt:

1. **Groq plans once.** GPT-OSS-120B produces a schema-bound plan from the user's own prompt. Spotify library data is not sent to an AI provider. Cloudflare GLM is the fallback, then local heuristics. Explicit counts from 1–200 are preserved.
2. **Spotify retrieves candidates.** Search is driven by the plan. The public demo uses a server-side application token and a configured market for Spotify catalog search. For invited listeners, a bounded sample of Liked Songs spans their library history and library-contains checks mark familiar tracks. The supported single-track endpoint verifies ReccoBeats additions. Search continues into deeper pages when the first judged pool is short. Spotify catalog ISRCs and release years are retained as evidence. Local development without Spotify credentials uses the seeded catalog.
3. **Music APIs add targeted evidence.** ReccoBeats batches full audio analysis and supplies recommendations. Last.fm supplies community tags, a short summary, similarity to reference recordings, and definitions for plan terms. MusicBrainz resolves a bounded set of recordings where genre evidence is missing. Provider work respects a generation budget, and results are cached in Convex.
4. **Code scores candidates.** Local fit rules evaluate enriched tracks and enforce artist, album, clean-content, energy, and library constraints without sending Spotify track data to an AI model.
5. **Code assembles the mix.** Probability ranking, deduplication, anchor-artist weighting, familiarity quota, and artist-run sequencing are deterministic.
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
