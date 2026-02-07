import { getSessionInfo, makeApiRequest, getAuthHeader, getEmbyHeaders, fetchItemDetails,  jms, updateFavoriteStatus, goToDetailsPage, getDetailsUrl } from "./api.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";

const config = getConfig();

function isMobileClient(session) {
  const client = session.Client?.toLowerCase() || '';
  return ['android', 'ios', 'iphone', 'ipad'].some(term => client.includes(term));
}

function playable(session) {
  return session.Capabilities?.PlayableMediaTypes?.some(t => t === 'Video' || t === 'Audio') ||
         isMobileClient(session);
}

let timeUpdateInterval;

export async function loadAvailableDevices(itemId, dropdown) {
  dropdown.innerHTML = `<div class="loading-text">${config.languageLabels.castyukleniyor}</div>`;

  try {
    const { userId } = getSessionInfo();
    const sessions = await makeApiRequest(`/Sessions?userId=${encodeURIComponent(userId)}`);
    const videoDevices = sessions.filter(s =>
      playable(s) ||
      ['android', 'ios', 'iphone', 'ipad'].some(term =>
        s.Client?.toLowerCase().includes(term))
    );

    if (videoDevices.length === 0) {
      dropdown.innerHTML = `<div class="no-devices">${config.languageLabels.castbulunamadi}</div>`;
      return;
    }

    const uniqueDevices = new Map();
    videoDevices.forEach(device => {
      const key = `${device.DeviceId || device.DeviceName}-${device.Client}`;
      if (!uniqueDevices.has(key)) {
        uniqueDevices.set(key, device);
      }
    });

    const sortedDevices = Array.from(uniqueDevices.values()).sort((a, b) => {
      const aActive = !!a.NowPlayingItem;
      const bActive = !!b.NowPlayingItem;
      return Number(bActive) - Number(aActive);
    });

    dropdown.innerHTML = '';

    const nowPlayingDevice = sortedDevices.find(device => device.NowPlayingItem);
    if (nowPlayingDevice) {
      const nowPlayingItem = nowPlayingDevice.NowPlayingItem;
      const nowPlayingItemId = nowPlayingItem.Id;
      const imageTag = nowPlayingItem.ImageTags?.Primary || '';
      const backdropTag = nowPlayingItem.ImageTags?.Backdrop?.[0] || '';

      const posterUrl = withServer(`/Items/${encodeURIComponent(nowPlayingItemId)}/Images/Primary?tag=${encodeURIComponent(imageTag)}&maxHeight=80`);
      const backdropUrl = withServer(`/Items/${encodeURIComponent(nowPlayingItemId)}/Images/Backdrop/${encodeURIComponent(backdropTag)}?tag=${encodeURIComponent(backdropTag)}&maxWidth=800`);

      const topBanner = document.createElement('div');
      topBanner.className = 'now-playing-banner';
      topBanner.style.backgroundImage = `url('${backdropUrl}')`;

      topBanner.innerHTML = `
        <div class="overlay"></div>
        <img class="now-playing-poster" src="${posterUrl}" alt="Poster">
        <div class="now-playing-details">
          <div class="now-playing-title"> <i class="fa-solid ${getMediaIconClass(nowPlayingItem)}"></i> ${nowPlayingItem.Name} </div>
          <div class="now-playing-device">${nowPlayingDevice.DeviceName || config.languageLabels.castcihaz}</div>
        </div>
      `;

      topBanner.addEventListener('click', () => showNowPlayingModal(nowPlayingItem, nowPlayingDevice));
      dropdown.appendChild(topBanner);

      const divider = document.createElement('hr');
      divider.className = 'cast-divider';
      dropdown.appendChild(divider);
    }

    sortedDevices.forEach(device => {
      const deviceElement = document.createElement('div');
      deviceElement.className = 'device-item';
      deviceElement.innerHTML = `
        <div class="device-icon-container">
          ${getDeviceIcon(device.Client)}
        </div>
        <div class="device-info">
          <div class="device-name">${device.DeviceName || config.languageLabels.castcihaz}</div>
          <div class="device-client">${device.Client || config.languageLabels.castistemci}</div>
          ${device.NowPlayingItem ? ` <div class="now-playing"> <i class="fa-solid ${getMediaIconClass(device.NowPlayingItem)}"></i> ${config.languageLabels.castoynatiliyor} </div>` : ''}
        </div>
      `;

      deviceElement.addEventListener('click', async (e) => {
        e.stopPropagation();
        const success = await startPlayback(itemId, device.Id);
        if (success) {
          dropdown.classList.add('hide');
        }
      });

      dropdown.appendChild(deviceElement);
    });
  } catch (error) {
    console.error('Cihazlar yüklenirken hata:', error);
    dropdown.innerHTML = `<div class="error-message">${config.languageLabels.casthata}: ${error.message}</div>`;
  }
}

