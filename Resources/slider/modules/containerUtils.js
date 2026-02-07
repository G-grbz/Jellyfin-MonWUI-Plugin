import { getConfig } from "./config.js";
import { applyContainerStyles } from "./positionUtils.js";
import { fetchItemDetails } from "./api.js";
import { calculateMatchPercentage } from "./hoverTrailerModal.js";
import { withServer } from "./jfUrl.js";

const config = getConfig();

export function createSlidesContainer(indexPage) {
  let slidesContainer = indexPage.querySelector("#slides-container");
  if (!slidesContainer) {
    slidesContainer = document.createElement("div");
    slidesContainer.id = "slides-container";
    applyContainerStyles(slidesContainer);
    indexPage.insertBefore(slidesContainer, indexPage.firstChild);
  }
  return slidesContainer;
}

export function createGradientOverlay(imageUrl = "") {
  const overlay = document.createElement("div");
  overlay.className = "gradient-overlay";
  if (!imageUrl) {
    overlay.style.backgroundImage = "none";
  } else {
    const url = (typeof imageUrl === "string" && imageUrl.startsWith("/"))
      ? withServer(imageUrl)
      : imageUrl;
    overlay.style.backgroundImage = `url(${url})`;
    overlay.style.backgroundRepeat = "no-repeat";
    overlay.style.backgroundPosition = "50%";
    overlay.style.backgroundSize = "cover";
    overlay.style.aspectRatio = "1 / 1";
  }
  return overlay;
}

export function createHorizontalGradientOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "horizontal-gradient-overlay";
  return overlay;
}

export function createLogoContainer() {
  const container = document.createElement("div");
  container.className = "logo-container";
  applyContainerStyles(container, 'logo');
  return container;
}

