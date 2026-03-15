import { makeApiRequest, getSessionInfo, waitForAuthReadyStrict } from "./api.js";
import { getServerAddress, getConfig } from "./config.js";
import { addStyleSpecificParams } from "./dicebearSpecificParams.js";

const config = getConfig();
let customAvatarAdded = false;
let avatarObserver = null;
let currentAvatarElement = null;
let avatarRotationInterval = null;
const AVATAR_ROTATION_INTERVAL = 10000;
let _updatingAvatar = false;

const userCache = {
  data: null,
  timestamp: 0,
  cacheDuration: config.avatarCacheDuration || 300000
};

const DICEBEAR_OPTIONS = {
  styles: [
    { id: 'adventurer', name: 'Adventurer' },
    { id: 'adventurer-neutral', name: 'Adventurer Neutral' },
    { id: 'avataaars', name: 'Avataaars' },
    { id: 'avataaars-neutral', name: 'Avataaars Neutral' },
    { id: 'big-ears', name: 'Big Ears' },
    { id: 'big-ears-neutral', name: 'Big Ears Neutral' },
    { id: 'big-smile', name: 'Big Smile' },
    { id: 'bottts', name: 'Bottts' },
    { id: 'bottts-neutral', name: 'Bottts Neutral' },
    { id: 'croodles', name: 'Croodles' },
    { id: 'croodles-neutral', name: 'Croodles Neutral' },
    { id: 'dylan', name: 'Dylan' },
    { id: 'fun-emoji', name: 'Fun Emoji' },
    { id: 'glass', name: 'Glass' },
    { id: 'icons', name: 'Icons' },
    { id: 'identicon', name: 'Identicon' },
    { id: 'initials', name: 'Initials' },
    { id: 'lorelei', name: 'Lorelei' },
    { id: 'lorelei-neutral', name: 'Lorelei Neutral' },
    { id: 'micah', name: 'Micah' },
    { id: 'miniavs', name: 'Mini Avatars' },
    { id: 'notionists', name: 'Notionists' },
    { id: 'notionists-neutral', name: 'Notionists Neutral' },
    { id: 'open-peeps', name: 'Open Peeps' },
    { id: 'personas', name: 'Personas' },
    { id: 'pixel-art', name: 'Pixel Art' },
    { id: 'pixel-art-neutral', name: 'Pixel Art Neutral' },
    { id: 'rings', name: 'Rings' },
    { id: 'shapes', name: 'Shapes' },
    { id: 'thumbs', name: 'Thumbs' }
  ],
  baseUrl: 'https://api.dicebear.com/9.x'
};

