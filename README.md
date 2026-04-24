# YouTube Knowledge Agent

Personal AI knowledge base built from your own YouTube playlist.

## What it does

- Syncs a playlist incrementally using YouTube metadata plus transcript extraction
- Stores one JSON record per video plus a chunked transcript index
- Supports retrieval-first Q&A with video + timestamp citations
- Supports a daily insight picker with non-repeat tracking
- Is designed to sit behind OpenClaw for delivery, voice notes, and automation

## Recommended daily insight strategy

Use **least-recently-surfaced + signal-ranked**.

Why:

- avoids repeats better than random
- still lets strong ideas surface more often than weak filler
- adapts well as new videos land in the playlist

## Commands

```bash
export ELEVENLABS_API_KEY=...
pnpm sync -- --playlist "https://www.youtube.com/playlist?list=PLSAVyiM48sqvzLBEbPqD8TZpfu5UyzO9t"
pnpm sync -- --playlist "https://www.youtube.com/playlist?list=PLSAVyiM48sqvzLBEbPqD8TZpfu5UyzO9t" --max-videos 1
pnpm ask -- --question "What does he say about getting hired faster?"
pnpm insight
pnpm insight -- --mark-sent
pnpm daily-note
pnpm check
```

## Storage layout

- `data/playlist-manifest.json` — latest playlist snapshot
- `data/videos/*.json` — transcript + metadata per video
- `data/chunks.json` — chunked searchable corpus
- `data/insight-log.json` — already-surfaced insight chunks
- `data/last-sync.json` — last sync report

## Q&A contract

- Answer only when retrieval signal is strong enough
- If not covered, explicitly say the corpus does not cover it
- Cite up to 3 supporting video timestamps

## OpenClaw integration plan

### 1. Incremental sync job

Run `pnpm sync -- --playlist <url>` on a recurring cadence (recommended: every 6 or 12 hours).

### Transcript extraction path

Current best path in this environment:

1. Use `youtube-dl-exec` / `yt-dlp` to pull audio from each YouTube video
2. Transcribe with ElevenLabs Scribe (`ELEVENLABS_API_KEY` required)
3. Chunk and index the transcript locally

Why this path: direct YouTube timed-text access is rate-limited from this host.

### 2. Q&A mode

When Sagar asks a question:

1. Run `pnpm ask -- --question "..."`
2. If `covered=false`, reply that the corpus does not cover it
3. Otherwise answer in a friendlier tone and cite the returned timestamps

### 3. Daily insight mode

Every morning:

1. Run `pnpm insight -- --mark-sent`
2. Convert `insight` field to speech with the existing TTS pipeline
3. Deliver as a voice note

## GitHub sync

This project is local right now. To push automatically, connect a repo remote and add a small commit/push script or OpenClaw job.

Missing decision: which repo under `github.com/sagartheamruth` should own this project.
