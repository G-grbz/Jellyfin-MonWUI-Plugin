import { getConfig } from "../config.js";
import { createCheckbox, createSection, createNumberInput } from "../settings.js";
import { applySettings } from "./applySettings.js";
import { getEmbyHeaders, makeApiRequest } from "../api.js";
import { withServer } from "../jfUrl.js";

const cfg = getConfig();

const DEFAULT_ORDER = [
  "Marvel Studios","Pixar","Walt Disney Pictures","Disney+","DC",
  "Warner Bros. Pictures","Lucasfilm Ltd.","Columbia Pictures",
  "Paramount Pictures","Netflix","DreamWorks Animation"
];

const ALIASES = {
  "Marvel Studios": ["marvel studios","marvel","marvel entertainment","marvel studios llc"],
  "Pixar": ["pixar","pixar animation studios","disney pixar"],
  "Walt Disney Pictures": ["walt disney","walt disney pictures"],
  "Disney+": ["disney+","disney plus","disney+ originals","disney plus originals","disney+ studio"],
  "DC": ["dc entertainment","dc"],
  "Warner Bros. Pictures": ["warner bros","warner bros.","warner bros pictures","warner bros. pictures","warner brothers"],
  "Lucasfilm Ltd.": ["lucasfilm","lucasfilm ltd","lucasfilm ltd."],
  "Columbia Pictures": ["columbia","columbia pictures","columbia pictures industries"],
  "Paramount Pictures": ["paramount","paramount pictures","paramount pictures corporation"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks","dreamworks animation","dreamworks pictures"]
};

const JUNK_WORDS = [
  "ltd","ltd.","llc","inc","inc.","company","co.","corp","corp.","the",
  "pictures","studios","animation","film","films","pictures.","studios."
];

const nbase = s =>
  (s || "")
    .toLowerCase()
    .replace(/[().,™©®\-:_+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const strip = s => {
  let out = " " + nbase(s) + " ";
  for (const w of JUNK_WORDS) out = out.replace(new RegExp(`\\s${w}\\s`, "g"), " ");
  return out.trim();
};

const toks = s => strip(s).split(" ").filter(Boolean);

const CANONICALS = new Map(DEFAULT_ORDER.map(n => [n.toLowerCase(), n]));

const ALIAS_TO_CANON = (() => {
  const m = new Map();
  for (const [canon, aliases] of Object.entries(ALIASES)) {
    m.set(canon.toLowerCase(), canon);
    for (const a of aliases) m.set(String(a).toLowerCase(), canon);
  }
  return m;
})();

function toCanonicalStudioName(name) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  return ALIAS_TO_CANON.get(key) || CANONICALS.get(key) || null;
}

function mergeOrder(defaults, custom) {
  const out = [];
  const seen = new Set();
  for (const n of (custom || [])) {
    const canon = toCanonicalStudioName(n) || n;
    const k = String(canon).toLowerCase();
    if (!seen.has(k)) { out.push(canon); seen.add(k); }
  }
  for (const n of defaults) {
    const k = n.toLowerCase();
    if (!seen.has(k)) { out.push(n); seen.add(k); }
  }
  return out;
}

function createHiddenInput(id, value) {
  const inp = document.createElement("input");
  inp.type = "hidden";
  inp.id = id;
  inp.name = id;
  inp.value = value;
  return inp;
}

function createDraggableList(id, items, labels) {
  const wrap = document.createElement("div");
  wrap.className = "setting-input setting-dnd";

  const lab = document.createElement("label");
  lab.textContent = labels?.studioHubsOrderLabel || "Sıralama (sürükle-bırak)";
  lab.style.display = "block";
  lab.style.marginBottom = "6px";

  const list = document.createElement("ul");
  list.id = id;
  list.className = "dnd-list";
  list.style.listStyle = "none";
  list.style.padding = "0";
  list.style.margin = "0";
  list.style.border = "1px solid var(--theme-text-color, #8882)";
  list.style.borderRadius = "8px";
  list.style.maxHeight = "320px";
  list.style.overflow = "auto";

  items.forEach(name => {
    list.appendChild(createDnDItem(name, labels));
  });

  let dragEl = null;

  list.addEventListener("dragstart", (e) => {
    const li = e.target.closest(".dnd-item");
    if (!li) return;
    dragEl = li;
    li.style.opacity = "0.6";
    e.dataTransfer?.setData?.("text/plain", li.dataset.name || "");
    e.dataTransfer.effectAllowed = "move";
  });

  list.addEventListener("dragend", (e) => {
    const li = e.target.closest(".dnd-item");
    if (!li) return;
    li.style.opacity = "";
    dragEl = null;
  });

  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    const over = e.target.closest(".dnd-item");
    if (!dragEl || !over || over === dragEl) return;
    const rect = over.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    list.insertBefore(dragEl, before ? over : over.nextSibling);
  });

  const __cleanup = () => { };
  wrap.addEventListener('jms:cleanup', __cleanup, { once:true });

  list.addEventListener("click", (e) => {
    const btnUp = e.target.closest?.(".dnd-btn-up");
    const btnDown = e.target.closest?.(".dnd-btn-down");
    if (!btnUp && !btnDown) return;
    const li = e.target.closest(".dnd-item");
    if (!li) return;
    if (btnUp && li.previousElementSibling) {
      li.parentElement.insertBefore(li, li.previousElementSibling);
    } else if (btnDown && li.nextElementSibling) {
      li.parentElement.insertBefore(li.nextElementSibling, li);
    }
  });

  const wrapAll = document.createElement("div");
  wrapAll.appendChild(lab);
  wrapAll.appendChild(list);
  return { wrap: wrapAll, list };
}