function getValidParamsForStyle(style) {
  const paramsMap = {
  'adventurer': ['seed', 'flip', 'earrings', 'earringsProbability', 'glasses', 'glassesProbability', 'hair', 'hairColor', 'hairProbability', 'skinColor', 'mouth', 'eyebrows', 'eyes', 'features', 'featuresProbability'],
  'adventurer-neutral': ['seed', 'flip', 'eyebrows', 'eyes', 'glasses', 'glassesProbability', 'mouth'],
  'avataaars': ['seed', 'flip', 'accessories', 'accessoriesColor', 'accessoriesProbability', 'clothesColor', 'clothing', 'clothingGraphic', 'eyebrows', 'eyes', 'facialHair', 'facialHairColor', 'facialHairProbability', 'hairColor', 'hatColor', 'mouth', 'skinColor', 'top', 'topProbability'],
  'avataaars-neutral': ['seed', 'flip', 'eyebrows', 'eyes', 'mouth'],
  'big-ears': ['seed', 'flip', 'cheek', 'cheekProbability', 'ear', 'eyes', 'face', 'frontHair', 'hair', 'hairColor', 'mouth', 'nose', 'sideburn', 'skinColor'],
  'big-ears-neutral': ['seed', 'flip', 'cheek', 'cheekProbability', 'eyes', 'mouth', 'nose'],
  'big-smile': ['seed', 'flip', 'accessories', 'accessoriesProbability', 'eyes', 'hair', 'hairColor', 'mouth', 'skinColor'],
  'bottts': ['seed', 'baseColor', 'eyes', 'face', 'mouth', 'mouthProbability', 'sides', 'sidesProbability', 'texture', 'textureProbability', 'top', 'topProbability'],
  'bottts-neutral': ['seed', 'baseColor', 'eyes', 'face', 'mouth', 'mouthProbability', 'sides', 'sidesProbability', 'texture', 'textureProbability', 'top', 'topProbability'],
  'croodles': ['seed', 'flip', 'beard', 'beardProbability', 'eyes', 'face', 'mouth', 'mustache', 'mustacheProbability', 'nose', 'top', 'topColor'],
  'croodles-neutral': ['seed', 'flip', 'beard', 'beardProbability', 'eyes', 'face', 'mouth', 'mustache', 'mustacheProbability', 'nose', 'top', 'topColor'],
  'dylan': ['seed', 'flip', 'facialHair', 'facialHairProbability', 'hair', 'hairColor', 'mood', 'skinColor'],
  'fun-emoji': ['seed', 'flip', 'eyes', 'mouth'],
  'glass': ['seed', 'flip', 'shape1', 'shape2'],
  'icons': ['seed', 'flip', 'icon'],
  'identicon': ['seed', 'flip', 'row1', 'row2', 'row3', 'row4', 'row5', 'rowColor'],
  'initials': ['seed', 'flip'],
  'lorelei': ['seed', 'flip', 'beard', 'beardProbability', 'earrings', 'earringsProbability', 'eyebrows', 'eyes', 'eyebrowsColor', 'eyesColor', 'freckles', 'frecklesProbability', 'glasses', 'glassesProbability', 'hair', 'hairColor', 'hairAccessories', 'hairAccessoriesColor', 'hairAccessoriesProbability', 'head', 'mouth', 'nose'],
  'lorelei-neutral': ['seed', 'flip', 'beard', 'beardProbability', 'earrings', 'earringsProbability', 'eyebrows', 'eyes', 'eyebrowsColor', 'eyesColor', 'freckles', 'frecklesProbability', 'glasses', 'glassesProbability', 'hair', 'hairColor', 'hairAccessories', 'hairAccessoriesColor', 'hairAccessoriesProbability', 'head', 'mouth', 'nose'],
  'micah': ['seed', 'flip', 'baseColor', 'earringColor', 'earrings', 'earringsProbability', 'ears', 'eyeShadowColor', 'eyebrows', 'eyebrowsColor', 'eyes', 'eyesColor', 'facialHair', 'facialHairColor', 'facialHairProbability', 'glasses', 'glassesColor', 'glassesProbability', 'hair', 'hairColor', 'hairProbability', 'mouth', 'nose', 'shirt', 'shirtColor'],
  'miniavs': ['seed', 'flip', 'blushesProbability', 'body', 'bodyColor', 'eyes', 'glasses', 'glassesProbability', 'hair', 'hairColor', 'head', 'mouth', 'mustache', 'mustacheProbability', 'skinColor'],
  'notionists': ['seed', 'flip', 'beard', 'beardProbability', 'body', 'bodyIcon', 'bodyIconProbability', 'brows', 'eyes', 'gesture', 'gestureProbability', 'glasses', 'glassesProbability', 'hair', 'lips', 'nose'],
  'notionists-neutral': ['seed', 'flip', 'beard', 'beardProbability', 'body', 'bodyIcon', 'bodyIconProbability', 'brows', 'eyes', 'gesture', 'gestureProbability', 'glasses', 'glassesProbability', 'hair', 'lips', 'nose'],
  'open-peeps': ['seed', 'flip', 'accessories', 'accessoriesProbability', 'clothingColor', 'face', 'facialHair', 'facialHairProbability', 'head', 'mask', 'maskProbability', 'skinColor'],
  'personas': ['seed', 'flip', 'body', 'clothingColor', 'eyes', 'facialHair', 'facialHairProbability', 'hair', 'hairColor', 'mouth', 'nose', 'skinColor'],
  'pixel-art': ['seed', 'flip', 'accessories', 'accessoriesColor', 'accessoriesProbability', 'beard', 'beardProbability', 'clothing', 'clothingColor', 'eyes', 'eyesColor', 'glasses', 'glassesColor', 'glassesProbability', 'hair', 'hairColor', 'hat', 'hatColor', 'hatProbability', 'mouth', 'mouthColor', 'skinColor'],
  'pixel-art-neutral': ['seed', 'flip', 'accessories', 'accessoriesColor', 'accessoriesProbability', 'beard', 'beardProbability', 'clothing', 'clothingColor', 'eyes', 'eyesColor', 'glasses', 'glassesColor', 'glassesProbability', 'hair', 'hairColor', 'hat', 'hatColor', 'hatProbability', 'mouth', 'mouthColor', 'skinColor'],
  'rings': ['seed', 'flip', 'ringColor', 'ringRotation', 'ringFive', 'ringFiveRotation', 'ringFour', 'ringFourRotation', 'ringOne', 'ringOneRotation', 'ringThree', 'ringThreeRotation', 'ringTwo', 'ringTwoRotation'],
  'shapes': ['seed', 'flip', 'shape1', 'shape1Color', 'shape1OffsetX', 'shape1OffsetY', 'shape1Rotation', 'shape2', 'shape2Color', 'shape2OffsetX', 'shape2OffsetY', 'shape2Rotation', 'shape3', 'shape3Color', 'shape3OffsetX', 'shape3OffsetY', 'shape3Rotation'],
  'thumbs': ['seed', 'flip', 'eyes', 'eyesColor', 'face', 'faceOffsetX', 'faceOffsetY', 'faceRotation', 'mouth', 'mouthColor', 'shape', 'shapeColor', 'shapeOffsetX', 'shapeOffsetY', 'shapeRotation']
};
  return paramsMap[style] || [];
}

 async function waitForAuthReady(timeout = 15000) {
   const start = Date.now();
   while (Date.now() - start < timeout) {
     try {
       const s = getSessionInfo();
       if (s?.accessToken) return s;
     } catch {}
     await new Promise(r => setTimeout(r, 250));
   }
   return null;
 }


