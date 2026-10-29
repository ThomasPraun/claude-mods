# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-10-29

### Added

- "Subagentes" section above "Uso": the current chat's subagents with their type, model and
  status; finished ones stay listed, dim, up to the last five.
- Every section (each PC, Subagentes, Uso) folds and unfolds by pressing its header. A PC's
  header always counts its sessions by status, and a folded section still lists every session
  or subagent waiting on you.
- A session that goes from busy to free shows a toast and a "✓ terminó" mark until you press
  it or it starts working again; folding never hides it.
- Toasts when a subagent starts waiting on you or finishes.

## [0.5.0] - 2026-10-29

### Added

- "Uso" section at the bottom of the pane: this session's context fill and the 5-hour and
  7-day limits, with what is left and when each resets.

## [0.4.0] - 2026-10-29

### Added

- "copiar" button beside each session, copying its name to reference it from another session.

## [0.3.0] - 2026-10-29

### Added

- Pressing a session of this PC opens it: desktop app sessions through their `claude://` link,
  terminal sessions by focusing their herdr pane.

## [0.2.0] - 2026-10-29

### Added

- Sessions from every PC, shared through a secret GitHub gist via the GitHub CLI.
- Sessions grouped by PC in the pane.
- Windows and Linux support.

## [0.1.0] - 2026-10-29

### Added

- Pane listing the open Claude Code sessions of this machine as free, busy or waiting.
- Toast when another session starts waiting on you.
- `/sesiones` command to reopen the pane.
