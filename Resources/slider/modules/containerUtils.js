import { getConfig } from "./config.js";
import { applyContainerStyles } from "./positionUtils.js";
import { fetchItemDetails } from "../../Plugins/JMSFusion/runtime/api.js";
import { calculateMatchPercentage } from "./hoverTrailerModal.js";
import { withServer } from "./jfUrl.js";
import { getTomatoIconHtml } from "./customIcons.js";

const config = getConfig();
const QUALITY_SVG_BY_LEVEL = {
  sd: "./slider/src/images/quality/sd.svg",
  hd: "./slider/src/images/quality/hd.svg",
  fhd: "./slider/src/images/quality/fhd.svg",
  "4k": "./slider/src/images/quality/4k.svg"
};

function escapeMetaHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMetaTextSpan(text, ...classNames) {
  const className = ["monwui-meta-text", ...classNames.filter(Boolean)].join(" ");
  return `<span class="${className}">${escapeMetaHtml(text)}</span>`;
}

function getNormalizedDimension(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getVideoQualityInfo(videoStream) {
  const width = getNormalizedDimension(videoStream?.Width);
  const height = getNormalizedDimension(videoStream?.Height);
  const longerEdge = Math.max(width, height);
  const shorterEdge = Math.min(width, height);

  let baseQuality = "sd";
  if (longerEdge >= 3800 || shorterEdge >= 2160) {
    baseQuality = "4k";
  } else if (longerEdge >= 1900 || shorterEdge >= 1080) {
    baseQuality = "fhd";
  } else if (longerEdge >= 1200 || shorterEdge >= 720) {
    baseQuality = "hd";
  }

  return {
    baseQuality,
    qualitySvg: QUALITY_SVG_BY_LEVEL[baseQuality] || QUALITY_SVG_BY_LEVEL.sd
  };
}

export function createSlidesContainer(indexPage) {
  let slidesContainer = indexPage.querySelector("#monwui-slides-container");
  if (!slidesContainer) {
    slidesContainer = document.createElement("div");
    slidesContainer.id = "monwui-slides-container";
    applyContainerStyles(slidesContainer);
    indexPage.insertBefore(slidesContainer, indexPage.firstChild);
  }
  return slidesContainer;
}

export function createHorizontalGradientOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "monwui-horizontal-gradient-overlay";
  return overlay;
}

export function createLogoContainer() {
  const container = document.createElement("div");
  container.className = "monwui-logo-container";
  applyContainerStyles(container, 'logo');
  return container;
}