export async function updateHeaderUserAvatar() {
  try {
    if (_updatingAvatar) return { status: 'busy' };
    _updatingAvatar = true;
    const config = getConfig?.();
    if (config && config.createAvatar === false) {
      cleanAvatars();
      customAvatarAdded = false;
      _updatingAvatar = false;
      return { status: 'disabled' };
    }

    const [headerButton, user] = await Promise.all([
      waitForElement("button.headerUserButton"),
      (await waitForAuthReadyStrict(12000), ensureUserData())
    ]);

    if (!headerButton || !user) {
      _updatingAvatar = false;
      return { status: 'pending', headerButton: !!headerButton, user: !!user };
    }

    if (hasJellyfinAvatar(headerButton)) {
      if (customAvatarAdded) {
        cleanAvatars();
        customAvatarAdded = false;
      }
      _updatingAvatar = false;
      return { status: 'native' };
    }

    const avatarElement = await createAvatar(user);
    if (!avatarElement) {
      _updatingAvatar = false;
      return { status: 'pending', headerButton: true, user: true };
    }

    cleanAvatars(headerButton);
    avatarElement.classList.add("custom-user-avatar");
    const label = (user?.Name || "User") + " avatar";
    avatarElement.setAttribute('role','img');
    avatarElement.setAttribute('aria-label', label);
    headerButton.appendChild(avatarElement);
    currentAvatarElement = avatarElement;
    customAvatarAdded = true;

    applyAvatarStyles(avatarElement);
    setupAvatarProtection(headerButton, user);
    return { status: 'custom' };
  } catch (err) {
    console.error("Avatar güncelleme hatası:", err);
    return { status: 'error', error: err };
    } finally {
    _updatingAvatar = false;
  }
}

async function ensureUserData() {
  const now = Date.now();
  if (!userCache.data || now - userCache.timestamp > userCache.cacheDuration) {
    const sess = await waitForAuthReady();
    if (!sess) return null;
    try {
      userCache.data = await makeApiRequest("/Users/Me");
      userCache.timestamp = Date.now();
    } catch {
      return null;
   }
  }
  return userCache.data;
}

