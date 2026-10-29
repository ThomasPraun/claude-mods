# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