function createDnDItem(name, labels) {
  const li = document.createElement("li");
  li.className = "dnd-item";
  li.draggable = true;
  li.dataset.name = name;
  li.style.display = "flex";
  li.style.alignItems = "center";
  li.style.gap = "8px";
  li.style.padding = "8px 10px";
  li.style.borderBottom = "1px solid #0002";
  li.style.background = "var(--theme-background, rgba(255,255,255,0.02))";

  const handle = document.createElement("span");
  handle.className = "dnd-handle";
  handle.textContent = "↕";
  handle.title = labels?.dragToReorder || "Sürükle-bırak";
  handle.style.cursor = "grab";
  handle.style.userSelect = "none";
  handle.style.fontWeight = "700";

  const txt = document.createElement("span");
  txt.textContent = name;
  txt.style.flex = "1";

  const btns = document.createElement("div");
  btns.style.display = "flex";
  btns.style.gap = "6px";

  const up = document.createElement("button");
  up.type = "button";
  up.className = "dnd-btn-up";
  up.textContent = "↑";
  up.title = labels?.moveUp || "Yukarı taşı";
  up.style.minWidth = "28px";

  const down = document.createElement("button");
  down.type = "button";
  down.className = "dnd-btn-down";
  down.textContent = "↓";
  down.title = labels?.moveDown || "Aşağı taşı";
  down.style.minWidth = "28px";

  btns.appendChild(up);
  btns.appendChild(down);

  li.appendChild(handle);
  li.appendChild(txt);
  li.appendChild(btns);
  return li;
}

