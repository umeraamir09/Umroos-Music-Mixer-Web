# Umroo's Music Mixer — design system

**Status:** Adopted across the landing page and the app's mix creation, generating, results, and history screens.

## North star

Umroo's Music Mixer should feel like a thoughtfully curated record shop for a personal AI playlist maker: warm, tactile, direct, and quietly playful. The experience begins with a person's taste and a few words about a moment; the system makes a mix that balances familiar tracks with discovery. The interface should make that relationship understandable at every step.

Use the landing page in `app/page.tsx`, `app/page.module.css`, and `app/landing-mix-preview.module.css` as the original visual reference. Shared tokens and app patterns now live in `app/globals.css`, with the fonts loaded by `app/layout.tsx`.

### Design principles

1. **Taste leads.** Put the listener's prompt, music, and choices ahead of decorative AI imagery. Explain how their words and Spotify history shape the result.
2. **Editorial, with room to breathe.** Large type, strong alignment, thin rules, and generous space create hierarchy. Add a panel or shadow only when it clarifies an interaction or makes a focal object tangible.
3. **Music references have a job.** A record can signal the brand, a side A / side B label can explain familiar music and discovery, and track numbers can organize a list. Music objects are decoration unless clearly presented as controls.
4. **Retro in the details, modern in use.** Pixel type and record details carry the nostalgic note. Reading, navigation, and forms stay clean and familiar.
5. **One clear next step.** Each screen has a dominant action and a legible secondary route. State what will happen, especially before connecting Spotify or saving a playlist.

## Foundations

### Color

These are the shared tokens used by the app. Hex values come from the landing page, with related values consolidated into named roles.

| Token | Value | Role |
| --- | --- | --- |
| `--ds-pink` | `#F386A1` | Brand field, record labels, selected highlights |
| `--ds-pink-strong` | `#D85E80` | Large accent words, icons, small decorative marks |
| `--ds-pink-soft` | `#F8D3DC` | Supporting tint |
| `--ds-blush` | `#FCE8EC` | Quiet prompt examples and callout surfaces |
| `--ds-ink` | `#3C2D31` | Primary text, dark sections, primary actions |
| `--ds-paper` | `#F7F3EC` | Main background |
| `--ds-paper-light` | `#FBF8F2` | Alternate light section |
| `--ds-card` | `#FFFDF9` | Raised input and card surface |
| `--ds-ink-inverse` | `#F7EEE9` | Primary text on dark ink |
| `--ds-muted` | `#75696B` | Secondary text on light surfaces |
| `--ds-muted-inverse` | `#C8BABC` | Secondary text on dark surfaces |
| `--ds-rule` | `rgba(60, 45, 49, 0.20)` | Dividers on light surfaces |

**Color use:** Paper and ink carry most of the interface. Use pink for a deliberate accent or a full promotional section, not as the default background for every card. Text on pink should be ink. Small body text must use ink or a contrast checked muted color; the stronger pink is for large display type and decorative details. On dark sections use the inverse text colors and lighter rules. Spotify green is reserved for Spotify branded actions or states; it is not a general product accent.

### Typography

| Role | Family and treatment | Starting scale |
| --- | --- | --- |
| Hero display | DM Sans, weight 600, tight tracking around `-0.075em`, compact line height | Fluid, up to `176px` on the landing hero |
| Section display | DM Sans, weight 600, tight tracking; one short Pixelify accent is optional | Roughly `50–93px` across responsive layouts |
| Product page title | DM Sans, weight 600, tight tracking | Aim for `48–72px` on desktop, scale down by available width |
| Intro or lead | DM Sans, weight 500 | About `30–43px` on editorial sections; smaller on task screens |
| Body | DM Sans, weight 400–500, line height `1.5–1.7` | `15–17px` |
| Action | DM Sans, weight 700 | `13–14px` |
| Metadata | Pixelify Sans, weight 600, uppercase where useful | `11–13px` with modest letter spacing |

DM Sans is the reading and interaction font. Pixelify Sans appears in issue labels, section numbers, record details, and occasional emphasized words. Keep paragraphs, form values, track names, errors, and longer button labels in DM Sans. Avoid serif display type, all-pixel paragraphs, and letter spacing that makes small text hard to scan.

### Layout and spacing

- The landing page uses a centered maximum content width of `1400px`, with `44px` desktop, `24px` tablet, and `18px` mobile side gutters. Use the same alignment for future full-width app shells. Constrain dense forms, track details, and reading content further so lines remain comfortable.
- Use a base spacing rhythm of `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 80 / 112px`. Optical adjustments are fine, but repeated components should share measurements.
- Allow generous section space: approximately `100–125px` vertically on desktop and `65–88px` on small screens. Task screens can be denser, while preserving clear separation between stages.
- Desktop editorial sections can use two columns; stack them by tablet width. Lists and process steps become a single readable column on narrow screens. Never make a headline, prompt, or primary action depend on overlap to remain readable at mobile widths.
- Keep text left aligned in work areas. Centering belongs to the landing hero, empty states, and selected moments of emphasis.

