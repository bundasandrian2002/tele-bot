# Fonts used by src/lib/greetCard.ts

`@napi-rs/canvas` ships with no fonts and no system-font fallback —
`ctx.fillText()` silently draws nothing if no font is registered, which is
why the welcome/goodbye card's text rendered blank on Railway (its default
container has no fonts installed either).

The two `.ttf` files in this folder are registered at render time in
`greetCard.ts` (`ensureFontsRegistered()`), so no manual download step is
needed — they're part of the repo:

| File                          | Used for                                   | License |
|--------------------------------|---------------------------------------------|---------|
| `InstrumentSans-Regular.ttf`   | body text, usernames, chip/badge labels      | SIL OFL |
| `InstrumentSans-Bold.ttf`      | bold body text                               | SIL OFL |
| `JetBrainsMono-Regular.ttf`    | the "[ WELCOME ]" / "[ GOODBYE ]" eyebrow    | SIL OFL |

Both are free, open-source (SIL Open Font License) Google Fonts — see the
`*-OFL.txt` files alongside them for the full license text.

Make sure this `assets/fonts` folder is actually deployed to Railway (i.e.
not excluded by `.gitignore` or a Docker `.dockerignore`) — it needs to
exist at runtime, not just at build time.