export function createStatusContainer(itemType, config, UserData, ChildCount, RunTimeTicks, MediaStreams) {
  const statusContainer = document.createElement("div");
  statusContainer.className = "monwui-status-container";
  applyContainerStyles(statusContainer, 'status');

  if (itemType && config.showTypeInfo) {
    const typeSpan = document.createElement("span");
    typeSpan.className = "type";
    const typeTranslations = {
      Series: { text: config.languageLabels.dizi, icon: '<i class="fas fa-tv "></i>' },
      Season: { text: config.languageLabels.season, icon: '<i class="fas fa-tv "></i>' },
      Episode: { text: config.languageLabels.episode, icon: '<i class="fas fa-tv "></i>' },
      BoxSet: { text: config.languageLabels.boxset, icon: '<i class="fas fa-film "></i>' },
      Movie: { text: config.languageLabels.film, icon: '<i class="fas fa-film "></i>' }
    };
    const typeInfo = typeTranslations[itemType] || { text: itemType, icon: "" };
    let typeText = typeInfo.text;
    if (itemType === "Series" && ChildCount) {
      typeText += ` (${ChildCount} ${config.languageLabels.sezon})`;
    }
    if (itemType === "BoxSet" && ChildCount) {
      typeText += ` (${ChildCount} ${config.languageLabels.seri})`;
    }
    typeSpan.innerHTML = `${typeInfo.icon}${buildMetaTextSpan(typeText, "monwui-type-text")}`;
    statusContainer.appendChild(typeSpan);
  }

  if (UserData && config.showWatchedInfo) {
    const watchedSpan = document.createElement("span");
    watchedSpan.className = "watched-status";
    const watchedIcon = UserData.Played
      ? `<i class="fa-regular fa-circle-check"></i>`
      : `<i class="fa-regular fa-circle-xmark"></i>`;
    let watchedText = UserData.Played
      ? config.languageLabels.izlendi
      : config.languageLabels.izlenmedi;
    if (UserData.Played && UserData.PlayCount > 0) {
      watchedText += ` (${UserData.PlayCount})`;
    }
    watchedSpan.innerHTML = `${watchedIcon}${buildMetaTextSpan(watchedText, "monwui-watched-text")}`;
    statusContainer.appendChild(watchedSpan);
  }

    if (RunTimeTicks && config.showRuntimeInfo) {
    const runtimeSpan = document.createElement("span");
    runtimeSpan.className = "sure";

    const calcRuntime = (ticks) => {
      const totalMinutes = Math.floor(ticks / 600000000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return hours > 0
        ? `${hours}${config.languageLabels.sa} ${minutes}${config.languageLabels.dk}`
        : `${minutes}${config.languageLabels.dk}`;
    };

    const formatEndTimeLocalized = (ticks) => {
      const totalMinutes = Math.floor(ticks / 600000000);
      const end = new Date(Date.now() + totalMinutes * 60 * 1000);
      const locale = String(config?.languageLabels?.timeLocale || "tr-TR").trim() || "tr-TR";

      try {
        return new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit"
        }).format(end);
      } catch {
        const hh = String(end.getHours()).padStart(2, "0");
        const mm = String(end.getMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
      }
    };

    if (Array.isArray(RunTimeTicks)) {
      runtimeSpan.innerHTML =
        `<i class="fa-solid fa-hourglass-end"></i>` +
        buildMetaTextSpan(
          RunTimeTicks.map(val => calcRuntime(val)).join(", "),
          "monwui-runtime-text"
        );
    } else {
      const remainingTicks =
        typeof UserData?.PlaybackPositionTicks === "number" &&
        UserData.PlaybackPositionTicks > 0 &&
        UserData.PlaybackPositionTicks < RunTimeTicks
          ? Math.max(RunTimeTicks - UserData.PlaybackPositionTicks, 0)
          : RunTimeTicks;
      const endHHMM = formatEndTimeLocalized(remainingTicks);
      const endTimeLabel = String(config?.languageLabels?.endTimeLabel || "").trim();
      runtimeSpan.innerHTML = `
        <i class="fa-solid fa-hourglass-end"></i>
        ${buildMetaTextSpan(calcRuntime(RunTimeTicks), "monwui-runtime-text")}
        <span class="end-time">
          <i class="fa-solid fa-clock"></i>
          ${buildMetaTextSpan(`${endTimeLabel ? `${endTimeLabel} ` : ""}${endHHMM}`, "monwui-end-time-text")}
        </span>
      `.trim();
    }

    statusContainer.appendChild(runtimeSpan);
  }

  const videoStream = MediaStreams ? MediaStreams.find(s => s.Type === "Video") : null;
  if (videoStream && config.showQualityInfo) {
    const qualitySpan = document.createElement("span");
    qualitySpan.className = "video-quality";
    const { qualitySvg } = getVideoQualityInfo(videoStream);

    let rangeSvg = `./slider/src/images/quality/sdr.svg`;
    if (videoStream.VideoRangeType && videoStream.VideoRangeType.toUpperCase().includes("HDR")) {
      rangeSvg = `./slider/src/images/quality/hdr.svg`;
    }

    let codecSvg = "";
    if (videoStream.Codec) {
      const codec = videoStream.Codec.toLowerCase();
      if (codec.includes("h264")) {
        codecSvg = `<img src="./slider/src/images/quality/h264.svg" alt="H.264" style="width:24px;height:24px;vertical-align:middle;margin-right:2px;">`;
      } else if (codec.includes("h265") || codec.includes("hevc")) {
        codecSvg = `<img src="./slider/src/images/quality/h265.svg" alt="H.265" style="width:24px;height:24px;vertical-align:middle;margin-right:2px;">`;
      } else if (codec.includes("vp9")) {
        codecSvg = `<img src="./slider/src/images/quality/vp9.svg" alt="VP9" style="width:24px;height:24px;vertical-align:middle;margin-right:2px;">`;
      } else if (codec.startsWith("mpeg") || codec.includes("mpeg4")) {
        codecSvg = `<img src="./slider/src/images/quality/mpeg.svg" alt="MPEG" style="width:24px;height:24px;vertical-align:middle;margin-right:2px;">`;
      }
    }

    qualitySpan.innerHTML = `
      <img src="${rangeSvg}" alt="" style="width:24px;height:24px;vertical-align:middle;margin-right:2px;">
      <img src="${qualitySvg}" alt="" style="width:24px;height:24px;vertical-align:middle;margin-right:2px;">
      ${codecSvg}
    `.trim();

    statusContainer.appendChild(qualitySpan);
  }

  return statusContainer;
}

