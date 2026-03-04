# klaudio

Add sound effects to your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Plays sounds when Claude finishes a task, sends a notification, and more.

## Quick Start

```bash
npx klaudio
```

The interactive installer walks you through:

1. **Choose scope** — install globally (`~/.claude`) or per-project (`.claude/`), or launch the **Music Player**
2. **Pick a source** — use a built-in preset, scan your Steam & Epic Games library for sounds, or provide custom files
3. **Preview & assign** — listen to sounds and assign them to events (tab to switch between events)
4. **Install** — writes Claude Code hooks to your `settings.json`

## Sound Sources

### Built-in Presets

Ready-made sound packs (Retro 8-bit, Minimal Zen, Sci-Fi Terminal, Victory Fanfare) that work out of the box.

### Game Sound Scanner

Scans your local Steam and Epic Games libraries for audio files:

- Finds loose audio files (`.wav`, `.mp3`, `.ogg`, `.flac`, `.aac`)
- Extracts packed audio (Wwise `.wem`, FMOD `.bank`, `.fsb`) using [vgmstream](https://vgmstream.org/) (downloaded automatically)
- Extracts Unity game audio from `.resource` files (PCM decoded directly, Vorbis converted via vgmstream)
- Parses Wwise metadata (`SoundbanksInfo.json`) for descriptive filenames
- Categorizes sounds (voice, ambient, music, SFX, UI, creature) for easy browsing
- Caches extracted sounds in `~/.klaudio/cache/` for instant reuse

### Custom Files

Point to your own `.wav`/`.mp3` files.

## Music Player

Play longer game tracks (90s–4min) as background music while you code:

- **Shuffle all** — scans all cached game audio, filters by duration, picks random tracks continuously
- **Play songs from game** — pick a specific cached game and play its music
- Controls: `n` next, `space` pause/resume, `esc` back
- Background scanning — starts playing as soon as the first track is found, keeps indexing

Requires previously extracted game audio (use "Scan local games" first).

## Features

- **Auto-preview** — sounds play automatically as you browse the list (toggle with `p`)
- **Multi-game selection** — pick sounds from different games, tab between events
- **Category filtering** — drill into voice, ambient, SFX, etc. when a game has enough variety
- **Type-to-filter** — start typing to narrow down long lists
- **10-second clamp** — long sounds are processed with ffmpeg: silence stripped, fade out baked in
- **Background scanning** — game list updates live as directories are scanned
- **Pre-loads existing config** — re-running the installer shows your current sound selections

## Events

| Event | Triggers when |
|---|---|
| Notification | Claude needs your attention |
| Task Complete | Claude finishes a response |

## Uninstall

```bash
npx klaudio --uninstall
```

## Requirements

- Node.js 18+ (Claude Code already requires this)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- For packed audio extraction: internet connection (vgmstream-cli is downloaded automatically)
- For best playback with fade effects: [ffmpeg/ffplay](https://ffmpeg.org/) on PATH (falls back to native players)

> **Note:** Currently only tested on Windows. macOS and Linux support is planned but not yet verified.
