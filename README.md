## Jellyfin MonWUI Plugin

<img width="1920" height="931" alt="vt" src="https://github.com/user-attachments/assets/b67e7acd-39a5-420b-b341-379d4d471a69" />

An all-in-one JavaScript toolkit for Jellyfin, featuring a customizable Media Slider builder, music player, Netflix-style pause screen, Netflix-like HoverVideo, quality labels on cards, DiceBear avatar generator, and a sleek notification panel.

## 📑 Table of Contents

* [🖼️ Screenshots](#screenshots)
* [✨ Features](#features)
* [🙏 Acknowledgment to BobHasNoSoul](#BobHasNoSoul)
* [⚙️ Installation](#install)
* [🎵 Synchronized Lyrics Script](#lyrics)
* [🎬 Trailer Scripts](#trailers)
* [📄 License](#license)


---

<a id="screenshots"></a>

## 🖼️ Screenshots

|                                                                                                                                                               |                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <div><img src="https://github.com/user-attachments/assets/197ce85c-ec1f-4afd-b5f8-c8b37f9f0e6a" width="100%"/><br/><sub><b>Details Modal</b></sub></div>      | <div><img src="https://github.com/user-attachments/assets/380ee6c1-6395-464b-8ede-ed6a054b5409" width="100%"/><br/><sub><b>Hero Card</b></sub></div>              |
| <div><img src="https://github.com/user-attachments/assets/d27f8ace-2645-4e2f-b2a1-3a370b9afb5b" width="100%"/><br/><sub><b>Showcase View</b></sub></div>      | <div><img src="https://github.com/user-attachments/assets/44ef2505-a51f-44d6-b731-d6d53c0b8330" width="100%"/><br/><sub><b>Diagonal Showcase View</b></sub></div> |
| <div><img src="https://github.com/user-attachments/assets/446a97d7-2f4f-47c3-a360-c0c42b30b4ea" width="100%"/><br/><sub><b>Compact View</b></sub></div>       | <div><img src="https://github.com/user-attachments/assets/142da2c1-4225-41f1-8929-c0cd5345c03e" width="100%"/><br/><sub><b>Full Screen</b></sub></div>            |
| <div><img src="https://github.com/user-attachments/assets/c6a5dd52-9956-4846-8915-08ca7b42a8a0" width="100%"/><br/><sub><b>Normal View</b></sub></div>        | <div><img src="https://github.com/user-attachments/assets/dd74820e-f9fb-4f25-b442-a05388baeff3" width="100%"/><br/><sub><b>Pause Screen</b></sub></div>           |
| <div><img src="https://github.com/user-attachments/assets/557a9488-7114-457e-aebd-ab6bce72a486" width="100%"/><br/><sub><b>Notification Modal</b></sub></div> | <div><img src="https://github.com/user-attachments/assets/2f226ae6-b80a-4f9a-a62e-70848f67da91" width="100%"/><br/><sub><b>Settings Panel</b></sub></div>         |
| <div><img src="https://github.com/user-attachments/assets/b67e7acd-39a5-420b-b341-379d4d471a69" width="100%"/><br/><sub><b>GMMP Music Player</b></sub></div>  | <div><img src="https://github.com/user-attachments/assets/03acc238-92fa-4149-a3ad-5a32d792075f" width="100%"/><br/><sub><b>Age Badge</b></sub></div>              |
| <div><img src="https://github.com/user-attachments/assets/13549ae1-6afc-42e3-a6bd-73efc902f5d2" width="100%"/><br/><sub><b>HoverTrailers</b></sub></div>      | <div><img src="https://github.com/user-attachments/assets/7247488f-0b2a-47e6-8972-3be7f7e7c992" width="100%"/><br/><sub><b>Popovers</b></sub></div>               |
| <div><img src="https://github.com/user-attachments/assets/133dd30d-3990-4148-83af-a34ccf8303a3" width="100%"/><br/><sub><b>Who is watching?</b></sub></div>   | <div><img src="https://github.com/user-attachments/assets/5ff54314-aaf9-4bdf-8754-b61164c22c00" width="100%"/><br/><sub><b>Choose Avatar</b></sub></div>          |


<a id="features"></a>

## ✨ Features

* User-specific slider lists (per-profile row configuration)

* Automatic slider list refresh (keeps rows up to date without manual reloads)

* Customizable Jellyfin API integration for sliders (endpoint/behavior tuning)

* Manual positioning controls for better theme compatibility

* GMMP Music Player

* Pause Screen + Smart Pause, including Netflix-style age rating badges

* Avatar Generator (DiceBear-powered)

* 600+ pre-made avatars with a built-in avatar picker

* Netflix-style “Who’s Watching?” profile chooser

* Global Quality Badges across Jellyfin (consistent quality labels)

* Netflix-style hover trailer module (or a lighter popover alternative)

* Newly Added Content & Notifications module

* Studio Hubs (Disney+ style)

* Enhanced Home Screen cards

* Trailer & theme video downloader / NFO helper (trailers sourced from TMDB)

* Lyrics downloader module

* Netflix-style details overlay used by the enhanced home cards

* Advanced Settings Panel to enable/disable and manage all modules in one place


---

<a id="BobHasNoSoul"></a>

## Acknowledgment to BobHasNoSoul

The concept of the JMS slider, as well as its integration into Jellyfin’s index.html, was entirely conceived by BobHasNoSoul. The JMS concept is entirely built on that structure. I would like to thank him for his contribution: https://github.com/BobHasNoSoul

---

<a id="install"></a>

## ⚙️ Installation

### Installation with a plugin

* Log in to your Jellyfin admin dashboard.
* Go to the Plugins section.
* Open the Catalog tab.
* Add a new repository with this URL:

```
https://raw.githubusercontent.com/G-grbz/Jellyfin-MonWUI-Plugin/main/manifest.json
```

* Install **JMS-Fusion**.
* Restart Jellyfin.
* Refresh homepage with **Ctrl + F5**.

### Manual Installation

#### Windows

* Extract the archive
* Run `install.bat` as admin
* Clear browser cookies

Uninstall: run `uninstall.bat` as admin.

#### Linux

```bash
git clone https://github.com/G-grbz/Jellyfin-MonWUI-Plugin
cd Jellyfin-MonWUI-Plugin/Resources/slider/
```

Run installer:

```bash
sudo chmod +x install.sh && sudo ./install.sh
```

Clear browser cookies.

### List Update Script

`listUpdate` updates lists at intervals.

Edit `.env` for configuration.

#### Script Options

* `itemLimit:` Max item count
* `garantiLimit:` Minimum guaranteed per content type
* `listLimit:` Max stored old lists
* `listRefresh:` Refresh interval (ms)
* `listcustomQueryString:` Custom Jellyfin API parameters

#### Permissions

```bash
sudo chmod -R a+rw /usr/share/jellyfin/web/slider/list && \
sudo chmod -R a+rw /usr/share/jellyfin/web/slider/listUpdate
```

Install deps:

```bash
cd /usr/share/jellyfin/web/slider/listUpdate && npm install dotenv node-fetch
```

Run:

```bash
node updateList.mjs
```

Uninstall:

```bash
sudo chmod +x /usr/share/jellyfin/web/slider/uninstall.sh && sudo sh /usr/share/jellyfin/web/slider/uninstall.sh
```

---

<a id="lyrics"></a>

## 🎵 Synchronized Lyrics Script

A standalone script to fetch synchronized lyrics from `lrclib.net`.

**Requirements:** `curl`, `jq`, `find`

Filename format: `'artist' - 'track title'`

Install:

```bash
curl -fsSL -o trailers.sh "https://raw.githubusercontent.com/G-grbz/Jellyfin-MonWUI-Plugin/main/Resources/slider/lrclib.sh"
chmod +x lrclib.sh
```

Usage:

```bash
sh lrclib.sh /Path/To/Music
```

Overwrite:

```bash
sh lrclib.sh /Path/To/Music --overwrite
```

---

<a id="trailers"></a>

## 🎬 Trailer Scripts

Two scripts:

* `trailers.sh` → downloads MP4 trailers
* `trailersurl.sh` → adds trailer URL into NFO files

Both use TMDb.

### Which one?

* Use `trailers.sh` for **offline MP4 trailers**
* Use `trailersurl.sh` for **online streaming trailers** (no downloads)

### Features

* Movies + Series support
* Multilanguage trailer lookup
* Metadata refresh
* Summary report

### Requirements

* `curl`, `jq`
* plus `yt-dlp` + optional `ffprobe` for `trailers.sh`

### Installation

(Commands for major distros included in original text.)

### Get scripts

```bash
curl -fsSL -o trailers.sh "https://raw.githubusercontent.com/G-grbz/Jellyfin-MonWUI-Plugin/main/Resources/slider/trailers.sh"
curl -fsSL -o trailersurl.sh "https://raw.githubusercontent.com/G-grbz/Jellyfin-MonWUI-Plugin/main/Resources/slider/trailersurl.sh"
chmod +x trailers.sh trailersurl.sh
```

### Environment Variables

(Full table retained, only English content preserved.)

---

### Usage

Download trailers:

```bash
JF_BASE="http://server:8096" \
JF_API_KEY="KEY" \
TMDB_API_KEY="TMDB" \
COOKIES_BROWSER=chrome \
MIN_FREE_MB=2048 \
ENABLE_THEME_LINK=1 \
OVERWRITE_POLICY=if-better \
./trailers.sh
```

Add only URL:

```bash
JF_BASE="http://server:8096" \
JF_API_KEY="KEY" \
TMDB_API_KEY="TMDB" \
./trailersurl.sh
```

### Systemd Timer

(Service + timer examples retained.)

---

<a id="license"></a>

# 📄 License

# MIT License

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

---

## ⚠ Disclaimer

This software is provided “as is”, without warranty of any kind.
Use it at your own risk.