export function getDeviceIcon(clientType) {
  const client = clientType?.toLowerCase() || '';
  const icons = {
    'android': `<i class="fa-brands fa-android" style="color: #a4c639;"></i>`,
    'ios': `<i class="fa-brands fa-apple" style="color: #ffffff;"></i>`,
    'iphone': `<i class="fa-brands fa-apple" style="color: #ffffff;"></i>`,
    'ipad': `<i class="fa-brands fa-apple" style="color: #ffffff;"></i>`,
    'smarttv': `<i class="fa-solid fa-tv" style="color: #ffffff;"></i>`,
    'chromecast': `<i class="fa-solid fa-chromecast" style="color: #ffffff;"></i>`,
    'dlna': `<i class="fa-solid fa-network-wired" style="color: #ffffff;"></i>`,
    'kodi': `<i class="fa-solid fa-tv" style="color: #ffffff;"></i>`,
    'roku': `<i class="fa-solid fa-tv" style="color: #ffffff;"></i>`
  };

  for (const [key, icon] of Object.entries(icons)) {
    if (client.includes(key)) {
      return icon;
    }
  }

  return `<i class="fa-solid fa-display" style="color: #ffffff;"></i>`;
}

export async function startPlayback(itemId, sessionId) {
  try {
    const playUrl = `/Sessions/${encodeURIComponent(sessionId)}/Playing?playCommand=PlayNow&itemIds=${encodeURIComponent(itemId)}`;

    const response = await fetch(withServer(playUrl), {
      method: "POST",
      headers: getEmbyHeaders({ "Content-Type": "application/json" })
    });

    if (!response.ok) {
      throw new Error(`${config.languageLabels.castoynatmahata}: ${response.statusText}`);
    }

    showNotification(config.languageLabels.castbasarili, 'success');
    return true;
  } catch (error) {
    console.error("Oynatma hatası:", error);
    showNotification(`${config.languageLabels.castoynatmahata}: ${error.message}`, 'error');
    return false;
  }
}

export function showNotification(message, type = 'info', duration = 3000) {
  const existingNotification = document.querySelector('.playback-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.className = `playback-notification ${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fa-solid ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-info-circle'}"></i>
      <span>${message}</span>
    </div>
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, duration);
}

export function hideNotification() {
  const notification = document.querySelector('.playback-notification');
  if (notification) {
    notification.classList.add('fade-out');
    setTimeout(() => {
      notification.remove();
    }, 500);
  }
}

