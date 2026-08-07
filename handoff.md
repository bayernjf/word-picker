# WordPicker Handoff Document

> Last updated: 2026-08-05 (Image OCR temporarily hidden via IMAGE_OCR_ENABLED flag)

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
[uncommitted] fix(service): rewrite ensureOffscreenDocument, fix OCR never working
[uncommitted] fix(content): increase OCR message timeout from 10s to 120s
b2f1711 fix(e2e): fix login persistence and test fixtures
2aff824 chore(manifest): add notifications permission for review reminders
b80397d feat(popup): add Anki export button
b2431dc feat(service): SRS review reminder, Anki export, and auth timestamp fix
691b23f feat(content): multi-language TTS and audio play button in popup
9254627 feat(lib): add audio field to translation cache and result
be5caf5 docs(handoff): update translation pipeline with Wiktionary API
525045a feat(build): add Wiktionary to host_permissions in manifest
c1bc884 feat(lib): integrate Wiktionary API for multilingual IPA phonetics
5131b6d docs: add handoff.md with project state summary
8f90eab feat(options): add 5 new effect options to settings dropdown
53f827a fix(service): add Korean OCR language mapping to langMap
7ba4b65 feat(content): add Korean language recognition support
500d8e5 fix(service): add German OCR language mapping to langMap
0e65dd5 feat(content): add German language recognition support
```

## Supported Languages

| Language | Code | Detection | Word Segmentation | OCR Model | Translation |
|----------|------|-----------|-------------------|-----------|-------------|
| English | en | Default | Regex | eng | Free Dictionary + Wiktionary + MyMemory + Youdao |
| French | fr | Feature chars (é, è, ê...) | Regex | fra | Wiktionary IPA + MyMemory (fr→zh-CN) + Youdao |
| Spanish | es | Feature chars (ñ, ¡, ¿) | Regex | spa | Wiktionary IPA + MyMemory (es→zh-CN) + Youdao |
| German | de | Latin+diacritics | Regex | deu | Wiktionary IPA + MyMemory (de→zh-CN) + Youdao |
| Korean | ko | Hangul Unicode detection | Space-based | kor | Wiktionary IPA + MyMemory (ko→zh-CN) + Youdao |
| Japanese | ja | CJK Unicode detection | TinySegmenter | jpn | Wiktionary IPA + MyMemory (ja→zh-CN) + Youdao |

## Translation Pipeline

```
Cache (LRU) → Offline Dictionary (ECDICT, English only) → Network APIs
```

Network APIs (called in parallel with 2.5s timeout each):
1. **MyMemory** — `langpair={sourceLang}|zh-CN`, works for all languages
2. **Free Dictionary API** — English only (phonetic/definition/example)
3. **Youdao Dictionary** — All languages attempted (may return empty for non-English)
4. **Wiktionary REST API** — All languages (IPA phonetic + English definition), free, no auth required

Priority: Youdao meaning > MyMemory translation > Free Dictionary English definition > Wiktionary definition
Phonetic priority: Free Dictionary API (English) > Wiktionary IPA (all languages) > fallback

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

## Code Audit Summary (2026-08-03)

### Checks
- tsc: 0 errors
- ESLint: 0 errors, 2 warnings (pre-existing)
- Vitest: 82/82 tests pass
- Chrome build: success

### Code Scale
- ~7600 lines across 17 core files
- Largest: content-script.ts (~2000), service-worker.ts (~1770), fireworks.ts (525)

### Open Issues

**CRITICAL (fixed 2026-08-03):**
- ~~OCR offscreen document never created — `hasDocument().then(() => true)` discarded return value, `connect()` readiness check never failed, content-script timeout too short (10s vs 30-90s actual). Root cause of "OCR never works".~~ → Fixed

**MEDIUM:**
1. ~~Word missing `sourceLang` field — all languages mixed in one wordbook~~ → Fixed (sourceLang persisted locally + synced as `source_language`; word-base migration 022 + language filter)
2. `handleSaveWord` throws when not logged in — should allow local-only save

**LOW (all fixed):**
- ~~saveRememberedCredentials unused password param~~ → Fixed
- ~~handleAuthLogout redundant storage cleanup~~ → Fixed
- ~~pushWords magic numbers for book_id length~~ → Fixed
- ~~Offscreen document race condition (OCR "Receiving end does not exist")~~ → Fixed (PING readiness check + onMessage listener bypass)
- ~~Service worker intercepts OCR_PROCESS/PING messages meant for offscreen~~ → Fixed (return false in onMessage)
- ~~Content script crashes when browser.storage undefined after extension reload~~ → Fixed (optional chaining)

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
- [ ] Image OCR real-world testing and tuning（基础创建 bug 已修复，目前用户入口已临时隐藏，见下）

## Image OCR Status (2026-08-05)

- **Temporarily hidden**: The hover-over-image OCR entry point is disabled by the `IMAGE_OCR_ENABLED` flag in `content/content-script.ts` (set to `false` by default).
- Rationale: base implementation is complete, but real-world testing on various web images (cross-origin, data URL, dynamically loaded, small/blurry text) and accuracy tuning are not yet done.
- The backend `IMAGE_OCR` handler in `service/service-worker.ts` and the offscreen document code in `offscreen/ocr.ts` remain intact and functional.
- To re-enable: set `IMAGE_OCR_ENABLED = true` in `content/content-script.ts` — no other code changes required.
- Other features (text word lookup, multi-language detection, translation popup, SRS, fireworks) are unaffected.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/constants.ts` | Language configs, platform detection, DEFAULT_SYNC_BASE_URL |
| `lib/storage.ts` | chrome.storage wrapper, defaults, migration |
| `lib/translator.ts` | Translation API calls (MyMemory + Free Dictionary + Wiktionary + Youdao) |
| `lib/supabase.ts` | Supabase Auth (signIn/signUp/refresh/signOut) |
| `content/content-script.ts` | Lookup core: keyboard, hover, popup, word selection, OCR trigger |
| `content/fireworks.ts` | All 8 visual effects |
| `service/service-worker.ts` | Message routing, sync queue, auth, OCR offscreen management |
| `options/options.ts` | Settings page: load/save, auth, sync trigger |
| `popup/popup.ts` | Word list, search, export, book switching |
| `offscreen/ocr.ts` | OCR image text recognition (Tesseract.js + offscreen document) |
| `scripts/build-cross-browser.ts` | Cross-browser build + env injection + version injection |
| `scripts/build-tesseract-assets.ts` | Tesseract resources (WASM + traineddata) build |

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
