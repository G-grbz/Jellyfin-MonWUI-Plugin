<h1 align="center">Jellyfin MonWUI Plugin</h1>

<p align="center">
  <img width="180" height="180" alt="Jellyfin MonWUI Plugin" src="https://github.com/user-attachments/assets/29947627-b2ff-4ecd-8a2b-4df932aca657" />
</p>

<p align="center">
  A modular UI upgrade for Jellyfin that introduces a cinematic home slider, richer metadata,
  hover previews, profile personalization, GMMP music playback, Netflix-style pause and details views,
  studio hubs, notifications, parental PIN control, and a centralized settings experience.
</p>

<p align="center">
  <a href="https://github.com/G-grbz/Jellyfin-MonWUI-Plugin#notes">
    <img
      alt="Install Name"
      src="https://img.shields.io/badge/Install%20Name-JMSFusion-0ea5e9?style=for-the-badge"
    />
  </a>

  <a href="https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/releases/latest">
    <img
      alt="Version"
      src="https://img.shields.io/github/v/release/G-grbz/Jellyfin-MonWUI-Plugin?style=for-the-badge"
    />
  </a>

  <a href="https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/blob/main/LICENSE">
    <img
      alt="License"
      src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge"
    />
  </a>
</p>


<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#highlights">Highlights</a> •
  <a href="#installation">Installation</a> •
  <a href="#notes">Notes</a> •
  <a href="#license">License</a>
</p>

---

## Overview

**Jellyfin MonWUI Plugin** appears in Jellyfin as **JMSFusion** and acts as an all-in-one frontend enhancement layer built around a modular slider system located in `Resources/slider/`.

Rather than applying a single visual tweak, it enhances the entire browsing experience — including home screen presentation, metadata depth, hover interactions, profile flow, music playback, pause behavior, library discovery, and settings management.

The goal is simple: make Jellyfin feel more polished, more personal, and more premium — without cluttering the interface.

---

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
| <div><img src="https://github.com/user-attachments/assets/85444c6e-7d7b-4540-a355-6ca22640e15f" width="100%"/><br/><sub><b>Normal View</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/063cef79-2749-4c88-a31c-655a753dfe12" width="100%"/><br/><sub><b>Pause Screen</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/5218f887-15f0-43ee-82c1-eceab3e7793b" width="100%"/><br/><sub><b>Notification Modal</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/d6d8300b-f0f0-4c3b-a9b8-1d2b9c630e9a" width="100%"/><br/><sub><b>Age Badge</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/79571773-d7b6-4850-816f-822278634698" width="100%"/><br/><sub><b>HoverTrailers</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/94d78061-b34b-4782-bafb-04df89647df3" width="100%"/><br/><sub><b>Popovers</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/4b0f0192-3ccb-4c74-bb83-1229072db4a6" width="100%"/><br/><sub><b>Choose Avatar</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/b5f6de0d-06fe-4cf9-99ee-f9415967806a" width="100%"/><br/><sub><b>Parental PIN Control</b></sub></div> |

</details>

## Highlights

| Area        | What it adds                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home screen | User-specific slider lists, automatic row refresh, custom API query control, manual positioning, and four slider layouts: Compact, Normal, Full Screen, and Peak |
| Discovery   | Details overlay, hover trailers, compact popover previews, personal recommendations, genre/director/recent rows, and studio hubs                                 |
| Metadata    | Quality badges, ratings, maturity indicators, richer info blocks, cast/director data, subtitle and language info, and provider links                             |
| Profiles    | Netflix-style profile chooser, avatar generation, and built-in avatar selection                                                                                  |
| Playback    | GMMP music player, lyrics support, subtitle customization, Netflix-style pause screen, parental PIN control, and Smart Pause                                     |

---

## Core Modules

* **Slider engine** with per-profile list control, random or manual content sourcing, API query customization, balancing rules, and automatic refresh logic
* **Visual layouts** including Compact, Normal, Full Screen, and Peak mode, with optional diagonal layout and manual positioning
* **Home enhancements** such as hero cards, enhanced details modal, recommendations, and metadata-rich UI elements
* **Hover preview system** with trailer playback and lightweight popover previews
* **Playback upgrades** including Smart Pause, metadata overlays, GMMP music playback, subtitle tools, and **parental PIN control**
* **Profile personalization** with avatar systems and fast profile switching
* **Library & notifications** including studio hubs, watchlist integration, and notification system
* **Trailer utilities** including trailer downloading via **yt-dlp** and trailer integration through **NFO files**
* **Advanced utilities** such as backup/restore, multilingual UI, and admin-level controls

---

## Installation

1. Open **Jellyfin Dashboard**
2. Go to **Plugins → Repositories**
3. Add:

https://raw.githubusercontent.com/G-grbz/Jellyfin-MonWUI-Plugin/main/manifest.json

4. Go to **Plugins → Available**
5. Install **JMSFusion**
6. Restart Jellyfin

---

## Uninstall

1. Open **Jellyfin → Plugins**
2. Uninstall **JMSFusion**
3. Restart Jellyfin
4. Hard refresh (**Ctrl + F5**)

---

## Notes

* After install/update, perform a hard refresh (**Ctrl + F5**)
* You may need to refresh a few times for all UI assets to fully update
* Some advanced modules are optional and may require admin access, API keys, or server-side tools
* Hover videos for manually added studio collections can be sourced from YouTube. You can use Gharmonize as a tool: https://github.com/G-grbz/Gharmonize

- If you use Watchlist and want to hide the default Jellyfin Favorites tab, add the following CSS to the Jellyfin custom CSS area:
```text

  button.emby-tab-button.emby-button[data-index="1"] {
    display: none !important;
}
```
---

## Acknowledgment

The original idea behind the JMS slider concept — which influenced parts of JMSFusion — was created by **BobHasNoSoul**.

https://github.com/BobHasNoSoul

---

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