async function showNowPlayingModal(nowPlayingItem, device) {
  try {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);

    const { userId } = getSessionInfo();
    const sessions = await makeApiRequest(`/Sessions?userId=${encodeURIComponent(userId)}`);
    const activeDevices = sessions.filter(s => playable(s) && s.NowPlayingItem);

    if (activeDevices.length === 0) {
      showNotification(config.languageLabels.castbulunamadi, 'error');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'castmodal';

    let modalContent = `
      <div class="castmodal-container">
        <div class="overlay"></div>
        <div class="castmodal-content">
    `;

    for (const [index, device] of activeDevices.entries()) {
      const item = device.NowPlayingItem;
      const isMuted = device.PlayState?.IsMuted || false;
      const volumeLevel = device.PlayState?.VolumeLevel ?? 50;
      const itemId = item.Id;

      const itemDetails = await fetchItemDetails(itemId);
        if (!itemDetails) throw new Error("Item detayları alınamadı");
      const { posterUrl, backdropUrl, placeholderUrl } = getHighResImageUrls(item);
      const playedTicks = device.PlayState?.PositionTicks || 0;
      const durationTicks = itemDetails.RunTimeTicks || 0;
      const played = formatTime(playedTicks);
      const duration = formatTime(durationTicks);
      const user = device.UserName || config.languageLabels.belirsizkullanici;
      const client = device.Client || config.languageLabels.belirsizistemci;
      const deviceName = device.DeviceName || config.languageLabels.belirsizcihaz;
      const isPaused = device.PlayState?.IsPaused;
      const isFavorite = itemDetails.UserData?.IsFavorite;
      const genres = itemDetails.Genres?.join(", ") || '';
      const imdbRating = itemDetails.CommunityRating ? `${itemDetails.CommunityRating.toFixed(1)}` : '';
      const tmdbRating = itemDetails.OfficialRating || '';
      const audioLanguages = itemDetails.MediaStreams?.filter(s => s.Type === 'Audio').map(s => s.Language)?.join(', ') || '';
      const subtitleLanguages = itemDetails.MediaStreams?.filter(s => s.Type === 'Subtitle').map(s => s.Language)?.join(', ') || '';
      const overview = itemDetails.Overview || '';
      const year = itemDetails.ProductionYear || '';
      const tmdbId = itemDetails.ProviderIds?.Tmdb;
      const imdbId = itemDetails.ProviderIds?.Imdb;
      const itemPageUrl = getDetailsUrl(itemId);
      const artists = itemDetails.Artists?.join(", ") || '';
      const album = itemDetails.Album || '';
      const albumArtist = itemDetails.AlbumArtist || '';
      const trackNumber = itemDetails.IndexNumber || '';
      const directors = itemDetails.People
        ? itemDetails.People
            .filter(p => p.Type?.toLowerCase() === "director")
            .map(d => d.Name)
            .join(", ")
        : '';

      modalContent += `
        <div class="castmodal-slide" data-backdrop="${backdropUrl}">
          <img class="castmodal-poster lazy-load"
               src="${placeholderUrl}"
               data-src="${posterUrl}"
               alt="Poster">
          <div class="castmodal-info">
            <h2><i class="fa-solid ${getMediaIconClass(item)}"></i> ${item.Name}</h2>
            ${user ? `<p><strong>${config.languageLabels.kullanici}:</strong> ${user}</p>` : ''}
            ${deviceName ? `<p><strong>${config.languageLabels.cihaz}:</strong> ${deviceName}</p>` : ''}
            ${client ? `<p><strong>${config.languageLabels.istemci}:</strong> ${client}</p>` : ''}
            <p><strong>${config.languageLabels.sure}:</strong> ${played} / ${duration}</p>
            ${year ? `<p><strong>${config.languageLabels.year || "Yıl"}:</strong> ${year}</p>` : ''}
            ${directors ? `<p><strong>${config.languageLabels.yonetmen || "Yönetmen"}:</strong> ${directors}</p>` : ''}
            ${overview ? `<p><strong>${config.languageLabels.konu || "Konu"}:</strong> ${overview}</p>` : ''}

            <div class="castRating-container">
              ${imdbRating ? `<span class="castimdb-rating"><i class="fas fa-star"></i> ${imdbRating}</span>` : ''}
              ${tmdbRating ? `<span class="casttmdb-rating"><i class="fas fa-family"></i> ${tmdbRating}</span>` : ''}
            </div>

            ${tmdbId ? `<p><strong>TMDB:</strong> <a href="https://www.themoviedb.org/${item.Type === 'Episode' ? 'tv' : 'movie'}/${tmdbId}" target="_blank">Link</a></p>` : ''}
            ${imdbId ? `<p><strong>IMDB:</strong> <a href="https://www.imdb.com/title/${imdbId}" target="_blank">Link</a></p>` : ''}
            ${itemPageUrl ? `<p><a href="${itemPageUrl}" class="open-in-new" target="_blank" rel="noopener noreferrer">${config.languageLabels.yenisekme || "Yeni sekmede aç"}</a></p>` : ''}
            ${genres ? `<p><strong>${config.languageLabels.etiketler}:</strong> ${genres}</p>` : ''}
            ${audioLanguages ? `<p><strong>${config.languageLabels.ses}:</strong> ${audioLanguages}</p>` : ''}
            ${subtitleLanguages ? `<p><strong>${config.languageLabels.altyazi}:</strong> ${subtitleLanguages}</p>` : ''}
            ${artists ? `<p><strong>${config.languageLabels.sortArtist || "Sanatçı"}:</strong> ${artists}</p>` : ''}
            ${album ? `<p><strong>${config.languageLabels.sortAlbum || "Albüm"}:</strong> ${album}</p>` : ''}
            ${albumArtist ? `<p><strong>${config.languageLabels.sortAlbumArtist || "Albüm Sanatçısı"}:</strong> ${albumArtist}</p>` : ''}
            ${trackNumber ? `<p><strong>${config.languageLabels.tracknumber || "Parça Numarası"}:</strong> ${trackNumber}</p>` : ''}

            <div class="castmodal-buttons">
              <button class="castcontrol-button" data-session-id="${device.Id}" data-is-paused="${isPaused}">
              ${isPaused ? '▶️ ' + config.languageLabels.devamet : '⏸️ ' + config.languageLabels.duraklat}
              </button>
              <button class="castcontrol-button" data-item-id="${itemId}" data-is-favorite="${isFavorite}">
                ${isFavorite
                  ? '💔 ' + config.languageLabels.removeFromFavorites
                  : '❤️ ' + config.languageLabels.addToFavorites
                }
              </button>
              ${createVolumeControls(modal, device, isMuted, volumeLevel)}
            </div>
            ${await getServerInfoHtml()}
          </div>
        </div>
      `;
    }

    modalContent += `
        </div>
        <button class="castmodal-close">×</button>
        <div class="castmodal-dots">
          ${activeDevices.map((_, index) =>
            `<span class="castmodal-dot ${index === 0 ? 'active' : ''}" data-index="${index}"></span>`
          ).join('')}
        </div>
      </div>
    `;

    modal.innerHTML = modalContent;
    timeUpdateInterval = setInterval(() => updatePlaybackTimes(modal, activeDevices), 1000);

    document.body.appendChild(modal);

    modal.querySelectorAll('.server-info-header').forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        const toggleButton = header.querySelector('.toggle-server-info');
        const isShowing = content.style.display === 'block';

        content.style.display = isShowing ? 'none' : 'block';
        toggleButton.classList.toggle('active', !isShowing);
        toggleButton.setAttribute('aria-label',
          isShowing
            ? config.languageLabels.showServerInfo
            : config.languageLabels.hideServerInfo
        );
        toggleButton.innerHTML = isShowing
          ? '<i class="fas fa-chevron-down"></i>'
          : '<i class="fas fa-chevron-up"></i>';
      });
    });

    const lazyImages = modal.querySelectorAll('.lazy-load');
    lazyImages.forEach(img => {
      const highResImg = new Image();
      highResImg.src = img.dataset.src;
      highResImg.onload = () => {
        img.src = highResImg.src;
        img.classList.add('loaded');
      };
    });

    modal.querySelectorAll('.mute-button').forEach(button => {
      button.addEventListener('click', async e => {
        e.stopPropagation();
        e.preventDefault();

        const sessionId = button.dataset.sessionId;
        theMuteToggle:
        {
          const isMuted = button.dataset.isMuted === 'true';
          const slider = modal.querySelector(`.volume-slider[data-session-id="${sessionId}"]`);
          const valueLabel = modal.querySelector(`.volume-value[data-session-id="${sessionId}"]`);

          try {
            await makeApiRequest(`/Sessions/${encodeURIComponent(sessionId)}/Command`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                Name: isMuted ? 'Unmute' : 'Mute',
                ControllingUserId: getSessionInfo().userId
              })
            });

            let newVolume;
            if (isMuted) {
              newVolume = button.dataset.lastVolume || '50';
            } else {
              button.dataset.lastVolume = slider.value;
              newVolume = '0';
            }
            slider.value = newVolume;
            if (valueLabel) valueLabel.textContent = `${newVolume}%`;
            button.dataset.isMuted = (!isMuted).toString();
            button.innerHTML = !isMuted
              ? '🔊 ' + config.languageLabels.sesac
              : '🔇 ' + config.languageLabels.seskapat;

            showNotification(
              !isMuted
                ? config.languageLabels.volOff
                : config.languageLabels.volOn,
              'success'
            );
            await makeApiRequest(`/Sessions/${encodeURIComponent(sessionId)}/Command`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                Name: 'SetVolume',
                ControllingUserId: getSessionInfo().userId,
                Arguments: { Volume: parseInt(newVolume, 10) }
              })
            });

          } catch (err) {
            console.error("Mute/Unmute hatası:", err);
            showNotification(`${config.languageLabels.seshata}: ${err.message}`, 'error');
          }
        }
      });
    });

    modal.querySelector('.castmodal-close').addEventListener('click', () => {
      clearInterval(timeUpdateInterval);
      modal.remove();
    });

    modal.querySelectorAll('.castcontrol-button[data-session-id]:not(.mute-button)').forEach(button => {
      button.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        const sessionId = button.dataset.sessionId;
        const isPaused = button.dataset.isPaused === 'true';
        await togglePlayback(sessionId, isPaused);
      });
    });

    modal.querySelectorAll('.castcontrol-button[data-item-id]').forEach(button => {
      button.addEventListener('click', async e => {
        e.stopPropagation();
        const itemId = button.dataset.itemId;
        const isFav = button.dataset.isFavorite === 'true';
        await toggleFavorite(itemId, !isFav);
      });
    });

    modal.addEventListener('input', async (e) => {
      if (!e.target.classList.contains('volume-slider')) return;

      const slider = e.target;
      const sessionId = slider.dataset?.sessionId;
      if (!sessionId) return;

      const volume = parseInt(slider.value, 10);
      const volumeValue = modal.querySelector(`.volume-value[data-session-id="${sessionId}"]`);
      const muteButton = modal.querySelector(`.mute-button[data-session-id="${sessionId}"]`);

      try {
        if (muteButton?.dataset.isMuted === 'true') {
          await makeApiRequest(`/Sessions/${encodeURIComponent(sessionId)}/Command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Name: 'Unmute', ControllingUserId: getSessionInfo().userId })
          });

          muteButton.dataset.isMuted = 'false';
          muteButton.innerHTML = '🔇 ' + config.languageLabels.seskapat;
        }

        await makeApiRequest(`/Sessions/${encodeURIComponent(sessionId)}/Command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Name: 'SetVolume',
            ControllingUserId: getSessionInfo().userId,
            Arguments: { Volume: volume }
          })
        });
        if (volumeValue) volumeValue.textContent = `${volume}%`;
        slider.dataset.lastVolume = volume;
        if (volume === 0 && muteButton) {
          muteButton.dataset.isMuted = 'true';
          muteButton.innerHTML = '🔊 ' + config.languageLabels.sesac;
        }

      } catch (err) {
        console.error("Ses seviyesi hatası:", err);
        showNotification(`${config.languageLabels.seshata}: ${err.message}`, 'error');
        const lastVolume = slider.dataset.lastVolume || '50';
        slider.value = lastVolume;
        if (volumeValue) volumeValue.textContent = `${lastVolume}%`;
      }
    });

    const content = modal.querySelector('.castmodal-content');
    const dots = modal.querySelectorAll('.castmodal-dot');
    const container = modal.querySelector('.castmodal-container');

    const firstBackdrop = modal.querySelector('.castmodal-slide')?.dataset.backdrop;
    if (firstBackdrop) {
      container.style.opacity = 0;
      setTimeout(() => {
        container.style.backgroundImage = `url('${firstBackdrop}')`;
        container.style.opacity = 1;
      }, 50);
    }

    content.addEventListener('scroll', () => {
      const scrollPosition = content.scrollLeft;
      const slideWidth = content.clientWidth;
      const activeIndex = Math.round(scrollPosition / slideWidth);
      const activeSlide = content.querySelector(`.castmodal-slide:nth-child(${activeIndex + 1})`);
      if (activeSlide) {
        container.style.backgroundImage = `url('${activeSlide.dataset.backdrop}')`;
      }

      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === activeIndex);
      });
    });

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.index);
        content.scrollTo({
          left: index * content.clientWidth,
          behavior: 'smooth'
        });
      });
    });

  } catch (err) {
    console.error("Modal hatası:", err);
    showNotification(`${config.languageLabels.icerikhata}: ${err.message}`, 'error');
  }
}

