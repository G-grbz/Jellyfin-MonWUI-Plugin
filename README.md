<h1 align="center">Jellyfin MonWUI Plugin</h1>

<p align="center">
  <img width="180" height="180" alt="Jellyfin MonWUI Plugin" src="https://github.com/user-attachments/assets/29947627-b2ff-4ecd-8a2b-4df932aca657" />
</p>

<p align="center">
  A modular UI upgrade for Jellyfin that brings a cinematic home slider, richer metadata, hover previews,
  profile personalization, GMMP music playback, Netflix-style pause and details views, studio hubs,
  notifications, and a centralized settings experience.
</p>

<p align="center">
  <img alt="Plugin name JMSFusion" src="https://img.shields.io/badge/Install%20Name-JMSFusion-0ea5e9?style=for-the-badge" />
  <img alt="MIT license" src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge" />
</p>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#highlights">Highlights</a> •
  <a href="#installation">Installation</a> •
  <a href="#notes">Notes</a> •
  <a href="#license">License</a>
</p>

## Overview

Jellyfin MonWUI Plugin, installed in Jellyfin as **JMSFusion**, is an all-in-one frontend enhancement layer built around the modular slider system in `Resources/slider/`.

Instead of adding a single visual tweak, it upgrades the full browsing experience: home screen presentation, metadata density, hover interactions, profile flow, music playback, pause behavior, library discovery, and settings management.

The goal is simple: make Jellyfin feel more polished, more personal, and more premium without turning the interface into a mess.

## Screenshots

### Featured

|  |  |
| --- | --- |
| <div><img src="https://github.com/user-attachments/assets/8edb1981-91fc-4d41-8349-d039e6f938a9" width="100%"/><br/><sub><b>Details Modal</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/c4df1f04-24a6-421e-8a3b-d4a31305ac5d" width="100%"/><br/><sub><b>Watchlist</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/6c03ea43-bbbc-49de-be2e-a479c7da0131" width="100%"/><br/><sub><b>Showcase View</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/b0331f95-a28a-4205-8c91-669bde810f77" width="100%"/><br/><sub><b>Radio</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/a9c56850-af87-4297-8c66-3874c81b1857" width="100%"/><br/><sub><b>GMMP Music Player</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/dd0ba1b6-d5a5-4791-8742-5d5bfc5a605f" width="100%"/><br/><sub><b>Who's Watching?</b></sub></div> |

<details>
  <summary>More screenshots</summary>

|  |  |
| --- | --- |
| <div><img src="https://github.com/user-attachments/assets/3c19b0c8-2ab2-4b8c-a5af-c5590eabaf8c" width="100%"/><br/><sub><b>Diagonal Showcase View</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/884b8bf4-4d0f-44c8-a2bc-02821621e5c8" width="100%"/><br/><sub><b>MonWui Ui Cards</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/85444c6e-7d7b-4540-a355-6ca22640e15f" width="100%"/><br/><sub><b>Normal View</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/fc7e0c5c-3fb9-44af-8848-870b84c418db" width="100%"/><br/><sub><b>Pause Screen</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/5218f887-15f0-43ee-82c1-eceab3e7793b" width="100%"/><br/><sub><b>Notification Modal</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/d6d8300b-f0f0-4c3b-a9b8-1d2b9c630e9a" width="100%"/><br/><sub><b>Age Badge</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/79571773-d7b6-4850-816f-822278634698" width="100%"/><br/><sub><b>HoverTrailers</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/94d78061-b34b-4782-bafb-04df89647df3" width="100%"/><br/><sub><b>Popovers</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/4b0f0192-3ccb-4c74-bb83-1229072db4a6" width="100%"/><br/><sub><b>Choose Avatar</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/b5f6de0d-06fe-4cf9-99ee-f9415967806a" width="100%"/><br/><sub><b>Parental PIN Control</b></sub></div> |

</details>

## Highlights

| Area | What it adds |
| --- | --- |
| Home screen | User-specific slider lists, automatic row refresh, custom Jellyfin API query control, manual positioning, and four slider layouts: Compact, Normal, Full Screen, and Peak |
| Discovery | Details overlay, hover trailers, lighter popover previews, personal recommendations, genre/director/recent rows, and Disney+-style studio hubs |
| Metadata | Quality badges on cards, ratings, maturity badges, richer info blocks, cast/director data, subtitle and language info, and provider links |
| Profiles | Netflix-style "Who's Watching?" chooser, desktop/mobile profile targeting, DiceBear avatar generation, and 635 built-in avatar options |
| Playback | GMMP music player, lyrics support, subtitle customizer, Netflix-style pause screen, and Smart Pause behavior |
| Control | A 24-tab settings panel with backup/restore, watchlist controls, notifications, trailer helpers, profile-aware settings, and admin-friendly global publishing options |

## Core Modules

- **Slider engine** with per-profile list control, random or manual content sourcing, query-string tuning, balancing rules, and refresh logic that keeps rows up to date.
- **Visual layouts** including Compact, Normal, Full Screen, and Peak mode, with optional diagonal presentation and manual positioning controls for theme compatibility.
- **Home screen enhancements** such as hero cards, enhanced details modal, personal recommendations, recent rows, director rows, and quality-aware card treatment.
- **Hover preview system** with Netflix-like trailer behavior plus a lighter popover alternative when a full preview is not desired.
- **Pause and playback upgrades** including Smart Pause, maturity indicators, metadata-rich pause overlays, GMMP music playback, lyrics tools, and subtitle customization.
- **Profile personalization** with avatar generation, built-in avatar picking, and a dedicated "Who's Watching?" flow for fast profile switching.
- **Library and notification tools** including Studio Hubs, watchlist integration, newly added notifications, update notices, and continue-watching style surfaces.
- **Advanced utilities** including trailer and theme video helper workflows, NFO support, backup/restore, multilingual UI labels, and admin-only global settings control.

## Installation

This repository is **Jellyfin MonWUI Plugin**, but the plugin appears inside Jellyfin as **JMSFusion**.

1. Open your **Jellyfin Dashboard**.
2. Go to **Plugins -> Repositories**.
3. Add this repository URL:

```text
https://raw.githubusercontent.com/G-grbz/Jellyfin-MonWUI-Plugin/main/manifest.json
```

4. Go to **Plugins -> Available**.
5. Find and install **JMSFusion**.
6. Restart Jellyfin.

## Uninstall

1. Open **Jellyfin -> Plugins**.
2. Uninstall **JMSFusion**.
3. Restart Jellyfin.
4. Return to the home page.
5. Hard refresh the browser a few times with **Ctrl + F5**.

## Notes

- After install, update, or uninstall, a hard refresh with **Ctrl + F5** is recommended to clear cached assets.
- The slider may need a couple of refresh attempts before every UI asset is fully replaced.
- Some advanced automation modules are optional and may require admin access, API keys, or additional server-side tools depending on your setup.
- If you use Watchlist and want to hide the default Jellyfin Favorites tab, add the following CSS to the Jellyfin custom CSS area:
```text
  
  button.emby-tab-button.emby-button[data-index="1"] {
    display: none !important;
}
```

## Acknowledgment

The original idea behind the JMS slider and its integration approach inside Jellyfin's web UI was conceived by **BobHasNoSoul**. The JMS concept is built on that foundation.

https://github.com/BobHasNoSoul

## License

Released under the **MIT License**.

<details>
  <summary>Full license text</summary>

```text
MIT License

Copyright (c) 2026 G-grbz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

## Disclaimer

This software is provided "as is", without warranty of any kind. Use it at your own risk.