async function createAvatar(user) {
  const config = getConfig();
  const cacheKey = `avatar-${user.Id}-${config.avatarStyle}-${config.dicebearStyle || ''}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    const div = document.createElement('div');
    div.innerHTML = cached;
    const node = div.firstElementChild || div.firstChild;
    if (node) node.classList.add('custom-user-avatar');
    return node || null;
  }

  const avatar = config.avatarStyle === 'dicebear' && config.dicebearStyle
    ? await createDicebearAvatar(user)
    : createInitialsAvatar(user);

  if (avatar) {
    sessionStorage.setItem(cacheKey, avatar.outerHTML);
  }

  return avatar;
}

async function createDicebearAvatar(user) {
  try {
    const config = getConfig();
    const style = config.dicebearStyle || 'initials';
    const seed = encodeURIComponent(user.Name || user.Id + Date.now());
    const size = Math.max(config.avatarWidth, config.avatarHeight, 64);
    const scale = parseFloat(getConfig().avatarScale) || 1;

    const params = new URLSearchParams();
    params.append('seed', seed);
    params.append('size', size.toString());

    if (config.randomDicebearAvatar) {
      addStyleSpecificParams(params, style);
    } else if (config.dicebearParams) {
      const validParams = getValidParamsForStyle(style);
      Object.entries(config.dicebearParams).forEach(([key, value]) => {
        if (validParams.includes(key) && value) {
          params.append(key, value);
        }
      });
    }

    if (config.dicebearBackgroundEnabled && config.dicebearBackgroundColor && config.dicebearBackgroundColor !== 'transparent') {
      params.append('backgroundColor', config.dicebearBackgroundColor.replace('#', ''));
    }

    params.append('radius', (config.dicebearRadius || 50).toString());

    const url = `${DICEBEAR_OPTIONS.baseUrl}/${style}/svg?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`DiceBear error: ${response.status}`);
    }

    const svg = await response.text();
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svg, 'image/svg+xml');

    if (svgDoc.querySelector('parsererror')) {
      throw new Error('Invalid SVG data received');
    }

    const svgElement = svgDoc.documentElement;
    svgElement.setAttribute('width', `${config.avatarWidth}px`);
    svgElement.setAttribute('height', `${config.avatarHeight}px`);
    svgElement.style.transformOrigin = 'center';
    svgElement.style.borderRadius = `${config.dicebearRadius || 50}%`;
    svgElement.style.transform = `scale(${scale})`;
    svgElement.style.position = config.dicebearPosition ? 'fixed' : 'relative';
    svgElement.setAttribute('role','img');
    svgElement.setAttribute('aria-label', (user?.Name || 'User') + ' avatar');

    if (config.dicebearBackgroundEnabled && config.dicebearBackgroundColor && config.dicebearBackgroundColor !== 'transparent') {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", "100%");
      rect.setAttribute("height", "100%");
      rect.setAttribute("fill", config.dicebearBackgroundColor);
      svgElement.insertBefore(rect, svgElement.firstChild);
    } else {
      svgElement.style.backgroundColor = 'transparent';
    }
    return svgElement;
  } catch (error) {
    console.error('DiceBear avatar oluşturma hatası, baş harflerle avatar oluşturuluyor:', error);
    return createInitialsAvatar(user);
  }
}