export async function createActorSlider(People, config, item) {
  if (config.showActorAll) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  let actualPeople = People;

  if (
    (item.Type === "Episode" || item.Type === "Season") &&
    item.SeriesId &&
    (!Array.isArray(actualPeople) || actualPeople.length === 0)
  ) {
    try {
      const parent = await fetchItemDetails(item.SeriesId);
      if (parent && Array.isArray(parent.People)) {
        actualPeople = parent.People;
      }
    } catch (e) {
      console.warn("Ana dizi bilgileri alınamadı:", e);
    }
  }

  const allActors = (actualPeople || []).filter(p => p.Type === "Actor");
  const actorsForSlide = allActors.slice(0, config.artistLimit || 9);

  if (actorsForSlide.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  const sliderWrapper = document.createElement("div");
  sliderWrapper.className = "monwui-slider-wrapper";
  applyContainerStyles(sliderWrapper, 'slider');

  const actorContainer = document.createElement("div");
  actorContainer.className = "monwui-artist-container";

  const leftArrow = document.createElement("button");
  leftArrow.className = "monwui-slider-arrow left hidden";
  leftArrow.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;

  const rightArrow = document.createElement("button");
  rightArrow.className = "monwui-slider-arrow right hidden";
  rightArrow.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;

  sliderWrapper.appendChild(leftArrow);
  sliderWrapper.appendChild(actorContainer);
  sliderWrapper.appendChild(rightArrow);

  actorsForSlide.forEach(actor => {
    const actorDiv = document.createElement("div");
    actorDiv.className = "monwui-actor-item";

    const actorContent = document.createElement("div");
    actorContent.className = "monwui-actor-content";

    const actorLink = document.createElement("a");
    actorLink.href = `#/details?id=${actor.Id}${config?.serverId ? `&serverId=${encodeURIComponent(config.serverId)}` : ""}`;
    actorLink.target = "_blank";
    actorLink.style.textDecoration = "none";

    if (config.showActorImg) {
      const actorImg = document.createElement("img");
      actorImg.className = "monwui-actor-image";
      actorImg.loading = "lazy";
      if (actor.PrimaryImageTag) {
        actorImg.src = withServer(`/Items/${actor.Id}/Images/Primary?fillHeight=320&fillWidth=320&quality=80&tag=${actor.PrimaryImageTag}`);
        actorImg.alt = actor.Name;
      } else {
        actorImg.src = "./slider/src/images/nofoto.png";
        actorImg.alt = "No Image";
      }
      actorImg.onerror = () => {
        actorImg.src = "./slider/src/images/nofoto.png";
      };
      actorLink.appendChild(actorImg);
    }

    actorContent.appendChild(actorLink);

    const roleSpan = document.createElement("span");
    roleSpan.className = "monwui-actor-role";
    roleSpan.textContent = config.showActorRole ? actor.Role || "" : "";
    actorContent.appendChild(roleSpan);

    const nameSpan = document.createElement("span");
    nameSpan.className = "monwui-actor-name";
    nameSpan.textContent = config.showActorInfo ? actor.Name || "" : "";
    actorContent.appendChild(nameSpan);

    actorDiv.appendChild(actorContent);
    actorContainer.appendChild(actorDiv);
  });

  return sliderWrapper;
}

export function createInfoContainer({ config, Genres, ProductionYear, ProductionLocations }) {
  const container = document.createElement("div");
  container.className = "monwui-info-container";
  applyContainerStyles(container, "info");

  const normalizeKey = (str) => str?.toString().toLowerCase().replace(/\s+/g, "");

  const parts = [];

  if (Array.isArray(Genres) && Genres.length && config.showGenresInfo) {
    const translated = Genres.map((genre) => {
      const key = normalizeKey(genre);
      const matchedEntry = Object.entries(config.languageLabels.turler || {}).find(
        ([labelKey]) => normalizeKey(labelKey) === key
      );
      return matchedEntry ? matchedEntry[1] : genre;
    }).join(", ");

    parts.push(`<span class="genres"><i class="fa-solid fa-masks-theater"></i> ${translated}</span>`);
  }

  if (ProductionYear && config.showYearInfo) {
    const yearText = Array.isArray(ProductionYear) ? ProductionYear.join(", ") : ProductionYear;
    parts.push(`<span class="yil"><i class="fa-solid fa-calendar"></i> ${yearText}</span>`);
  }

  if (ProductionLocations && config.showCountryInfo) {
    const getFlagEmoji = (code) =>
      code
        ? code
            .toUpperCase()
            .split("")
            .map((char) => String.fromCodePoint(127397 + char.charCodeAt()))
            .join("")
        : "";

    const getCountryInfo = (countryRaw) => {
      const key = normalizeKey(countryRaw);
      const matchedEntry = Object.entries(config.languageLabels.ulke || {}).find(
        ([labelKey]) => normalizeKey(labelKey) === key
      );
      return matchedEntry
        ? matchedEntry[1]
        : { code: countryRaw.slice(0, 2).toUpperCase(), name: countryRaw };
    };

    const countryText = Array.isArray(ProductionLocations)
      ? ProductionLocations.map((c) => {
          const info = getCountryInfo(c);
          return `${getFlagEmoji(info.code)} ${info.name}`;
        }).join(", ")
      : (() => {
          const info = getCountryInfo(ProductionLocations);
          return `${getFlagEmoji(info.code)} ${info.name}`;
        })();

    parts.push(`<span class="ulke"><i class="fa-solid fa-location-dot"></i> ${countryText}</span>`);
  }

  container.innerHTML = parts.join(` <span class="info-sep">✧</span> `);

  if (!parts.length) container.style.display = "none";

  return container;
}

export async function createDirectorContainer({ config, People, item }) {
  const container = document.createElement("div");
  container.className = "monwui-director-container";
  applyContainerStyles(container, 'director');

  let actualPeople = People;

  if (
    (item.Type === "Episode" || item.Type === "Season") &&
    item.SeriesId &&
    (!Array.isArray(actualPeople) || actualPeople.length === 0)
  ) {
    try {
      const parent = await fetchItemDetails(item.SeriesId);
      if (parent && Array.isArray(parent.People)) {
        actualPeople = parent.People;
      }
    } catch (e) {
      console.warn("Ana dizi bilgileri alınamadı:", e);
    }
  }

  if (actualPeople && actualPeople.length > 0 && config.showDirectorWriter) {
    if (config.showDirector) {
      const directors = actualPeople.filter(p => p.Type?.toLowerCase() === "director");
      if (directors.length) {
        const directorNames = directors.map(d => d.Name).join(", ");
        const directorSpan = document.createElement("span");
        directorSpan.className = "monwui-yonetmen";
        directorSpan.textContent = `${config.languageLabels.yonetmen}: ${directorNames}`;
        container.appendChild(directorSpan);
      }
    }

    if (config.showWriter) {
      const writers = actualPeople.filter(p => p.Type?.toLowerCase() === "writer");
      const allow = (config.allowedWriters || [])
        .map(x => x?.toLowerCase?.())
        .filter(Boolean);
      const matchingWriters = writers.filter(w =>
        w?.Name && allow.includes(w.Name.toLowerCase())
      );
      if (matchingWriters.length) {
        const writerNames = matchingWriters.map(w => w.Name).join(", ");
        const writerSpan = document.createElement("span");
        writerSpan.className = "writer";
        writerSpan.textContent = `${writerNames} ${config.languageLabels.yazar} ...`;
        container.appendChild(writerSpan);
      }
    }
  }

  return container;
}

export async function createRatingContainer({
  config,
  CommunityRating,
  CriticRating,
  OfficialRating,
  UserData,
  item
}) {
  const container = document.createElement("div");
  container.className = "monwui-rating-container";
  applyContainerStyles(container, 'rating');

  let ratingExists = false;

  if (config.showRatingInfo) {
    if (config.showMatchPercentage && UserData && item) {
      const matchPercentage = await calculateMatchPercentage(UserData, item);
      const matchSpan = document.createElement("span");
      matchSpan.className = "monwui-match-percentage";
      matchSpan.innerHTML = `
  <span class="monwui-match-rating">
    <i class="fa-regular fa-heart fa-lg"></i>
      <span class="monwui-heart-filled" style="clip-path: inset(${100 - matchPercentage}% 0 0 0);">
      <i class="fa-solid fa-heart fa-lg"></i>
    </span>
  </span>
  ${buildMetaTextSpan(`${matchPercentage}%`, "monwui-percentage-text")}`;
      container.appendChild(matchSpan);
      ratingExists = true;
    }

    if (config.showCommunityRating && CommunityRating) {
    let ratingValue = Array.isArray(CommunityRating)
    ? Math.round((CommunityRating.reduce((a, b) => a + b, 0) / CommunityRating.length) * 10) / 10
    : Math.round(CommunityRating * 10) / 10;

  let ratingClass = "monwui-rating-default";
  if (ratingValue >= 9) ratingClass = "monwui-rating-excellent";
  else if (ratingValue >= 7.5) ratingClass = "monwui-rating-good";
  else if (ratingValue >= 6) ratingClass = "monwui-rating-average";
  else if (ratingValue >= 4) ratingClass = "monwui-rating-poor";
  else ratingClass = "monwui-rating-bad";

  const ratingPercentage = ratingValue * 10;
  const ratingSpan = document.createElement("span");
  ratingSpan.className = `monwui-rating ${ratingClass}`;
  ratingSpan.innerHTML = `
    <span class="monwui-star-rating">
      <i class="fa-regular fa-star fa-lg"></i>
      <span class="monwui-star-filled" style="clip-path: inset(${100 - ratingPercentage}% 0 0 0);">
        <i class="fa-solid fa-star fa-lg" style="display: block;"></i>
      </span>
    </span>
    ${buildMetaTextSpan(ratingValue, "monwui-rating-text")}`;
  container.appendChild(ratingSpan);
  ratingExists = true;
}

    if (config.showCriticRating && CriticRating) {
      const criticSpan = document.createElement("span");
      criticSpan.className = "monwui-t-rating";
      criticSpan.innerHTML =
        `${getTomatoIconHtml()}` +
        buildMetaTextSpan(
          Array.isArray(CriticRating) ? CriticRating.join(", ") : CriticRating,
          "monwui-critic-rating-text"
        );
      container.appendChild(criticSpan);
      ratingExists = true;
    }

    if (config.showOfficialRating && OfficialRating) {
      const officialRatingSpan = document.createElement("span");
      officialRatingSpan.className = "monwui-officialrating";
      officialRatingSpan.innerHTML =
        `<i class="fa-solid fa-user-group"></i>` +
        buildMetaTextSpan(
          Array.isArray(OfficialRating) ? OfficialRating.join(", ") : OfficialRating,
          "monwui-officialrating-text"
        );
      container.appendChild(officialRatingSpan);
      ratingExists = true;
    }
  }

  return { container, ratingExists };
}

export function createLanguageContainer({ config, MediaStreams, itemType }) {
  const container = document.createElement("div");
  container.className = "monwui-language-container";

  if (
    !config.showLanguageInfo ||
    !MediaStreams ||
    MediaStreams.length === 0 ||
    String(itemType || "").toLowerCase() === "series"
  ) {
    return container;
  }

  const audioCodecs = ["ac3", "mp3", "aac", "flac", "dts", "truehd", "eac3"];
  const subtitleCodecs = ["srt", "ass", "vtt", "subrip"];

  const audioStreams = MediaStreams.filter(
    stream => stream.Codec && audioCodecs.includes(stream.Codec.toLowerCase())
  );
  const subtitleStreams = MediaStreams.filter(
    stream => stream.Codec && subtitleCodecs.includes(stream.Codec.toLowerCase())
  );

  const hasTurkishAudio = audioStreams.some(
    stream => stream.Language?.toLowerCase() === config.defaultLanguage
  );
  const hasTurkishSubtitle = subtitleStreams.some(
    stream => stream.Language?.toLowerCase() === config.defaultLanguage
  );

  let audioLabel = "";
  let subtitleLabel = "";

  if (hasTurkishAudio) {
    audioLabel =
      `<i class="fa-solid fa-language"></i>` +
      buildMetaTextSpan(config.languageLabels.audio, "monwui-audio-label-text");
  } else {
    const defaultAudioStream = audioStreams.find(stream => stream.IsDefault);
    const fallbackLanguage = defaultAudioStream?.Language || "";
    audioLabel =
      `<i class="fa-solid fa-language"></i>` +
      buildMetaTextSpan(
        `${config.languageLabels.original}${fallbackLanguage ? ` ${fallbackLanguage}` : ""}`,
        "monwui-audio-label-text"
      );
  }

  if (!hasTurkishAudio && hasTurkishSubtitle) {
    subtitleLabel =
      `<i class="fa-solid fa-closed-captioning"></i>` +
      buildMetaTextSpan(config.languageLabels.subtitle, "monwui-subtitle-text");
  }

  const selectedAudioStream =
    audioStreams.find(stream => stream.Language?.toLowerCase() === config.defaultLanguage) ||
    audioStreams[0];

  if (selectedAudioStream) {
    const channelsText = selectedAudioStream.Channels
      ? `${selectedAudioStream.Channels} ${config.languageLabels.channel}`
      : "";
    const bitRateText = selectedAudioStream.BitRate
      ? `${Math.floor(selectedAudioStream.BitRate / 1000)} kbps`
      : "";
    const codecText = selectedAudioStream.Codec
      ? selectedAudioStream.Codec.toUpperCase()
      : "";

    const detailsText = [channelsText, bitRateText].filter(Boolean).join(" - ");

    if (detailsText) {
      audioLabel +=
        `<i class="fa-solid fa-volume-high"></i>` +
        buildMetaTextSpan(detailsText, "monwui-audio-details-text");
    }

    if (codecText) {
      audioLabel +=
        `<i class="fa-solid fa-microchip"></i>` +
        buildMetaTextSpan(codecText, "monwui-audio-codec-text");
    }
  }

  if (audioLabel) {
    const audioSpan = document.createElement("span");
    audioSpan.className = "audio-label";
    audioSpan.innerHTML = audioLabel;
    container.appendChild(audioSpan);
  }

  if (subtitleLabel) {
    const subtitleSpan = document.createElement("span");
    subtitleSpan.className = "subtitle-label";
    subtitleSpan.innerHTML = subtitleLabel;
    container.appendChild(subtitleSpan);
  }

  return container;
}

export function createMetaContainer() {
  const container = document.createElement("div");
  container.className = "monwui-meta-container";
  applyContainerStyles(container, 'meta');
  return container;
}

export function createMainContentContainer() {
  const container = document.createElement("div");
  container.className = "monwui-main-content-container";
  return container;
}

export function createPlotContainer(config, Overview, UserData, RunTimeTicks) {
  const container = document.createElement("div");
  container.className = "monwui-plot-container";
  applyContainerStyles(container, 'plot');

  if (config.showDescriptions && config.showPlotInfo && Overview) {
    const plotSpan = document.createElement("span");
    plotSpan.className = "monwui-plot";
    plotSpan.textContent = Overview;
    container.appendChild(plotSpan);
  }

  if (
    config.showPlaybackProgress &&
    typeof UserData?.PlaybackPositionTicks === "number" &&
    typeof RunTimeTicks === "number" &&
    UserData.PlaybackPositionTicks > 0 &&
    UserData.PlaybackPositionTicks < RunTimeTicks
  ) {
    const progressContainer = document.createElement("div");
    progressContainer.className = "monwui-playing-progress-container";

    const barWrapper = document.createElement("div");
    barWrapper.className = "monwui-duration-bar-wrapper";

    const bar = document.createElement("div");
    bar.className = "monwui-duration-bar";

    const percentage = Math.min(
      (UserData.PlaybackPositionTicks / RunTimeTicks) * 100,
      100
    );
    bar.style.width = `${percentage.toFixed(1)}%`;

    const remainingMinutes = Math.round(
      (RunTimeTicks - UserData.PlaybackPositionTicks) / 600000000
    );
    const text = document.createElement("span");
    text.className = "monwui-duration-remaining";
    text.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ${remainingMinutes} ${config.languageLabels.dakika} ${config.languageLabels.kaldi}`;

    barWrapper.appendChild(bar);
    progressContainer.appendChild(barWrapper);
    progressContainer.appendChild(text);
    container.appendChild(progressContainer);
  }

  return container;
}

export function createTitleContainer({ config, Taglines, title, OriginalTitle, Type, ParentIndexNumber, IndexNumber }) {
  const container = document.createElement("div");
  container.className = "monwui-title-container";
  applyContainerStyles(container, 'title');

  if (config.showDescriptions && config.showTitleInfo) {
    const titleSpan = document.createElement("span");
    titleSpan.className = "monwui-baslik";

    if (Type === "Episode" && typeof ParentIndexNumber === "number" && typeof IndexNumber === "number") {
      titleSpan.textContent = `S${ParentIndexNumber} B${IndexNumber}: ${title}`;
    } else {
      titleSpan.textContent = title;
    }

    container.appendChild(titleSpan);
  }

  if (Taglines && Taglines.length && config.showDescriptions && config.showSloganInfo) {
    const sloganSpan = document.createElement("span");
    sloganSpan.className = "monwui-slogan";
    sloganSpan.innerHTML = `“ ${Taglines.join(
      ' <i class="fa-solid fa-star fa-2xs" style="color: #ffffff;"></i> '
    )} ”`;
    container.appendChild(sloganSpan);
  }

  if (config.showDescriptions && config.showOriginalTitleInfo && OriginalTitle) {
    if (!config.hideOriginalTitleIfSame || title !== OriginalTitle) {
      const originalTitleSpan = document.createElement("span");
      originalTitleSpan.className = "monwui-o-baslik";
      originalTitleSpan.textContent = OriginalTitle;
      container.appendChild(originalTitleSpan);
    }
  }

  return container;
}

export function getVideoQualityText(videoStream) {
  if (!videoStream) return "";

  const { baseQuality, qualitySvg } = getVideoQualityInfo(videoStream);

  let iconSvg;
  if (videoStream.VideoRangeType && videoStream.VideoRangeType.toUpperCase().includes("HDR")) {
    iconSvg = `./slider/src/images/quality/hdr.svg`;
  } else {
    iconSvg = `./slider/src/images/quality/sdr.svg`;
  }

  let codecSvg = "";
  if (videoStream.Codec) {
    const codec = videoStream.Codec.toLowerCase();
    if (codec.includes("h264")) {
      codecSvg = `./slider/src/images/quality/h264.svg`;
    } else if (codec.includes("h265") || codec.includes("hevc")) {
      codecSvg = `./slider/src/images/quality/h265.svg`;
    } else if (codec.includes("vp9")) {
      codecSvg = `./slider/src/images/quality/vp9.svg`;
    } else if (codec.startsWith("mpeg") || codec.includes("mpeg4")) {
      codecSvg = `./slider/src/images/quality/mpeg.svg`;
    }
  }

  return `
    <img src="${qualitySvg}" alt="${baseQuality.toUpperCase()}" class="quality-icon">
    <img src="${iconSvg}" alt="" class="range-icon">
    ${codecSvg ? `<img src="${codecSvg}" alt="" class="codec-icon">` : ""}
  `.trim();
}