export function createStudioHubsPanel(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'studio-panel';
  panel.className = 'setting-item';

  const section = createSection(
    labels?.studioHubsSettings ||
    config.languageLabels.studioHubsSettings ||
    'Stüdyo Koleksiyonları Ayarları'
  );

  const enableCheckbox = createCheckbox(
    'enableStudioHubs',
    labels?.enableStudioHubs || config.languageLabels.enableStudioHubs || 'Stüdyo Koleksiyonlarını Etkinleştir',
    config.enableStudioHubs
  );
  section.appendChild(enableCheckbox);

  const countWrap = createNumberInput(
    'studioHubsCardCount',
    labels?.studioHubsCardCount || 'Gösterilecek kart sayısı (Ana ekran)',
    Number.isFinite(config.studioHubsCardCount) ? config.studioHubsCardCount : 10,
    1,
    12
  );
  section.appendChild(countWrap);

  const baseOrder = mergeOrder(
    DEFAULT_ORDER,
    Array.isArray(config.studioHubsOrder) && config.studioHubsOrder.length
      ? config.studioHubsOrder
      : []
  );

  const hidden = createHiddenInput('studioHubsOrder', JSON.stringify(baseOrder));
  const { wrap: dndWrap, list } = createDraggableList('studioHubsOrderList', baseOrder, labels);

  section.appendChild(dndWrap);
  section.appendChild(hidden);

  (async () => {
    try {
      const ctrl = new AbortController();
      panel.addEventListener('jms:cleanup', () => ctrl.abort(), { once: true });
      const url = `/Studios?Limit=300&Recursive=true&SortBy=SortName&SortOrder=Ascending`;
      const data = await makeApiRequest(url, { signal: ctrl.signal });
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
      const existing = new Set(
        [...list.querySelectorAll(".dnd-item")].map(li => li.dataset.name.toLowerCase())
      );

      const toAdd = [];
      for (const s of items) {
        const canon = toCanonicalStudioName(s?.Name);
        if (!canon) continue;
        if (!existing.has(canon.toLowerCase())) {
          existing.add(canon.toLowerCase());
          toAdd.push(canon);
        }
      }

      if (toAdd.length) {
        const appendSorted = toAdd.sort(
          (a, b) => DEFAULT_ORDER.indexOf(a) - DEFAULT_ORDER.indexOf(b)
        );

        for (const name of appendSorted) {
          list.appendChild(createDnDItem(name, labels));
        }

        const names = [...list.querySelectorAll(".dnd-item")].map(li => li.dataset.name);
        hidden.value = JSON.stringify(names);
      }
    } catch (e) {
      console.warn("studioHubsPage: Studios genişletme başarısız:", e);
    }
  })();

  const refreshHidden = () => {
    const names = [...list.querySelectorAll(".dnd-item")].map(li => li.dataset.name);
    hidden.value = JSON.stringify(names);
  };
  list.addEventListener("dragend", refreshHidden);
  list.addEventListener("drop", refreshHidden);
  list.addEventListener("click", (e) => {
    if (e.target.closest(".dnd-btn-up") || e.target.closest(".dnd-btn-down")) refreshHidden();
  });

  const enableHoverVideo = createCheckbox(
    'studioHubsHoverVideo',
    labels?.studioHubsHoverVideo || 'Hoverda video oynat',
    config.studioHubsHoverVideo
  );
  section.appendChild(enableHoverVideo);

  const subheading = document.createElement('h3');
  subheading.textContent = labels?.personalRecommendations || 'Kişisel Öneriler';
  section.appendChild(subheading);

  const enableForYouCheckbox = createCheckbox(
    'enablePersonalRecommendations',
    labels?.enableForYou || config.languageLabels.enableForYou || 'Sana Özel Koleksiyonları Etkinleştir',
    config.enablePersonalRecommendations
  );
  section.appendChild(enableForYouCheckbox);

  const placeRecsUnderStudio = createCheckbox(
  'placePersonalRecsUnderStudioHubs',
  (labels?.hubsUnderStudioHubs) || 'Sana özel önerileri #studio-hubs altına yerleştir',
  !!config.placePersonalRecsUnderStudioHubs
  );
  section.appendChild(placeRecsUnderStudio);

  const ratingWrap = createNumberInput(
   'studioHubsMinRating',
   labels?.studioHubsMinRating || 'Minimum Derecelendirme',
   Number.isFinite(config.studioHubsMinRating) ? config.studioHubsMinRating : 6.5,
   1,
   10,
   0.1
  );
  section.appendChild(ratingWrap);

  const personalcountWrap = createNumberInput(
    'personalRecsCardCount',
    labels?.studioHubsCardCount || 'Gösterilecek kart sayısı (Ana ekran)',
    Number.isFinite(config.personalRecsCardCount) ? config.personalRecsCardCount : 9,
    1,
    20
  );
  section.appendChild(personalcountWrap);

  const raHeading = document.createElement('h3');
  raHeading.textContent =
    labels?.recentAndContinueHeading ||
    'Son Eklenenler & İzlemeye Devam Et';
  section.appendChild(raHeading);

  const enableRecentRows = createCheckbox(
    'enableRecentRows',
    labels?.enableRecentRows || 'Son eklenenler (master) satırlarını göster',
    config.enableRecentRows !== false
  );
  section.appendChild(enableRecentRows);

  const recentSubWrap = document.createElement("div");
  recentSubWrap.style.paddingLeft = "8px";
  recentSubWrap.style.borderLeft = "2px solid #0002";
  recentSubWrap.style.marginBottom = "10px";
  section.appendChild(recentSubWrap);

  const enableRecentMoviesRow = createCheckbox(
    'enableRecentMoviesRow',
    labels?.enableRecentMoviesRow || 'Son eklenen filmler satırı',
    config.enableRecentMoviesRow !== false
  );
  recentSubWrap.appendChild(enableRecentMoviesRow);

  const recentMoviesCountWrap = createNumberInput(
    'recentMoviesCardCount',
    labels?.recentMoviesCardCount || 'Son eklenen filmler kart sayısı',
    Number.isFinite(config.recentMoviesCardCount) ? config.recentMoviesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentMoviesCountWrap);

  const enableRecentSeriesRow = createCheckbox(
    'enableRecentSeriesRow',
    labels?.enableRecentSeriesRow || 'Son eklenen diziler satırı',
    config.enableRecentSeriesRow !== false
  );
  recentSubWrap.appendChild(enableRecentSeriesRow);

  const recentSeriesCountWrap = createNumberInput(
    'recentSeriesCardCount',
    labels?.recentSeriesCardCount || 'Son eklenen diziler kart sayısı',
    Number.isFinite(config.recentSeriesCardCount) ? config.recentSeriesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentSeriesCountWrap);

  const enableRecentEpisodesRow = createCheckbox(
    'enableRecentEpisodesRow',
    labels?.enableRecentEpisodesRow || 'Son eklenen bölümler satırı',
    config.enableRecentEpisodesRow !== false
  );
  recentSubWrap.appendChild(enableRecentEpisodesRow);

  const recentEpisodesCountWrap = createNumberInput(
    'recentEpisodesCardCount',
    labels?.recentEpisodesCardCount || 'Son eklenen bölümler kart sayısı',
    Number.isFinite(config.recentEpisodesCardCount) ? config.recentEpisodesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentEpisodesCountWrap);

  const getCb = wrap => wrap?.querySelector?.('input[type="checkbox"]');
  const masterCb = getCb(enableRecentRows);
  const recMovCb = getCb(enableRecentMoviesRow);
  const recSerCb = getCb(enableRecentSeriesRow);
  const recEpCb  = getCb(enableRecentEpisodesRow);

  function syncRecentSubState() {
    const on = !!masterCb?.checked;
    recentSubWrap.style.display = on ? '' : 'none';
    if (!on) {
      if (recMovCb) recMovCb.checked = false;
      if (recSerCb) recSerCb.checked = false;
      if (recEpCb)  recEpCb.checked  = false;
    }
  }
  syncRecentSubState();
  enableRecentRows.addEventListener('change', syncRecentSubState, { passive: true });

  const enableContinueMovies = createCheckbox(
    'enableContinueMovies',
    labels?.enableContinueMovies || 'İzlemeye devam et (Filmler) satırını göster',
    !!config.enableContinueMovies
  );
  section.appendChild(enableContinueMovies);

  const continueMoviesCountWrap = createNumberInput(
    'continueMoviesCardCount',
    labels?.continueMoviesCardCount || 'İzlemeye devam et (Filmler) kart sayısı',
    Number.isFinite(config.continueMoviesCardCount) ? config.continueMoviesCardCount : 10,
    1,
    20
  );
  section.appendChild(continueMoviesCountWrap);

  const enableContinueSeries = createCheckbox(
    'enableContinueSeries',
    labels?.enableContinueSeries || 'İzlemeye devam et (Diziler) satırını göster',
    !!config.enableContinueSeries
  );
  section.appendChild(enableContinueSeries);

  const continueSeriesCountWrap = createNumberInput(
    'continueSeriesCardCount',
    labels?.continueSeriesCardCount || 'İzlemeye devam et (Diziler) kart sayısı',
    Number.isFinite(config.continueSeriesCardCount) ? config.continueSeriesCardCount : 10,
    1,
    20
  );
  section.appendChild(continueSeriesCountWrap);

  const splitTvLibRows = createCheckbox(
    'recentRowsSplitTvLibs',
    labels?.recentRowsSplitTvLibs || 'Dizi Kütüphanelerini Ayrı Bölümle',
    config.recentRowsSplitTvLibs !== false
  );
  section.appendChild(splitTvLibRows);

  const tvLibBox = document.createElement("div");
  tvLibBox.className = "setting-item tvshows";
  tvLibBox.style.paddingLeft = "8px";
  tvLibBox.style.borderLeft = "2px solid #0002";
  tvLibBox.style.marginBottom = "10px";
  section.appendChild(tvLibBox);

  const splitCb = splitTvLibRows?.querySelector?.('input[type="checkbox"]');
  function syncTvLibBoxVisibility() {
    const splitOn = !!splitCb?.checked;
    tvLibBox.style.display = splitOn ? "" : "none";
  }
  syncTvLibBoxVisibility();
  splitTvLibRows.addEventListener("change", syncTvLibBoxVisibility, { passive: true });

  const tvLibTitle = document.createElement("div");
  tvLibTitle.style.fontWeight = "700";
  tvLibTitle.style.margin = "6px 0";
  tvLibTitle.textContent = labels?.tvLibSelectHeading || "Gösterilecek Dizi Kütüphaneleri";
  tvLibBox.appendChild(tvLibTitle);

  function readJsonArr(k) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw || raw === "[object Object]") return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(x=>String(x||"").trim()).filter(Boolean) : [];
    } catch { return []; }
  }
  function writeJsonArr(k, arr) {
    try { localStorage.setItem(k, JSON.stringify((arr||[]).filter(Boolean))); } catch {}
  }
  function mkHidden(k, initialArr) {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.id = k;
    inp.name = k;
    inp.value = JSON.stringify((initialArr||[]).filter(Boolean));
    return inp;
  }

  const hiddenRecentSeries   = mkHidden("recentSeriesTvLibIds",   readJsonArr("recentSeriesTvLibIds"));
  const hiddenRecentEpisodes = mkHidden("recentEpisodesTvLibIds", readJsonArr("recentEpisodesTvLibIds"));
  const hiddenContinueSeries = mkHidden("continueSeriesTvLibIds", readJsonArr("continueSeriesTvLibIds"));
  tvLibBox.appendChild(hiddenRecentSeries);
  tvLibBox.appendChild(hiddenRecentEpisodes);
  tvLibBox.appendChild(hiddenContinueSeries);

  const tvLibHint = document.createElement("div");
  tvLibHint.style.opacity = "0.85";
  tvLibHint.style.fontSize = "0.95em";
  tvLibHint.style.marginBottom = "6px";
  tvLibHint.textContent = labels?.tvLibSelectHint || "Boş bırakırsan: tüm Dizi kütüphaneleri aktif sayılır.";
  tvLibBox.appendChild(tvLibHint);

  const tvLibGrid = document.createElement("div");
  tvLibGrid.style.display = "grid";
  tvLibGrid.style.gridTemplateColumns = "1fr";
  tvLibGrid.style.gap = "8px";
  tvLibBox.appendChild(tvLibGrid);

  async function fetchTvLibs() {
    try {
      const me = await makeApiRequest(`/Users/Me`);
      const uid = me?.Id;
      if (!uid) return [];
      const v = await makeApiRequest(`/Users/${uid}/Views`);
      const items = Array.isArray(v?.Items) ? v.Items : [];
      return items.filter(x => x?.CollectionType === "tvshows" && x?.Id).map(x => ({
        Id: x.Id,
        Name: x.Name || "TV"
      }));
    } catch {
      return [];
    }
  }

  (async () => {
    const libs = await fetchTvLibs();
    if (!libs.length) {
      const warn = document.createElement("div");
      warn.style.opacity = "0.85";
      warn.textContent = labels?.tvLibSelectNoLibs || "Dizi kütüphanesi bulunamadı.";
      tvLibGrid.appendChild(warn);
      return;
    }

    const makeRow = (title, key, hiddenInp) => {
      const box = document.createElement("div");
      box.style.border = "1px solid #0002";
      box.style.borderRadius = "8px";
      box.style.padding = "8px";

      const h = document.createElement("div");
      h.style.fontWeight = "700";
      h.style.marginBottom = "6px";
      h.textContent = title;
      box.appendChild(h);

      const selected = new Set(readJsonArr(key));
      const list = document.createElement("div");
      list.style.display = "grid";
      list.style.gridTemplateColumns = "1fr";
      list.style.gap = "6px";

      const sync = () => {
        const arr = Array.from(selected);
        hiddenInp.value = JSON.stringify(arr);
        writeJsonArr(key, arr);
      };

      for (const lib of libs) {
        const line = document.createElement("label");
        line.style.display = "flex";
        line.style.alignItems = "center";
        line.style.gap = "8px";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(lib.Id);
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(lib.Id);
          else selected.delete(lib.Id);
          sync();
        }, { passive: true });

        const t = document.createElement("span");
        t.textContent = lib.Name;

        line.appendChild(cb);
        line.appendChild(t);
        list.appendChild(line);
      }

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.marginTop = "8px";

      const btnAll = document.createElement("button");
      btnAll.type = "button";
      btnAll.textContent = labels?.selectAll || "Hepsini seç";
      btnAll.addEventListener("click", () => {
        selected.clear();
        libs.forEach(l => selected.add(l.Id));
        [...list.querySelectorAll("input[type=checkbox]")].forEach(i => i.checked = true);
        sync();
      });

      const btnNone = document.createElement("button");
      btnNone.type = "button";
      btnNone.textContent = labels?.selectNone || "Hepsini kaldır";
      btnNone.addEventListener("click", () => {
        selected.clear();
        [...list.querySelectorAll("input[type=checkbox]")].forEach(i => i.checked = false);
        sync();
      });

      actions.appendChild(btnAll);
      actions.appendChild(btnNone);

      box.appendChild(list);
      box.appendChild(actions);

      sync();
      return box;
    };

    tvLibGrid.appendChild(makeRow(
      labels?.tvLibRowRecentSeries || "Görüntülemek istediğiniz son eklenen diziler için kütüphane seçin",
      "recentSeriesTvLibIds",
      hiddenRecentSeries
    ));
    tvLibGrid.appendChild(makeRow(
      labels?.tvLibRowRecentEpisodes || "Görüntülemek istediğiniz son eklenen bölüm kartları için kütüphane seçin",
      "recentEpisodesTvLibIds",
      hiddenRecentEpisodes
    ));
    tvLibGrid.appendChild(makeRow(
      labels?.tvLibRowContinueSeries || "Görüntülemek istediğiniz İzlemeye devam kartları için kütüphane seçin",
      "continueSeriesTvLibIds",
      hiddenContinueSeries
    ));
  })();

  const becauseYouWatchedSection = createSection(
    labels?.becauseYouWatchedSettings ||
    config.languageLabels?.becauseYouWatchedSettings ||
    'İzlediğin İçin Öneriler'
  );

  const enableBecauseYouWatched = createCheckbox(
    'enableBecauseYouWatched',
    labels?.enableBecauseYouWatched || 'Öneri Bazlı Koleksiyonları Etkinleştir',
    config.enableBecauseYouWatched !== false
  );
  becauseYouWatchedSection.appendChild(enableBecauseYouWatched);

  const bywRowCountWrap = createNumberInput(
    'becauseYouWatchedRowCount',
    labels?.becauseYouWatchedRowCount || 'Ekranda gösterilecek Öneri sırası sayısı',
    Number.isFinite(config.becauseYouWatchedRowCount) ? config.becauseYouWatchedRowCount : 1,
    1,
    50
  );
  becauseYouWatchedSection.appendChild(bywRowCountWrap);

  const bywCardCountWrap = createNumberInput(
    'becauseYouWatchedCardCount',
    labels?.becauseYouWatchedCardCount || 'Her öneri sırası için kart sayısı',
    Number.isFinite(config.becauseYouWatchedCardCount) ? config.becauseYouWatchedCardCount : 10,
    1,
    20
  );
  becauseYouWatchedSection.appendChild(bywCardCountWrap);

  const genreSection = createSection(
    labels?.genreHubsSettings ||
    config.languageLabels?.genreHubsSettings ||
    'Tür Bazlı Koleksiyonlar'
  );

  const enableGenreHubs = createCheckbox(
    'enableGenreHubs',
    labels?.enableGenreHubs || 'Tür Bazlı Koleksiyonları Etkinleştir',
    !!config.enableGenreHubs
  );
  genreSection.appendChild(enableGenreHubs);

  const rowsCountWrap = createNumberInput(
    'studioHubsGenreRowsCount',
    labels?.studioHubsGenreRowsCount || 'Ekranda gösterilecek Tür sırası sayısı',
    Number.isFinite(config.studioHubsGenreRowsCount) ? config.studioHubsGenreRowsCount : 4,
    1,
    50
  );
  genreSection.appendChild(rowsCountWrap);

  const perRowCountWrap = createNumberInput(
    'studioHubsGenreCardCount',
    labels?.studioHubsGenreCardCount || 'Her Tür sırası için kart sayısı',
    Number.isFinite(config.studioHubsGenreCardCount) ? config.studioHubsGenreCardCount : 10,
    1,
    20
  );
  genreSection.appendChild(perRowCountWrap);

  const genreHidden = createHiddenInput('genreHubsOrder', JSON.stringify(Array.isArray(config.genreHubsOrder) ? config.genreHubsOrder : []));
  genreSection.appendChild(genreHidden);

  const { wrap: genreDndWrap, list: genreList } = createDraggableList('genreHubsOrderList', Array.isArray(config.genreHubsOrder) && config.genreHubsOrder.length ? config.genreHubsOrder : [], labels);
  genreSection.appendChild(genreDndWrap);

  (async () => {
    try {
      const ctrl = new AbortController(); panel.addEventListener('jms:cleanup', ()=>ctrl.abort(), {once:true});
      const genres = await fetchGenresForSettings(ctrl);
      const existing = new Set(
        [...genreList.querySelectorAll(".dnd-item")].map(li => li.dataset.name.toLowerCase())
      );
      let appended = 0;
      for (const g of genres) {
        const k = String(g).toLowerCase();
        if (!existing.has(k)) {
          existing.add(k);
          genreList.appendChild(createDnDItem(g, labels));
          appended++;
        }
      }
      if (appended > 0) {
        const names = [...genreList.querySelectorAll(".dnd-item")].map(li => li.dataset.name);
        genreHidden.value = JSON.stringify(names);
      }
    } catch (e) {
      console.warn("Tür listesi ayarlara eklenemedi:", e);
    }
  })();

  const refreshGenreHidden = () => {
    const names = [...genreList.querySelectorAll(".dnd-item")].map(li => li.dataset.name);
    genreHidden.value = JSON.stringify(names);
  };
  genreList.addEventListener("dragend", refreshGenreHidden);
  genreList.addEventListener("drop", refreshGenreHidden);
  genreList.addEventListener("click", (e) => {
    if (e.target.closest(".dnd-btn-up") || e.target.closest(".dnd-btn-down")) refreshGenreHidden();
  });

  const dirSection = createSection(labels?.directorRowsSettings || 'Yönetmen Koleksiyon Ayarları');

  const enableDirectorRows = createCheckbox(
    'enableDirectorRows',
    labels?.enableDirectorRows || 'Yönetmen Koleksiyonlarını Etkinleştir',
    !!config.enableDirectorRows
  );
  dirSection.appendChild(enableDirectorRows);

  const directorRowsUseTopGenres = createCheckbox(
    'directorRowsUseTopGenres',
    labels?.directorRowsUseTopGenres || 'En çok izlediğiniz filmlerin yönetmenlerini seç',
    config.directorRowsUseTopGenres !== false
  );
  dirSection.appendChild(directorRowsUseTopGenres);

  const dirCount = createNumberInput(
    'directorRowsCount',
    labels?.directorRowsCount || 'Yönetmen sayısı',
    Number.isFinite(config.directorRowsCount) ? config.directorRowsCount : 5,
    1, 50
  );
  dirSection.appendChild(dirCount);

  const dirPerRow = createNumberInput(
    'directorRowCardCount',
    labels?.directorRowCardCount || 'Her satırda kart sayısı',
    Number.isFinite(config.directorRowCardCount) ? config.directorRowCardCount : 10,
    1, 20
  );
  dirSection.appendChild(dirPerRow);

  const directorRowsMinItemsPerDirector = createNumberInput(
    'directorRowsMinItemsPerDirector',
    labels?.directorRowsMinItemsPerDirector || 'Minimum Yönetmen İçerik Sayısı',
    Number.isFinite(config.directorRowsMinItemsPerDirector) ? config.directorRowsMinItemsPerDirector : 10,
    1, 20
  );
  dirSection.appendChild(directorRowsMinItemsPerDirector);

  panel.appendChild(section);
  panel.appendChild(becauseYouWatchedSection);
  panel.appendChild(genreSection);
  panel.appendChild(dirSection);

  return panel;
}

async function fetchGenresForSettings(ctrl) {
  try {
    const url = `/Genres?Recursive=true&SortBy=SortName&SortOrder=Ascending&IncludeItemTypes=Movie,Series`;
    const data = await makeApiRequest(url, { signal: ctrl?.signal });
    const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
    const names = [];
    for (const it of items) {
      const name = (it?.Name || "").trim();
      if (name) names.push(name);
    }
    return uniqueCaseInsensitive(names);
  } catch (e) {
    console.warn("fetchGenresForSettings hatası:", e);
    return [];
  }
}

function uniqueCaseInsensitive(list) {
  const seen = new Set();
  const out = [];
  for (const g of list) {
    const k = String(g).toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(g); }
  }
  return out;
}