export function createStatusContainer(itemType, config, UserData, ChildCount, RunTimeTicks, MediaStreams) {
  const statusContainer = document.createElement("div");
  statusContainer.className = "status-container";
  applyContainerStyles(statusContainer, 'status');

  if (itemType && config.showTypeInfo) {
    const typeSpan = document.createElement("span");
    typeSpan.className = "type";
    const typeTranslations = {
      Series: { text: config.languageLabels.dizi, icon: '<i class="fas fa-tv fa-lg"></i>' },
      Season: { text: config.languageLabels.season, icon: '<i class="fas fa-tv fa-lg"></i>' },
      Episode: { text: config.languageLabels.episode, icon: '<i class="fas fa-tv fa-lg"></i>' },
      BoxSet: { text: config.languageLabels.boxset, icon: '<i class="fas fa-film fa-lg"></i>' },
      Movie: { text: config.languageLabels.film, icon: '<i class="fas fa-film fa-lg"></i>' }
    };
    const typeInfo = typeTranslations[itemType] || { text: itemType, icon: "" };
    typeSpan.innerHTML = `${typeInfo.icon} ${typeInfo.text}`;
    if (itemType === "Series" && ChildCount) {
      typeSpan.innerHTML += ` (${ChildCount} ${config.languageLabels.sezon})`;
    }
    if (itemType === "BoxSet" && ChildCount) {
      typeSpan.innerHTML += ` (${ChildCount} ${config.languageLabels.seri})`;
    }
    statusContainer.appendChild(typeSpan);
  }

  if (UserData && config.showWatchedInfo) {
    const watchedSpan = document.createElement("span");
    watchedSpan.className = "watched-status";
    let watchedText = UserData.Played
      ? `<i class="fa-light fa-circle-check fa-lg"></i> ${config.languageLabels.izlendi}`
      : `<i class="fa-light fa-circle-xmark fa-lg"></i> ${config.languageLabels.izlenmedi}`;
    if (UserData.Played && UserData.PlayCount > 0) {
      watchedText += ` (${UserData.PlayCount})`;
    }
    watchedSpan.innerHTML = watchedText;
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
    runtimeSpan.innerHTML = `<i class="fa-regular fa-hourglass-end fa-lg"></i> ${
      Array.isArray(RunTimeTicks)
        ? RunTimeTicks.map(val => calcRuntime(val)).join(", ")
        : calcRuntime(RunTimeTicks)
    }`;
    statusContainer.appendChild(runtimeSpan);
  }

  const videoStream = MediaStreams ? MediaStreams.find(s => s.Type === "Video") : null;
  if (videoStream && config.showQualityInfo) {
    const qualitySpan = document.createElement("span");
    qualitySpan.className = "video-quality";

    let qualitySvg = `./slider/src/images/quality/sd.svg`;
    if (videoStream.Width >= 3800) {
      qualitySvg = `./slider/src/images/quality/4k.svg`;
    } else if (videoStream.Width >= 1900) {
      qualitySvg = `./slider/src/images/quality/fhd.svg`;
    } else if (videoStream.Width >= 1200) {
      qualitySvg = `./slider/src/images/quality/hd.svg`;
    }

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

  if ((item.Type === "Episode" || item.Type === "Season") && item.SeriesId) {
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
  sliderWrapper.className = "slider-wrapper";
  applyContainerStyles(sliderWrapper, 'slider');

  const actorContainer = document.createElement("div");
  actorContainer.className = "artist-container";

  const leftArrow = document.createElement("button");
  leftArrow.className = "slider-arrow left hidden";
  leftArrow.innerHTML = `<i class="fa-light fa-left-to-line"></i>`;

  const rightArrow = document.createElement("button");
  rightArrow.className = "slider-arrow right hidden";
  rightArrow.innerHTML = `<i class="fa-light fa-right-to-line"></i>`;

  sliderWrapper.appendChild(leftArrow);
  sliderWrapper.appendChild(actorContainer);
  sliderWrapper.appendChild(rightArrow);

  actorsForSlide.forEach(actor => {
    const actorDiv = document.createElement("div");
    actorDiv.className = "actor-item";

    const actorContent = document.createElement("div");
    actorContent.className = "actor-content";

    const actorLink = document.createElement("a");
    actorLink.href = `#/details?id=${actor.Id}${config?.serverId ? `&serverId=${encodeURIComponent(config.serverId)}` : ""}`;
    actorLink.target = "_blank";
    actorLink.style.textDecoration = "none";

    if (config.showActorImg) {
      const actorImg = document.createElement("img");
      actorImg.className = "actor-image";
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
    roleSpan.className = "actor-role";
    roleSpan.textContent = config.showActorRole ? actor.Role || "" : "";
    actorContent.appendChild(roleSpan);

    const nameSpan = document.createElement("span");
    nameSpan.className = "actor-name";
    nameSpan.textContent = config.showActorInfo ? actor.Name || "" : "";
    actorContent.appendChild(nameSpan);

    actorDiv.appendChild(actorContent);
    actorContainer.appendChild(actorDiv);
  });

  return sliderWrapper;
}

export function createInfoContainer({ config, Genres, ProductionYear, ProductionLocations }) {
  const container = document.createElement("div");
  container.className = "info-container";
  applyContainerStyles(container, 'info');

  const normalizeKey = str =>
    str?.toString().toLowerCase().replace(/\s+/g, "");

  if (Genres && Genres.length && config.showGenresInfo) {
    const genresSpan = document.createElement("span");
    genresSpan.className = "genres";
    genresSpan.innerHTML = `<i class="fa-regular fa-masks-theater"></i> ${Genres.map(
      genre => {
        const key = normalizeKey(genre);
        const matchedEntry = Object.entries(config.languageLabels.turler || {}).find(
          ([labelKey]) => normalizeKey(labelKey) === key
        );
        return matchedEntry ? matchedEntry[1] : genre;
      }
    ).join(", ")} <i class="fa-solid fa-sparkle fa-2xs" style="color: #ffffff;"></i>`;
    container.appendChild(genresSpan);
  }

  if (ProductionYear && config.showYearInfo) {
    const yearSpan = document.createElement("span");
    yearSpan.className = "yil";
    yearSpan.innerHTML = `<i class="fa-regular fa-calendar"></i> ${
      Array.isArray(ProductionYear)
        ? ProductionYear.join(
            '<i class="fa-solid fa-sparkle fa-2xs" style="color: #ffffff;"></i>'
          )
        : ProductionYear
    } <i class="fa-solid fa-sparkle fa-2xs" style="color: #ffffff;"></i>`;
    container.appendChild(yearSpan);
  }

  if (ProductionLocations && config.showCountryInfo) {
    const countrySpan = document.createElement("span");
    countrySpan.className = "ulke";
    const getFlagEmoji = (code) =>
      code
        ? code
            .toUpperCase()
            .split("")
            .map(char => String.fromCodePoint(127397 + char.charCodeAt()))
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

    countrySpan.innerHTML = `<i class="fa-regular fa-location-dot"></i> ${
      Array.isArray(ProductionLocations)
        ? ProductionLocations.map(c => {
            const info = getCountryInfo(c);
            return `${getFlagEmoji(info.code)} ${info.name}`;
          }).join(' <i class="fa-solid fa-sparkle fa-2xs" style="color: #ffffff;"></i> ')
        : (() => {
            const info = getCountryInfo(ProductionLocations);
            return `${getFlagEmoji(info.code)} ${info.name}`;
          })()
    }`;
    container.appendChild(countrySpan);
  }

  return container;
}


export async function createDirectorContainer({ config, People, item }) {
  const container = document.createElement("div");
  container.className = "director-container";
  applyContainerStyles(container, 'director');

  let actualPeople = People;

  if ((item.Type === "Episode" || item.Type === "Season") && item.SeriesId) {
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
        directorSpan.className = "yonetmen";
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
  container.className = "rating-container";
  applyContainerStyles(container, 'rating');

  let ratingExists = false;

  if (config.showRatingInfo) {
    if (config.showMatchPercentage && UserData && item) {
      const matchPercentage = await calculateMatchPercentage(UserData, item);
      const matchSpan = document.createElement("span");
      matchSpan.className = "match-percentage";
      matchSpan.innerHTML = `
  <span class="match-rating">
    <i class="fa-regular fa-heart fa-xl"></i>
    <span class="heart-filled" style="clip-path: inset(${100 - matchPercentage}% 0 0 0);">
      <i class="fa-solid fa-heart fa-xl"></i>
    </span>
  </span>
  <span class="percentage-text">${matchPercentage}%</span>`;
      container.appendChild(matchSpan);
      ratingExists = true;
    }

    if (config.showCommunityRating && CommunityRating) {
    let ratingValue = Array.isArray(CommunityRating)
    ? Math.round((CommunityRating.reduce((a, b) => a + b, 0) / CommunityRating.length) * 10) / 10
    : Math.round(CommunityRating * 10) / 10;

  let ratingClass = "rating-default";
  if (ratingValue >= 9) ratingClass = "rating-excellent";
  else if (ratingValue >= 7.5) ratingClass = "rating-good";
  else if (ratingValue >= 6) ratingClass = "rating-average";
  else if (ratingValue >= 4) ratingClass = "rating-poor";
  else ratingClass = "rating-bad";

  const ratingPercentage = ratingValue * 10;
  const ratingSpan = document.createElement("span");
  ratingSpan.className = `rating ${ratingClass}`;
  ratingSpan.innerHTML = `
    <span class="star-rating">
      <i class="fa-regular fa-star fa-lg"></i>
      <span class="star-filled" style="clip-path: inset(${100 - ratingPercentage}% 0 0 0);">
        <i class="fa-solid fa-star fa-lg" style="display: block;"></i>
      </span>
    </span> ${ratingValue} `;
  container.appendChild(ratingSpan);
  ratingExists = true;
}

    if (config.showCriticRating && CriticRating) {
      const criticSpan = document.createElement("span");
      criticSpan.className = "t-rating";
      criticSpan.innerHTML = `<i class="fa-duotone fa-solid fa-tomato fa-lg" style="--fa-primary-color: #01902e; --fa-secondary-color: #f93208; --fa-secondary-opacity: 1;"></i> ${
        Array.isArray(CriticRating) ? CriticRating.join(", ") : CriticRating
      } `;
      container.appendChild(criticSpan);
      ratingExists = true;
    }

    if (config.showOfficialRating && OfficialRating) {
      const officialRatingSpan = document.createElement("span");
      officialRatingSpan.className = "officialrating";
      officialRatingSpan.innerHTML = `<i class="fa-solid fa-family fa-lg"></i> ${
        Array.isArray(OfficialRating) ? OfficialRating.join(", ") : OfficialRating
      }`;
      container.appendChild(officialRatingSpan);
      ratingExists = true;
    }
  }

  return { container, ratingExists };
}

export function createLanguageContainer({ config, MediaStreams, itemType }) {
  const container = document.createElement("div");
  container.className = "language-container";

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
    audioLabel = `<i class="fa-regular fa-language"></i> ${config.languageLabels.audio}`;
  } else {
    const defaultAudioStream = audioStreams.find(stream => stream.IsDefault);
    const fallbackLanguage = defaultAudioStream?.Language || "";
    audioLabel =
      `<i class="fa-regular fa-language"></i> ${config.languageLabels.original}` +
      (fallbackLanguage ? ` ${fallbackLanguage}` : "");
  }

  if (!hasTurkishAudio && hasTurkishSubtitle) {
    subtitleLabel = `<i class="fa-solid fa-subtitles"></i> ${config.languageLabels.subtitle}`;
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

    if (channelsText || bitRateText || codecText) {
      audioLabel += ` <i class="fa-solid fa-volume-high"></i> ${channelsText} - ${bitRateText} <i class="fa-solid fa-microchip"></i> ${codecText}`;
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
  container.className = "meta-container";
  applyContainerStyles(container, 'meta');
  return container;
}

export function createMainContentContainer() {
  const container = document.createElement("div");
  container.className = "main-content-container";
  return container;
}

export function createPlotContainer(config, Overview, UserData, RunTimeTicks) {
  const container = document.createElement("div");
  container.className = "plot-container";
  applyContainerStyles(container, 'plot');

  if (config.showDescriptions && config.showPlotInfo && Overview) {
    if (config.showbPlotInfo && config.languageLabels.konu) {
      const plotBSpan = document.createElement("span");
      plotBSpan.className = "plotb";
      plotBSpan.textContent = config.languageLabels.konu;
      container.appendChild(plotBSpan);
    }

    const plotSpan = document.createElement("span");
    plotSpan.className = "plot";
    plotSpan.textContent = "\u00A0\u00A0" + Overview;
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
    progressContainer.className = "playing-progress-container";

    const barWrapper = document.createElement("div");
    barWrapper.className = "duration-bar-wrapper";

    const bar = document.createElement("div");
    bar.className = "duration-bar";

    const percentage = Math.min(
      (UserData.PlaybackPositionTicks / RunTimeTicks) * 100,
      100
    );
    bar.style.width = `${percentage.toFixed(1)}%`;

    const remainingMinutes = Math.round(
      (RunTimeTicks - UserData.PlaybackPositionTicks) / 600000000
    );
    const text = document.createElement("span");
    text.className = "duration-remaining";
    text.innerHTML = `<i class="fa-regular fa-hourglass-half"></i> ${remainingMinutes} ${config.languageLabels.dakika} ${config.languageLabels.kaldi}`;

    barWrapper.appendChild(bar);
    progressContainer.appendChild(barWrapper);
    progressContainer.appendChild(text);
    container.appendChild(progressContainer);
  }

  return container;
}

export function createTitleContainer({ config, Taglines, title, OriginalTitle, Type, ParentIndexNumber, IndexNumber }) {
  const container = document.createElement("div");
  container.className = "title-container";
  applyContainerStyles(container, 'title');

  if (config.showDescriptions && config.showTitleInfo) {
    const titleSpan = document.createElement("span");
    titleSpan.className = "baslik";

    if (Type === "Episode" && typeof ParentIndexNumber === "number" && typeof IndexNumber === "number") {
      titleSpan.textContent = `S${ParentIndexNumber} B${IndexNumber}: ${title}`;
    } else {
      titleSpan.textContent = title;
    }

    container.appendChild(titleSpan);
  }

  if (Taglines && Taglines.length && config.showDescriptions && config.showSloganInfo) {
    const sloganSpan = document.createElement("span");
    sloganSpan.className = "slogan";
    sloganSpan.innerHTML = `“ ${Taglines.join(
      ' <i class="fa-solid fa-sparkle fa-2xs" style="color: #ffffff;"></i> '
    )} ”`;
    container.appendChild(sloganSpan);
  }

  if (config.showDescriptions && config.showOriginalTitleInfo && OriginalTitle) {
    if (!config.hideOriginalTitleIfSame || title !== OriginalTitle) {
      const originalTitleSpan = document.createElement("span");
      originalTitleSpan.className = "o-baslik";
      originalTitleSpan.textContent = OriginalTitle;
      container.appendChild(originalTitleSpan);
    }
  }

  return container;
}

export function getVideoQualityText(videoStream) {
  if (!videoStream) return "";

  let baseQuality = "sd";
  let qualitySvg = `./slider/src/images/quality/sd.svg`;

  if (videoStream.Height >= 3800) {
    baseQuality = "4k";
    qualitySvg = `./slider/src/images/quality/4k.svg`;
  } else if (videoStream.Width >= 2500) {
    baseQuality = "fhd";
    qualitySvg = `./slider/src/images/quality/fhd.svg`;
  } else if (videoStream.Width >= 1900) {
    baseQuality = "fhd";
    qualitySvg = `./slider/src/images/quality/fhd.svg`;
  } else if (videoStream.Width >= 1200) {
    baseQuality = "hd";
    qualitySvg = `./slider/src/images/quality/hd.svg`;
  }

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
