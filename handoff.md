# WordPicker Handoff Document

> Last updated: 2026-07-30

## Project Overview

WordPicker is a cross-browser (Chrome/Edge/Safari) English word-picking extension: hold a modifier key + hover to look up words, save to WordBase cloud wordbook with one click, supports SRS review, AI definitions, and fireworks effects.

- **Language**: TypeScript (Manifest V3, webextension-polyfill)
- **Build**: `tsc` → custom `build-cross-browser.ts` → `pack.ts`
- **Test**: Vitest (unit/integration) + Playwright (e2e)
- **Backend**: WordBase (`https://word-base.pages.dev`, API at root domain, frontend at `/app`)

## Current Branch Status

| Project | Branch | Unpushed Commits | Status |
|---------|--------|-----------------|--------|
| word-picker | `feature/20260602` | 3 commits (new effects) | Ready to push |
| word-base | `feature/20260604` | 0 | Clean |

## Recent Commits (word-picker)

```
8f90eab feat(options): add 5 new effect options to settings dropdown
1e8ac8c refactor(lib): expand fireworksEffect type to include 5 new effect values
c273125 feat(content): add 5 new word-add effects (confetti/sparkle/ripple/emoji/hearts)
43afaeb refactor(service): fix 3 LOW-level audit issues
f064022 docs: expand code audit report with 3 new LOW findings
53f827a fix(service): add Korean OCR language mapping to langMap
7ba4b65 feat(content): add Korean language recognition support
500d8e5 fix(service): add German OCR language mapping to langMap
0e65dd5 feat(content): add German language recognition support
```

## Supported Languages

| Language | Code | Detection | Word Segmentation | OCR Model | Translation |
|----------|------|-----------|-------------------|-----------|-------------|
| English | en | Default | Regex | eng | Free Dictionary + MyMemory + Youdao |
| French | fr | Feature chars (é, è, ê...) | Regex | fra | MyMemory (fr→zh-CN) + Youdao |
| Spanish | es | Feature chars (ñ, ¡, ¿) | Regex | spa | MyMemory (es→zh-CN) + Youdao |
| German | de | Latin+diacritics | Regex | deu | MyMemory (de→zh-CN) + Youdao |
| Korean | ko | Hangul Unicode detection | Space-based | kor | MyMemory (ko→zh-CN) + Youdao |
| Japanese | ja | CJK Unicode detection | TinySegmenter | jpn | MyMemory (ja→zh-CN) + Youdao |

## Translation Pipeline

```
Cache (LRU) → Offline Dictionary (ECDICT, English only) → Network APIs
```

Network APIs (called in parallel with 2.5s timeout each):
1. **MyMemory** — `langpair={sourceLang}|zh-CN`, works for all languages
2. **Free Dictionary API** — English only (phonetic/definition/example)
3. **Youdao Dictionary** — All languages attempted (may return empty for non-English)

Priority: Youdao meaning > MyMemory translation > Free Dictionary English definition

## Available Effects (8 total)

| Value | Name | Description |
|-------|------|-------------|
| canvas | Fireworks | Canvas particle explosion (120 particles, gravity) |
| css | Particles | CSS particle burst (56 particles) |
| confetti | Confetti | Colored rectangles burst and rotate with gravity |
| sparkle | Sparkle | Star shapes pop outward with rotation |
| ripple | Ripple | Concentric expanding rings |
| emoji | Emoji | Random emojis float outward |
| hearts | Hearts | Heart emojis rise and fade upward |
| none | Off | No effect |

## Code Audit Summary (2026-07-30)

### Checks
- tsc: 0 errors
- ESLint: 0 errors, 0 warnings
- Vitest: 62/62 tests pass
- Chrome build: success

### Code Scale
- ~6500 lines across 12 core files
- Largest: content-script.ts (1965), service-worker.ts (1641)

### Open Issues

**MEDIUM:**
1. Word missing `sourceLang` field — all languages mixed in one wordbook
2. `handleSaveWord` throws when not logged in — should allow local-only save

**LOW (all fixed in recent commits):**
- ~~saveRememberedCredentials unused password param~~ → Fixed
- ~~handleAuthLogout redundant storage cleanup~~ → Fixed
- ~~pushWords magic numbers for book_id length~~ → Fixed

**Known design constraints:**
- content-script.ts duplicates lib/ types (unavoidable — isolated world)
- lowercaseFirstLetter only handles pure English words

## Architecture Highlights

- **Sync**: Queue persistence + exponential backoff retry + lock mechanism + auto token refresh
- **Settings sync**: Push on change (2s debounce), pull on login/manual sync
- **Auth**: Supabase Auth with JWT, 5-min early refresh, "remember 7 days" option
- **Security**: No service role key in extension code, CSV export has formula injection protection, all HTML output uses escapeHtml
- **Fireworks**: Shadow DOM isolation, respects prefers-reduced-motion

## Pending Tasks (from TRACKING.md)

### P0 — Block release
- [ ] Chrome Web Store first manual listing ($5 dev account, upload zip, metadata)

### P1 — Post-release
- [ ] Chrome Web Store auto-publish CI
- [ ] Safari distribution (Xcode Archive + Upload)
- [ ] Windows Chrome fireworks compatibility testing

### P2 — Enhancement
- [ ] Image OCR real-world testing and tuning

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/constants.ts` | Language configs, platform detection, DEFAULT_SYNC_BASE_URL |
| `lib/storage.ts` | chrome.storage wrapper, defaults, migration |
| `lib/translator.ts` | Translation API calls (MyMemory + Free Dictionary + Youdao) |
| `lib/supabase.ts` | Supabase Auth (signIn/signUp/refresh/signOut) |
| `content/content-script.ts` | Lookup core: keyboard, hover, popup, word selection |
| `content/fireworks.ts` | All 8 visual effects |
| `service/service-worker.ts` | Message routing, sync queue, auth, OCR scheduling |
| `options/options.ts` | Settings page: load/save, auth, sync trigger |
| `popup/popup.ts` | Word list, search, export, book switching |
| `scripts/build-cross-browser.ts` | Cross-browser build + env injection + version injection |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| SUPABASE_URL | Supabase instance URL | `https://zzmolktkgorerpaoglpr.supabase.co` |
| SUPABASE_ANON_KEY | Supabase anonymous key | See `.env.example` |
| SYNC_BASE_URL | WordBase API root | `https://word-base.pages.dev` |
| WORD_BASE_APP_URL | WordBase frontend URL | `https://word-base.pages.dev/app` |

## Git Workflow

- Feature branches → `dev` (via PR or direct merge)
- `dev` → `main` (manual PR only, auto patch version bump + release)
- Commit messages must be in English (Conventional Commits format)
- No auto conflict resolution — list conflicts and wait for developer