### Surfaces, borders, and shape

- Page surfaces are matte paper. Thin rules provide structure before cards do.
- Functional cards and controls use square or subtly rounded corners, generally `3–5px`. Circles are reserved for records, discs, and inherently circular controls.
- The landing prompt preview uses warm white, a small radius, and a soft shadow to make its overlap with the headline readable. Apply elevation sparingly to active or important surfaces; avoid layers of floating glass cards.
- Use grain and record grooves as restrained texture. They must never reduce text clarity or imply that a decorative record is clickable.

## Components and interaction

| Pattern | System rule |
| --- | --- |
| Primary action | Solid ink rectangle, light text, about `54–58px` high. Label the outcome directly, such as “Connect with Spotify” or “Save to Spotify.” The mix composer may use a compact up-arrow send button with an accessible name. |
| Secondary action | Text action with an underline or bottom rule. Keep it visually subordinate and keyboard accessible. |
| Prompt entry | Warm white field with a visible label, comfortable padding, readable value, and clear focus state. The landing's typing preview is illustrative; product prompt fields must be real editable controls. |
| Cards and lists | Prefer a title, useful metadata, and a rule to separate items. Use a filled card only when content is a distinct object or task. |
| Status and feedback | State what is happening in words. Pair color or animation with text for loading, errors, empty states, success, and Spotify connection state. |
| Icons | Simple line icons, usually around `1.35–1.8` stroke width. Use them to clarify actions or categories, not to replace visible labels. |

Interactive states must be evident through more than color alone. Every link, button, input, and menu item needs a visible keyboard focus style. Hover changes should feel small and intentional; active and disabled states should remain legible. Do not rely on placeholder text as the only form label.

### Motion

Motion should explain a transition or give a small sense of life. The landing prompt types, pauses, erases, and presents another example; its purpose is to show that a person can ask in natural language. Use quick UI transitions around `200–300ms`; avoid constant background animation during focused tasks. The mix completion handoff is deliberately slower: give the shape about `1.6s` to reach and become the cover, then reveal the title and tracklist in separate beats. If the user requests reduced motion, stop the loop and show a complete static prompt. Keep loading progress honest: do not imply a generated playlist is ready before the backend has returned it.

### Product flow and content

The language of the app follows the real journey: **connect Spotify → describe a mood or moment → generate and preview a mix → choose whether to save it**. Do not imply that merely previewing saves anything to Spotify. Keep prompts specific and conversational, as in “Late-night R&B with familiar voices and a few new finds.” Explain AI through the input, the generation state, and the resulting song choices rather than generic glowing imagery or technical jargon.

Headlines can be poetic; actions and explanations must be literal. Labels such as “SIDE A / THE FAMILIAR” can add character when their meaning is obvious alongside plain descriptions. Error, permission, and empty-state copy should tell the listener what happened and what they can do next. Use sentence case for actions and body copy; reserve uppercase for short metadata labels.

## Applying this system to future screens

- **Mix creation:** Use a short greeting selected from the listener's local morning, afternoon, evening, or late night. Vary the line within each period. Center the real prompt field with a slight overlap on the greeting's second line, as on the landing page. Keep its label and action clear, and leave optional examples quiet beneath it. When empty and unfocused, the field's placeholder can type and erase sample prompts without a cursor; pause it during editing and show a complete static example for reduced motion.
- **Generating:** Keep the listener on `/mix`. The real prompt form shrinks into a larger pink pill, then loops through a rounded square, an ink vinyl, and an album-cover square before returning to the pill. Put short, playful lines below it alongside a plain-language status. Show a static record for reduced motion, avoid fabricated percentages, and return the original prompt for retry if generation fails.
- **Mix results:** Carry the generating shape into the cover position with a shared element transition. Let the cover art resolve first, fade in the playlist copy beside it, then bring the tracklist up from below. Skip the movement for reduced motion. Start with the cover and title rather than a section-number bar. Give the cover a restrained pointer-led press effect, and show each track's album art beside its title with a record fallback when art is unavailable. Separate preview, save, and retry actions clearly. Make familiar versus discovery cues informative, not merely decorative.
- **History:** Treat saved mixes like a personal record collection, with consistent artwork sizes, dates, status labels, and readable track metadata. A compact list should still work without decorative treatments.
- **Account and Spotify states:** Keep permission, connection, and save outcomes explicit. Spotify branding may appear where it identifies that service, while the rest of the interface keeps the product palette.

## Current implementation

`app/layout.tsx` loads DM Sans and Pixelify Sans for every route and keeps the generated mix available for the shared element handoff. `app/globals.css` defines the shared color tokens, app header, actions, prompt-to-progress animation, result list, history collection, and responsive behavior. The landing page keeps its editorial layout in a CSS module and aliases its local colors to the shared tokens. Mix generation runs as an in-place state on `/mix`; the result route opens when the backend returns a mix, with the shape moving into the cover slot before the title and tracks appear.

This file is the canonical design reference for new work. If an implementation choice changes the system, update this document alongside the code.
