import { getServerBase } from "./api.js";
import { cleanAvatars, updateHeaderUserAvatar, clearAvatarCache } from "./userAvatar.js";
import { getConfig } from "./config.js";

const config = getConfig?.() || {};
const L = (key, fallback = "") =>
  (config.languageLabels && config.languageLabels[key]) || fallback;
const AVATAR_DIR = "/web/slider/src/images/avatar";

function absUrl(path) {
  const base = getServerBase?.() || "";
  return base ? new URL(path, base).toString() : path;
}

function normalizePng(name) {
  if (!name) return null;
  const clean = decodeURIComponent(name.split("?")[0].split("/").pop());
  if (!/\.png$/i.test(clean)) return null;
  if (clean.includes("..")) return null;
  return clean;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fromManifest() {
  const url = absUrl(`${AVATAR_DIR}/index.json`);
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("manifest yok");
  const j = await r.json();
  const list = (j.files || []).map(normalizePng).filter(Boolean);
  if (!list.length) throw new Error("manifest boş");
  return list;
}

async function fromDirListing() {
  const r = await fetch(absUrl(`${AVATAR_DIR}/`), { cache: "no-store" });
  if (!r.ok) throw new Error("dir listing yok");
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const files = [...doc.querySelectorAll("a[href]")]
    .map(a => normalizePng(a.getAttribute("href")))
    .filter(Boolean);
  if (!files.length) throw new Error("png yok");
  return files;
}

async function fromProbe(max = 2000, stopAfterMiss = 60) {
  const out = [];
  let miss = 0;
  for (let i = 1; i <= max; i++) {
    const url = absUrl(`${AVATAR_DIR}/${i}.png`);
    const r = await fetch(url + `?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    if (r && r.ok && (r.headers.get("content-type") || "").includes("image")) {
      out.push(`${i}.png`);
      miss = 0;
      try { r.body?.cancel?.(); } catch {}
    } else {
      miss++;
      if (miss >= stopAfterMiss) break;
    }
  }
  if (!out.length) throw new Error("probe boş");
  return out;
}

function sortAvatars(list) {
  return [...new Set(list)].sort((a, b) => {
    const na = Number(a.replace(".png", ""));
    const nb = Number(b.replace(".png", ""));
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b, "tr");
  });
}

async function getAvatarFiles() {
  if (getAvatarFiles._cache && Date.now() - getAvatarFiles._ts < 300000) {
    return getAvatarFiles._cache;
  }

  let files = null;
  try { files = await fromManifest(); } catch {}
  if (!files) try { files = await fromDirListing(); } catch {}
  if (!files) try { files = await fromProbe(); } catch {}

  files = sortAvatars(files || []);
  getAvatarFiles._cache = files;
  getAvatarFiles._ts = Date.now();
  return files;
}

async function uploadViaJellyfinUi(blob) {
  const file = new File([blob], "avatar.png", { type: "image/png" });

  let input =
    document.querySelector('#btnAddImage input[type="file"]') ||
    document.querySelector('input[type="file"][accept*="image"]');

  if (!input) {
    const btn = document.querySelector("#btnAddImage");
    if (!btn) throw new Error("btnAddImage yok");
    btn.click();
    const t0 = Date.now();
    while (!input && Date.now() - t0 < 1500) {
      await sleep(50);
      input = document.querySelector('input[type="file"]');
    }
  }

  if (!input) throw new Error("file input yok");

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  document.querySelectorAll(".dialogBackdrop,.dialogContainer").forEach(e => e.remove());
}

async function openAvatarModal() {
  const files = await getAvatarFiles();

  const back = document.createElement("div");
  back.className = "jms-avatarBackdrop";
  const modal = document.createElement("div");
  modal.className = "jms-avatarModal";
  back.appendChild(modal);

  const header = document.createElement("div");
  header.className = "jms-avatarHeader";

  const title = document.createElement("strong");
  title.textContent = L("avatarSec", "Avatar Seç");

  const search = document.createElement("input");
  search.placeholder = L("ara", "Ara…");

  const close = document.createElement("button");
  close.textContent = "✕";
  close.onclick = () => back.remove();

  header.append(title, search, close);

  const grid = document.createElement("div");
  grid.className = "jms-avatarGrid";

  modal.append(header, grid);
  document.body.appendChild(back);

  function render(filter = "") {
    grid.innerHTML = "";
    const f = filter.toLowerCase();
    files
      .filter(fn => fn.toLowerCase().includes(f))
      .forEach(fn => {
        const c = document.createElement("div");
        c.className = "jms-avatarCard";
        const img = document.createElement("img");
        img.src = absUrl(`${AVATAR_DIR}/${fn}`);
        c.appendChild(img);
        c.onclick = async () => {
          try {
            const r = await fetch(img.src, { cache: "no-store" });
            const blob = await r.blob();
            await uploadViaJellyfinUi(blob);
            clearAvatarCache?.();
            cleanAvatars?.(document);
            await updateHeaderUserAvatar?.();
            back.remove();
          } catch (e) {
            alert(L("avatarYuklenemedi", "Avatar yüklenemedi"));
          }
        };
        grid.appendChild(c);
      });
  }

  search.oninput = () => render(search.value);
  render();
}

export function initUserProfileAvatarPicker() {
  const tryInject = () => {
    if (!(location.hash || "").startsWith("#/userprofile")) return;
    const btn = document.querySelector("#btnAddImage");
    if (!btn || btn.parentElement.querySelector(".jms-avatarPickBtn")) return;

    const b = document.createElement("button");
    b.className = "emby-button raised jms-avatarPickBtn";
    b.textContent = L("resimSec", "Resim Seç");
    b.onclick = openAvatarModal;
    btn.insertAdjacentElement("afterend", b);
  };

  window.addEventListener("hashchange", tryInject);
  tryInject();

  const mo = new MutationObserver(tryInject);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  return () => mo.disconnect();
}