function createInitialsAvatar(user) {
  const initials = getInitials(user.Name);
  const initialsDiv = document.createElement("div");
  initialsDiv.textContent = initials;
  initialsDiv.dataset.userId = user.Id;
  initialsDiv.setAttribute('role','img');
  initialsDiv.setAttribute('aria-label', (user?.Name || 'User') + ' avatar');

  const config = getConfig();
  const scale = config.avatarScale || 1;
  const avatarColor = getAvatarColor(user.Id);

  const style = {
    width: `${config.avatarWidth}px`,
    height: `${config.avatarHeight}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'center',
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: `${config.avatarFontSize}px`,
    fontFamily: config.avatarFontFamily,
    pointerEvents: "none",
    textShadow: config.avatarTextShadow,
    fontFeatureSettings: '"kern" 1, "liga" 1',
    fontKerning: 'normal',
    textRendering: 'optimizeLegibility',
    opacity: '0',
    transition: 'opacity 0.3s ease'
  };

  if (config.avatarColorMethod === 'gradient') {
    style.background = avatarColor;
    style.color = '#FFFFFF';
    style.backgroundClip = 'text';
    style.webkitBackgroundClip = 'text';
    style.webkitTextFillColor = 'transparent';
  } else {
    style.color = avatarColor;
    style.backgroundColor = "transparent";
  }

  Object.assign(initialsDiv.style, style);
  return initialsDiv;
}

function applyAvatarStyles(element) {
  if (!element) return;

  element.style.opacity = '0';
  element.style.transition = 'opacity 0.3s ease';

  requestAnimationFrame(() => {
    element.style.opacity = '1';
    element.classList.add('loaded');
    const config = getConfig();
    if (config.dicebearPosition && config.avatarStyle !== 'initials') {
    const headerButton = document.querySelector('button.headerButton.headerButtonRight.headerUserButton.paper-icon-button-light');
    if (headerButton) {
    headerButton.style.padding = '15px 30px';
      }
    }
  });
}

function updateAvatarElement(avatarElement, user) {
  const config = getConfig();
  if (config.avatarStyle === 'dicebear' && avatarElement.tagName === 'svg') {
    return;
  }

  const newInitials = getInitials(user?.Name) || "?";
  const currentColor = avatarElement.style.color || getAvatarColor(user.Id);
  const newColor = getAvatarColor(user.Id);

  if (avatarElement.textContent === newInitials &&
      currentColor === newColor &&
      avatarElement.style.width === `${config.avatarWidth}px` &&
      avatarElement.style.height === `${config.avatarHeight}px` &&
      avatarElement.style.fontSize === `${config.avatarFontSize}px` &&
      avatarElement.style.fontFamily === config.avatarFontFamily &&
      avatarElement.style.textShadow === config.avatarTextShadow) {
    return;
  }

  avatarElement.textContent = newInitials;

  Object.assign(avatarElement.style, {
    width: `${config.avatarWidth}px`,
    height: `${config.avatarHeight}px`,
    fontSize: `${config.avatarFontSize}px`,
    fontFamily: config.avatarFontFamily,
    textShadow: config.avatarTextShadow,
    color: newColor,
    backgroundColor: config.avatarColorMethod === 'gradient' ? 'transparent' : '',
    background: config.avatarColorMethod === 'gradient' ? newColor : ''
  });

  if (config.avatarColorMethod === 'gradient') {
    avatarElement.style.backgroundClip = 'text';
    avatarElement.style.webkitBackgroundClip = 'text';
    avatarElement.style.webkitTextFillColor = 'transparent';
  } else {
    avatarElement.style.backgroundClip = '';
    avatarElement.style.webkitBackgroundClip = '';
    avatarElement.style.webkitTextFillColor = '';
  }

  applyAvatarStyles(avatarElement);
}


export function cleanAvatars(container = document) {
  if (!(container && container.querySelectorAll)) return;
  const elementsToRemove = container.querySelectorAll(`
    .material-icons.person,
    .user-avatar,
    .user-avatar-initials,
    .custom-user-avatar
  `);
  elementsToRemove.forEach(el => el.remove());
  currentAvatarElement = null;

  const headerButton = document.querySelector('button.headerButton.headerButtonRight.headerUserButton.paper-icon-button-light');
  if (headerButton) {
    headerButton.style.padding = '';
  }

  if (customAvatarAdded && container instanceof HTMLElement) {
    container.style.backgroundImage = 'none';
  }
}

function getAvatarColor(userId) {
  const config = getConfig();

  switch(config.avatarColorMethod) {
    case 'random':
      return getRandomColor(userId);
    case 'solid':
      return config.avatarSolidColor || '#FF4081';
    case 'gradient':
      return config.avatarGradient || 'linear-gradient(135deg, #FF9A9E 0%, #FAD0C4 100%)';
    case 'dynamic':
    default:
      return getDynamicColor(userId);
  }
}

function hasJellyfinAvatar(headerButton) {
  if (headerButton.style.backgroundImage &&
      headerButton.style.backgroundImage !== 'none' &&
      headerButton.style.backgroundImage.includes('/Users/') &&
      headerButton.style.backgroundImage.includes('/Images/Primary')) {
    return true;
  }

  if (headerButton.classList.contains('headerUserButtonRound')) {
    return true;
  }

  const materialIcon = headerButton.querySelector('.material-icons.person');
  if (materialIcon) {
    return false;
  }

  return false;
}

function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';

  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  } else {
    return (words[0].slice(0, 2)).toUpperCase();
  }
}

async function waitForElement(selector, attempts = 0) {
  const el = document.querySelector(selector);
  if (el) return el;
  if (attempts < 10) {
    await new Promise(resolve => setTimeout(resolve, 300));
    return waitForElement(selector, attempts + 1);
  }
  return null;
}

function setupAvatarProtection(headerButton, user) {

  if (avatarObserver) {
    avatarObserver.disconnect();
  }

  avatarObserver = new MutationObserver((mutations) => {
    const currentAvatar = headerButton.querySelector(".custom-user-avatar");
    const materialIcon = headerButton.querySelector(".material-icons.person");

    if ((!currentAvatar && !materialIcon) || materialIcon) {
      avatarObserver.disconnect();
      updateHeaderUserAvatar();
    }
  });

  avatarObserver.observe(headerButton, {
    childList: true,
    subtree: true
  });
}

function getDynamicColor(userId) {
  if (!userId) return '#FF4081';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  const saturation = 90;
  const lightness = 45;

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getRandomColor(userId) {
  const colors = [
    '#FF1744', '#F50057', '#D500F9', '#651FFF', '#3D5AFE',
    '#2979FF', '#00B0FF', '#00E5FF', '#1DE9B6', '#00E676',
    '#76FF03', '#C6FF00', '#FFEA00', '#FFC400', '#FF9100',
    '#FF3D00', '#8D6E63', '#5D4037', '#795548', '#9E9D24',
    '#607D8B', '#4DB6AC', '#BA68C8', '#F06292', '#A1887F',
    '#EF5350', '#AB47BC', '#7E57C2', '#5C6BC0', '#42A5F5',
    '#29B6F6', '#26C6DA', '#26A69A', '#9CCC65', '#D4E157',
    '#FFB300', '#F4511E', '#6D4C41', '#789262', '#AEEA00',
    '#00ACC1', '#00897B', '#43A047', '#9C27B0', '#AD1457',
    '#C2185B', '#7B1FA2', '#512DA8', '#303F9F', '#1976D2'
  ];

  if (!userId) return colors[0];

  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

export function initAvatarSystem() {
  const STYLE_ID = 'jms-avatar-inline-style';
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    .custom-user-avatar {
      opacity: 0;
      transition: opacity 0.3s ease;
      font-synthesis: none;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      border-radius: 50%;
      overflow: hidden;
    }
    .custom-user-avatar.loaded {
      opacity: 1;
    }
  `;

  const config = getConfig();

  if (config.autoRefreshAvatar) {
    const refreshTimeMs = (config.avatarRefreshTime ?? 1) * 60000;
    startAvatarRotation(refreshTimeMs);
  }

  let retryCount = 0;
  const maxRetries = config?.avatarMaxRetries ?? 40;
  const retryDelay = config?.avatarRetryDelayMs ?? 500;

  const applyButton = document.getElementById('applyDicebearAvatar');
  if (applyButton) {
    applyButton.addEventListener('click', async () => {
      clearAvatarCache();
      await updateHeaderUserAvatar();
    });
  }

  const tryOnce = async () => {
    const result = await updateHeaderUserAvatar();
    const headerBtn = document.querySelector('button.headerUserButton');
    const ok =
      result?.status === 'custom' ||
      result?.status === 'native' ||
      result?.status === 'disabled' ||
      !!(headerBtn && (headerBtn.querySelector('.custom-user-avatar') || hasJellyfinAvatar(headerBtn)));
    const shouldRetry = result?.status === 'pending' || result?.status === 'busy';

    if (!ok && shouldRetry && retryCount++ < maxRetries) {
      setTimeout(tryOnce, retryDelay);
    }
  };
  tryOnce();

  return () => {
    stopAvatarRotation();
    if (avatarObserver) {
      avatarObserver.disconnect();
    }
  };
}

export function updateAvatarStyles() {
  const config = getConfig();
  const avatars = document.querySelectorAll('.custom-user-avatar');

  avatars.forEach(avatar => {
    const scale = parseFloat(config.avatarScale) || 1;
    const currentScale = parseFloat(avatar.style.transform?.replace('scale(', '')?.replace(')', '')) || 1;
    if (Math.abs(currentScale - scale) < 0.05) return;

    if (config.avatarStyle === 'dicebear' && avatar.tagName === 'svg') {
      Object.assign(avatar.style, {
        transform: `scale(${scale})`,
        transformOrigin: 'center'
      });
    } else {
      avatar.style.transform = `scale(${scale})`;
      avatar.style.transformOrigin = 'center';
    }
  });
}

export function clearAvatarCache() {
  userCache.data = null;
  userCache.timestamp = 0;
  Object.keys(sessionStorage).forEach(key => {
    if (key.startsWith('avatar-')) {
      sessionStorage.removeItem(key);
    }
  });
}

function startAvatarRotation(interval = 60000) {
  if (avatarRotationInterval) {
    clearInterval(avatarRotationInterval);
  }

  avatarRotationInterval = setInterval(async () => {
    try {
      clearAvatarCache();
      await updateHeaderUserAvatar();
    } catch (error) {
      console.error('Otomatik avatar rotasyonu hatası:', error);
    }
  }, interval);
}

function stopAvatarRotation() {
  if (avatarRotationInterval) {
    clearInterval(avatarRotationInterval);
    avatarRotationInterval = null;
  }
}