async function getServerInfoHtml() {
  try {
    const info = await getServerInfo();
    const localTime = new Date().toLocaleString();

    return `
      <div class="server-info-container">
        <div class="server-info-header">
          <h3><i class="fas fa-server"></i> ${config.languageLabels.sunucubilgi || 'Sunucu Bilgisi'}</h3>
          <button class="toggle-server-info" aria-label="${config.languageLabels.showServerInfo}">
            <i class="fas fa-chevron-down"></i>
          </button>
        </div>
        <div class="server-info-content" style="display: none;">
          <div class="server-info-grid">
            <div class="server-info-item">
              <strong>${config.languageLabels.servername || 'Sunucu Adı'}:</strong>
              <span>${info.ServerName || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.surumu || 'Sürüm'}:</strong>
              <span>${info.Version || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.productname || 'Uygulama Adı'}:</strong>
              <span>${info.ProductName || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.isletimsistemi || 'İşletim Sistemi'}:</strong>
              <span>${info.OperatingSystemDisplayName || info.OperatingSystem || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.systemarch || 'Sistem Mimarisi'}:</strong>
              <span>${info.SystemArchitecture || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.packagename || 'Paket Adı'}:</strong>
              <span>${info.PackageName || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.localaddress || 'Yerel Adres'}:</strong>
              <span>${info.LocalAddress || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.websocketport || 'WebSocket Port'}:</strong>
              <span>${info.WebSocketPortNumber || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.localTime || 'Yerel Zaman'}:</strong>
              <span class="local-time-display">${localTime}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.startupwizard || 'Kurulum Sihirbazı'}:</strong>
              <span>${info.StartupWizardCompleted ? config.languageLabels.tamamlandi || 'Tamamlandı' : config.languageLabels.tamamlanmadi || 'Tamamlanmadı'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.pendingrestart || 'Bekleyen Yeniden Başlatma'}:</strong>
              <span>${info.HasPendingRestart ? config.languageLabels.evet || 'Evet' : config.languageLabels.hayir || 'Hayır'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.shuttingdown || 'Kapatılıyor'}:</strong>
              <span>${info.IsShuttingDown ? config.languageLabels.evet || 'Evet' : config.languageLabels.hayir || 'Hayır'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.updateavailable || 'Güncelleme Var'}:</strong>
              <span>${info.HasUpdateAvailable ? config.languageLabels.evet || 'Evet' : config.languageLabels.hayir || 'Hayır'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.selfrestart || 'Kendini Yeniden Başlatabilir'}:</strong>
              <span>${info.CanSelfRestart ? config.languageLabels.evet || 'Evet' : config.languageLabels.hayir || 'Hayır'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.launchbrowser || 'Tarayıcı Açabilir'}:</strong>
              <span>${info.CanLaunchWebBrowser ? config.languageLabels.evet || 'Evet' : config.languageLabels.hayir || 'Hayır'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.librarymonitor || 'Kütüphane İzleme'}:</strong>
              <span>${info.SupportsLibraryMonitor ? config.languageLabels.destekleniyor || 'Destekleniyor' : config.languageLabels.desteklenmiyor || 'Desteklenmiyor'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.encoderlocation || 'Encoder Konumu'}:</strong>
              <span>${info.EncoderLocation || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.programdatapath || 'Program Veri Yolu'}:</strong>
              <span class="path">${info.ProgramDataPath || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.webpath || 'Web Yolu'}:</strong>
              <span class="path">${info.WebPath || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.logpath || 'Log Yolu'}:</strong>
              <span class="path">${info.LogPath || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.osdisplayname}:</strong>
              <span>${info.OperatingSystemDisplayName || info.OperatingSystem || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.itemsbynamepath}:</strong>
              <span class="path">${info.ItemsByNamePath || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.cachepath}:</strong>
              <span class="path">${info.CachePath || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.internalmetadatapath}:</strong>
              <span class="path">${info.InternalMetadataPath || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.transcodetemppath}:</strong>
              <span class="path">${info.TranscodingTempPath || 'N/A'}</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.castreceiverapps}:</strong>
              <span>${(info.CastReceiverApplications?.length ?? 0)} adet</span>
            </div>
            <div class="server-info-item">
              <strong>${config.languageLabels.completedinstalls}:</strong>
              <span>${(info.CompletedInstallations?.length ?? 0)} adet</span>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Sunucu bilgisi alınırken hata:', error);
    return `
      <div class="server-info-container">
        <div class="error-message">${config.languageLabels.sunucubilgihata || 'Sunucu bilgisi alınamadı'}</div>
      </div>
    `;
  }
}

function formatTime(ticks) {
  if (!ticks || ticks <= 0) return '0:00';

  const totalSeconds = Math.floor(ticks / 10_000_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function togglePlayback(sessionId, currentlyPaused) {
  const command = currentlyPaused ? 'Unpause' : 'Pause';

  try {
    await makeApiRequest(`/Sessions/${encodeURIComponent(sessionId)}/Playing/${command}`, {
      method: 'POST'
    });

    const buttons = document.querySelectorAll(`.castcontrol-button[data-session-id="${sessionId}"]:not(.mute-button)`);
    buttons.forEach(button => {
      button.dataset.isPaused = !currentlyPaused;
      button.innerHTML = !currentlyPaused
        ? '▶️ ' + (config.languageLabels.devamet || "Devam Ettir")
        : '⏸️ ' + (config.languageLabels.duraklat || "Duraklat");
    });

    showNotification(
      command === 'Pause'
        ? config.languageLabels.duraklatildi
        : config.languageLabels.devamettirildi,
      'success'
    );
  } catch (err) {
    showNotification(`${config.languageLabels.islemhatasi}: ${err.message}`, 'error');
  }
}

async function toggleFavorite(itemId, makeFavorite) {
  try {
    await updateFavoriteStatus(itemId, makeFavorite);
    const buttons = document.querySelectorAll(`[data-item-id="${itemId}"]`);
    buttons.forEach(button => {
      button.dataset.isFavorite = makeFavorite;
      button.innerHTML = makeFavorite
        ? '💔 ' + (config.languageLabels.removeFromFavorites || "Favoriden Kaldır")
        : '❤️ ' + (config.languageLabels.addToFavorites || "Favoriye Ekle");
    });

    showNotification(
      makeFavorite
        ? config.languageLabels.favorieklemesuccess
        : config.languageLabels.favoricikarmasuccess,
      'success'
    );
  } catch (err) {
    console.error("Favori işlem hatası:", err);
    showNotification(`${config.languageLabels.favorihata}: ${err.message}`, 'error');
  }
}

async function updatePlaybackTimes(modal, activeDevices) {
  try {
    const { userId } = getSessionInfo();
    const sessions = await makeApiRequest(`/Sessions?userId=${encodeURIComponent(userId)}`);
    const newActive = sessions.filter(s => playable(s) && s.NowPlayingItem);
    if (newActive.length === 0) {
      modal.remove();
      clearInterval(timeUpdateInterval);
      return;
    }

    const oldIds = activeDevices.map(d => d.Id).sort().join(',');
    const newIds = newActive.map(d => d.Id).sort().join(',');
    const oldItemIds = activeDevices.map(d => d.NowPlayingItem?.Id).sort().join(',');
    const newItemIds = newActive.map(d => d.NowPlayingItem?.Id).sort().join(',');

    if (oldIds !== newIds || oldItemIds !== newItemIds) {
      modal.remove();
      clearInterval(timeUpdateInterval);
      if (newActive.length > 0) {
        showNowPlayingModal(newActive[0].NowPlayingItem, newActive[0]);
      }
      return;
    }

    activeDevices.forEach((device, index) => {
      const currentSession = sessions.find(s => s.Id === device.Id);
      if (!currentSession || !currentSession.NowPlayingItem) return;

      const playedTicks = currentSession.PlayState?.PositionTicks || 0;
      const durationTicks = currentSession.NowPlayingItem.RunTimeTicks || 0;
      const played = formatTime(playedTicks);
      const duration = formatTime(durationTicks);
      const isPaused = currentSession.PlayState?.IsPaused;

      const timeElement = modal.querySelector(`.castmodal-slide:nth-child(${index + 1}) .castmodal-info p:nth-child(5)`);
      if (timeElement) {
        timeElement.innerHTML = `<strong>${config.languageLabels.sure || "Süre"}:</strong> ${played} / ${duration}`;
      }

      const playButton = modal.querySelector(`.castmodal-slide:nth-child(${index + 1}) .castcontrol-button[data-session-id="${device.Id}"]:not(.mute-button)`);
      if (playButton) {
        playButton.dataset.isPaused = isPaused;
        playButton.innerHTML = isPaused
          ? '▶️ ' + (config.languageLabels.devamet || "Devam Ettir")
          : '⏸️ ' + (config.languageLabels.duraklat || "Duraklat");
      }
    });
    if (modal) {
      modal.querySelectorAll('.local-time-display').forEach(el => {
        el.textContent = new Date().toLocaleString();
      });
    }
  } catch (err) {
    console.error("Zaman güncelleme hatası:", err);
    if (modal) modal.remove();
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
  }
}

export function getMediaIconClass(media) {
  const itemType = (media.ItemType || '').toLowerCase();
  const type = (media.Type || '').toLowerCase();

  const icons = {
    audio: 'fa-music',
    music: 'fa-headphones',
    musicalbum: 'fa-compact-disc',
    song: 'fa-headphones',
    movie: 'fa-film',
    series: 'fa-tv',
    episode: 'fa-clapperboard',
    videoclip: 'fa-video',
    musicvideo: 'fa-video',
    homevideo: 'fa-video',
    livetv: 'fa-satellite-dish',
    channel: 'fa-broadcast-tower',
    audiobook: 'fa-book-open',
    photo: 'fa-image',
    trailer: 'fa-film',
    default: 'fa-photo-film'
  };

  return icons[itemType] || icons[type] || icons.default;
}

function createVolumeControls(modal, device, isMuted = false, volume = 50) {
  const displayVolume = isMuted ? 0 : volume;
  return `
    <div class="volume-control-container">
      <button class="castcontrol-button mute-button"
              data-session-id="${device.Id}"
              data-is-muted="${isMuted}">
        ${isMuted ? '🔊 ' + config.languageLabels.sesac : '🔇 ' + config.languageLabels.seskapat}
      </button>
      <div class="volume-control">
        <input type="range" min="0" max="100" value="${displayVolume}"
               data-session-id="${device.Id}" class="volume-slider"
               data-last-volume="${volume}">
        <span class="volume-value" data-session-id="${device.Id}">${displayVolume}%</span>
      </div>
    </div>
  `;
}

function getHighResImageUrls(item) {
  const itemId = item.Id;
  const imageTag = item.ImageTags?.Primary || '';
  const backdropTag = item.ImageTags?.Backdrop?.[0] || '';
  const pixelRatio = window.devicePixelRatio || 1;
  const posterHeight = Math.floor(300 * pixelRatio);
  const backdropWidth = Math.floor(1280 * pixelRatio);
  const supportsWebP = document.createElement('canvas').toDataURL('image/webp').includes('webp');
  const formatParam = supportsWebP ? '&format=webp' : '';
  return {
    posterUrl: withServer(`/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(imageTag)}&quality=90&maxHeight=${posterHeight}${formatParam}`),
    backdropUrl: withServer(`/Items/${encodeURIComponent(itemId)}/Images/Backdrop/0?tag=${encodeURIComponent(backdropTag)}&quality=90&maxWidth=${backdropWidth}${formatParam}`),
    placeholderUrl: withServer(`/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(imageTag)}&maxHeight=50&blur=10`)
  };
}

function formatUptime(start, now) {
  if (!start || !now) return 'N/A';
  const diff = Math.floor((now - start) / 1000);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  return `${days}g ${hours}s ${minutes}dk`;
}

async function getServerInfo() {
  try {
    const info = await makeApiRequest('/System/Info');
    return info || {};
  } catch (error) {
    console.error('Sunucu bilgisi alınırken hata:', error);
    return {};
  }
}
