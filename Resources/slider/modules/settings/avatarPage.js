import { getConfig } from "../config.js";
import { createCheckbox, createSection, createNumberInput, createTextInput, createSelect } from "./shared.js";
import { applySettings } from "./applySettings.js";
import { clearAvatarCache, cleanAvatars, updateHeaderUserAvatar } from "../userAvatar.js";
import { debounce } from "../utils.js";
import { createDicebearParamsSection } from "../dicebearSpecificParams.js";

export function createAvatarPanel(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'avatar-panel';
  panel.className = 'settings-panel';

  const initialIsRandom = config.randomDicebearAvatar !== false;
  const initialIsDicebear = config.avatarStyle === 'dicebear';

  const section = createSection(labels.avatarCreateInput || 'Avatar Ayarları');
  const avatarCheckbox = createCheckbox('createAvatar', labels.createAvatar || 'Avatar Oluşturmayı Etkinleştir', config.createAvatar);
  section.appendChild(avatarCheckbox);
  const avatarStyleSelect = createSelect(
    'avatarStyle',
    labels.avatarStyle || 'Avatar Stili',
    [
      { value: 'initials', text: labels.avatarStyleInitials || 'Baş Harfler' },
      { value: 'dicebear', text: labels.avatarStyleDicebear || 'Dicebear Avatar' }
    ],
    config.avatarStyle || 'dicebear'
  );
  section.appendChild(avatarStyleSelect);
  const dicebearElements = [];
  const dicebearParamsElements = [];
  const commonElements = [];
  const initialsElements = [];
  const randomAvatarCheckbox = createCheckbox(
    'randomDicebearAvatar',
    labels.randomDicebearAvatar || 'Rastgele Avatar Oluştur',
    config.randomDicebearAvatar !== false
  );
  dicebearElements.push(randomAvatarCheckbox);
  section.appendChild(randomAvatarCheckbox);
  const dicebearStyleSelect = createSelect(
    'dicebearStyle',
    labels.dicebearStyle || 'Dicebear Stili',
    [
      { value: 'adventurer', text: labels.adventurer || 'Adventurer' },
      { value: 'adventurer-neutral', text: labels.adventurerNeutral || 'Adventurer Neutral' },
      { value: 'avataaars', text: labels.avataaars || 'Avataaars' },
      { value: 'avataaars-neutral', text: labels.avataaarsNeutral || 'Avataaars Neutral' },
      { value: 'big-ears', text: labels.bigEars || 'Big Ears' },
      { value: 'big-ears-neutral', text: labels.bigEarsNeutral || 'Big Ears Neutral' },
      { value: 'big-smile', text: labels.bigSmile || 'Big Smile' },
      { value: 'bottts', text: labels.bottts || 'Bottts' },
      { value: 'bottts-neutral', text: labels.botttsNeutral || 'Bottts Neutral' },
      { value: 'croodles', text: labels.croodles || 'Croodles' },
      { value: 'croodles-neutral', text: labels.croodlesNeutral || 'Croodles Neutral' },
      { value: 'dylan', text: labels.dylan || 'Dylan' },
      { value: 'fun-emoji', text: labels.funEmoji || 'Fun Emoji' },
      { value: 'glass', text: labels.glass || 'Glass' },
      { value: 'icons', text: labels.icons || 'Icons' },
      { value: 'identicon', text: labels.identicon || 'Identicon' },
      { value: 'initials', text: labels.initials || 'Initials' },
      { value: 'lorelei', text: labels.lorelei || 'Lorelei' },
      { value: 'lorelei-neutral', text: labels.loreleiNeutral || 'Lorelei Neutral' },
      { value: 'micah', text: labels.micah || 'Micah' },
      { value: 'miniavs', text: labels.miniAvatars || 'Mini Avatars' },
      { value: 'notionists', text: labels.notionists || 'Notionists' },
      { value: 'notionists-neutral', text: labels.notionistsNeutral || 'Notionists Neutral' },
      { value: 'open-peeps', text: labels.openPeeps || 'Open Peeps' },
      { value: 'personas', text: labels.personas || 'Personas' },
      { value: 'pixel-art', text: labels.pixelArt || 'Pixel Art' },
      { value: 'pixel-art-neutral', text: labels.pixelArtNeutral || 'Pixel Art Neutral' },
      { value: 'rings', text: labels.rings || 'Rings' },
      { value: 'shapes', text: labels.shapes || 'Shapes' },
      { value: 'thumbs', text: labels.thumbs || 'Thumbs' }
    ],
    config.dicebearStyle || 'initials'
  );
  dicebearElements.push(dicebearStyleSelect);
  section.appendChild(dicebearStyleSelect);

  const dicebearParamsSection = document.createElement('div');
  dicebearParamsSection.id = 'dicebearParamsSection';
  dicebearParamsSection.className = 'dicebear-params-section';

  const initialStyle = config.dicebearStyle || 'initials';
  const paramsContent = createDicebearParamsSection(initialStyle);
  dicebearParamsSection.appendChild(paramsContent);
  attachDicebearParamsListeners(dicebearParamsSection);

  dicebearParamsSection.style.display = (initialIsDicebear && !initialIsRandom) ? 'flex' : 'none';

  section.appendChild(dicebearParamsSection);
  dicebearParamsElements.push(dicebearParamsSection);

  const widthInput = createNumberInput('avatarWidth', labels.avatarWidth || 'Avatar Genişliği (px)', config.avatarWidth, 10, 50);
  commonElements.push(widthInput);
  section.appendChild(widthInput);

  const heightInput = createNumberInput('avatarHeight', labels.avatarHeight || 'Avatar Yüksekliği (px)', config.avatarHeight, 10, 50);
  commonElements.push(heightInput);
  section.appendChild(heightInput);

  const dicebearRadius = createNumberInput(
    'dicebearRadius',
    labels.dicebearRadius || 'Dicebear Yuvarlaklık (0-50)',
    config.dicebearRadius || 50,
    0,
    50
  );
  dicebearElements.push(dicebearRadius);
  section.appendChild(dicebearRadius);

  const scaleSection = document.createElement('div');
  scaleSection.className = 'avatar-item';

  const scaleLabel = document.createElement('label');
  scaleLabel.textContent = labels.avatarScale || 'Avatar Büyütme Oranı';
  scaleLabel.htmlFor = 'avatarScale';

  const scaleInput = document.createElement('input');
  scaleInput.type = 'range';
  scaleInput.min = '0.5';
  scaleInput.max = '5';
  scaleInput.step = '0.1';
  scaleInput.value = config.avatarScale || '4';
  scaleInput.name = 'avatarScale';
  scaleInput.id = 'avatarScale';
  scaleInput.className = 'range-input';

  const scaleValue = document.createElement('span');
  scaleValue.className = 'range-value';
  scaleValue.textContent = `${scaleInput.value}x`;

  scaleInput.addEventListener('input', () => {
    scaleValue.textContent = `${scaleInput.value}x`;
  });

  const debouncedScaleUpdate = debounce(() => {
    clearAvatarCache();
    applySettings(false);
  }, 300);

  scaleInput.addEventListener('change', debouncedScaleUpdate);

  scaleSection.append(scaleLabel, scaleInput, scaleValue);
  commonElements.push(scaleSection);
  section.appendChild(scaleSection);

  const colorMethodSelect = createSelect(
    'avatarColorMethod',
    labels.avatarColorMethod || 'Renk Belirleme Yöntemi',
    [
      { value: 'dynamic', text: labels.avatarColorDynamic || 'Dinamik (Kullanıcı ID\'sine göre)' },
      { value: 'random', text: labels.avatarColorRandom || 'Rastgele (Sabit renk paleti)' },
      { value: 'solid', text: labels.avatarColorSolid || 'Sabit Renk' },
      { value: 'gradient', text: labels.avatarColorGradient || 'Gradyan Renk' }
    ],
    config.avatarColorMethod
  );
  initialsElements.push(colorMethodSelect);
  section.appendChild(colorMethodSelect);

  const solidColorInput = createColorInput('avatarSolidColor', labels.avatarSolidColor || 'Sabit Renk Seçin', config.avatarSolidColor || '#FF4081');
  solidColorInput.style.display = config.avatarColorMethod === 'solid' ? 'flex' : 'none';
  initialsElements.push(solidColorInput);
  section.appendChild(solidColorInput);

  const gradientSelect = createSelect(
    'avatarGradient',
    labels.avatarGradient || 'Gradyan Seçimi',
    [
      { value: 'linear-gradient(135deg, #FF5F6D 0%, #FFC371 100%)', text: labels.gradient1 || 'Kızıl Güneş' },
      { value: 'linear-gradient(135deg, #36D1DC 0%, #5B86E5 100%)', text: labels.gradient2 || 'Deniz Mavisi' },
      { value: 'linear-gradient(135deg, #43E97B 0%, #38F9D7 100%)', text: labels.gradient3 || 'Tropikal Yeşil' },
      { value: 'linear-gradient(135deg, #FF9A9E 0%, #FAD0C4 100%)', text: labels.gradient4 || 'Tatlı Pembe' },
      { value: 'linear-gradient(135deg, #FDBB2D 0%, #3A1C71 100%)', text: labels.gradient5 || 'Altın-Mor Gece' },
      { value: 'linear-gradient(135deg, #FC6076 0%, #FF9A44 100%)', text: labels.gradient6 || 'Turuncu Şafak' },
      { value: 'linear-gradient(135deg, #00C9FF 0%, #92FE9D 100%)', text: labels.gradient7 || 'Aqua-Lime' },
      { value: 'linear-gradient(135deg, #C33764 0%, #1D2671 100%)', text: labels.gradient8 || 'Gece Yarısı Moru' },
      { value: 'linear-gradient(135deg, #FBD3E9 0%, #BB377D 100%)', text: labels.gradient9 || 'Pembe Lila' },
      { value: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)', text: labels.gradient10 || 'Kraliyet Mavisi' },
      { value: 'linear-gradient(135deg, #30E8BF 0%, #FF8235 100%)', text: labels.gradient11 || 'Yeşil-Turuncu Enerji' },
      { value: 'linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)', text: labels.gradient12 || 'Altın Turuncu' },
      { value: 'linear-gradient(135deg, #D38312 0%, #A83279 100%)', text: labels.gradient13 || 'Çöl Işıltısı' },
      { value: 'linear-gradient(135deg, #3CA55C 0%, #B5AC49 100%)', text: labels.gradient14 || 'Orman Yolu' },
      { value: 'linear-gradient(135deg, #FFDEE9 0%, #B5FFFC 100%)', text: labels.gradient15 || 'Pembe-Buz Mavisi' }
    ],
    config.avatarGradient
  );
  gradientSelect.style.display = config.avatarColorMethod === 'gradient' ? 'flex' : 'none';
  initialsElements.push(gradientSelect);
  section.appendChild(gradientSelect);

  const fontFamilySelect = createSelect(
    'avatarFontFamily',
    labels.avatarFontFamily || 'Yazı Tipi',
    getSystemFonts(labels),
    config.avatarFontFamily
  );
  initialsElements.push(fontFamilySelect);
  section.appendChild(fontFamilySelect);


  const fontSizeInput = createNumberInput('avatarFontSize', labels.avatarFontSize || 'Yazı Boyutu (px)', config.avatarFontSize, 8, 20);
  initialsElements.push(fontSizeInput);
  section.appendChild(fontSizeInput);

  const textShadowInput = createTextInput('avatarTextShadow', labels.avatarTextShadow || 'Yazı Gölgesi', config.avatarTextShadow);
  initialsElements.push(textShadowInput);
  section.appendChild(textShadowInput);


  const dicebearPositionCheckbox = createCheckbox('dicebearPosition', labels.dicebearPosition || 'Avatar Dışa Çıkar', config.dicebearPosition);
  dicebearElements.push(dicebearPositionCheckbox);
  section.appendChild(dicebearPositionCheckbox);

  const dicebearBgCheckbox = createCheckbox(
    'dicebearBackgroundEnabled',
    labels.dicebearBackgroundEnabled || 'Dicebear Arkaplanı Etkinleştir',
    config.dicebearBackgroundEnabled !== false
  );
  dicebearElements.push(dicebearBgCheckbox);
  section.appendChild(dicebearBgCheckbox);

  const dicebearBgColor = createColorInput(
    'dicebearBackgroundColor',
    labels.dicebearBackgroundColor || 'Dicebear Arkaplan Rengi',
    config.dicebearBackgroundColor || '#FF4081'
  );
  dicebearElements.push(dicebearBgColor);
  section.appendChild(dicebearBgColor);

  dicebearBgCheckbox.querySelector('input').addEventListener('change', (e) => {
    dicebearBgColor.style.display = e.target.checked ? 'flex' : 'none';
    clearAvatarCache();
    applySettings(false);
  });

  const autoRefreshSection = document.createElement('div');
  autoRefreshSection.className = 'avatar-item';

  const autoRefreshCheckbox = createCheckbox(
    'autoRefreshAvatar',
    labels.autoRefreshAvatar || 'Avatarı Otomatik Değiştir',
    config.autoRefreshAvatar || false
  );
  dicebearElements.push(autoRefreshCheckbox);
  autoRefreshSection.appendChild(autoRefreshCheckbox);

  const refreshTimeInput = createNumberInput(
    'avatarRefreshTime',
    labels.avatarRefreshTime || 'Değişim Süresi (dakika)',
    config.avatarRefreshTime || 10,
    1,
    1440
  );
  dicebearElements.push(refreshTimeInput);
  autoRefreshSection.appendChild(refreshTimeInput);

  const initDisplayStyle = () => {
  const isDicebear = config.avatarStyle === 'dicebear';
  const isRandom = config.randomDicebearAvatar !== false;
  const isAutoRefresh = config.autoRefreshAvatar === true;
  const colorMethod = config.avatarColorMethod;

  autoRefreshSection.style.display = (isDicebear && isRandom) ? 'flex' : 'none';
  refreshTimeInput.style.display = (isDicebear && isRandom && isAutoRefresh) ? 'flex' : 'none';

  colorMethodSelect.style.display = isDicebear ? 'none' : 'flex';

  if (!isDicebear) {
    solidColorInput.style.display = colorMethod === 'solid' ? 'flex' : 'none';
    gradientSelect.style.display = colorMethod === 'gradient' ? 'flex' : 'none';
  } else {
    solidColorInput.style.display = 'none';
    gradientSelect.style.display = 'none';
  }
};
  initDisplayStyle();

  autoRefreshCheckbox.querySelector('input').addEventListener('change', (e) => {
  const isAuto = e.target.checked;
  const isDicebear = document.querySelector('#avatarStyle').value === 'dicebear';
  const isRandom = randomAvatarCheckbox.querySelector('input').checked;

  refreshTimeInput.style.display = (isDicebear && isRandom && isAuto) ? 'flex' : 'none';
  autoRefreshSection.style.display = (isDicebear && isRandom) ? 'flex' : 'none';

  applySettings(false);
});

  section.appendChild(autoRefreshSection);

  const applyDicebearBtn = document.createElement('button');
  applyDicebearBtn.type = 'button';
  applyDicebearBtn.id = 'applyDicebearAvatar';
  applyDicebearBtn.textContent = labels.uygula || 'DiceBear Avatar Uygula';
  applyDicebearBtn.className = 'btn';
  applyDicebearBtn.style.display = config.avatarStyle === 'dicebear' ? 'flex' : 'none';
  applyDicebearBtn.addEventListener('click', applyDicebearAvatar);
  section.appendChild(applyDicebearBtn);

  const description = document.createElement('div');
  description.className = 'description-text';
  description.textContent = labels.avatarOverlayDescription ||
    'Bu özellik etkinleştirildiğinde, profil resmi olmayan kullanıcıların kullanıcı isimlerinden avatar oluşturur.';
  section.appendChild(description);

  randomAvatarCheckbox.querySelector('input').addEventListener('change', (e) => {
  const isRandom = e.target.checked;
  const isDicebear = document.querySelector('#avatarStyle').value === 'dicebear';
  const isAutoRefresh = autoRefreshCheckbox.querySelector('input').checked;

  dicebearStyleSelect.style.display = isDicebear ? 'flex' : 'none';
  dicebearParamsSection.style.display = (isDicebear && !isRandom) ? 'flex' : 'none';

  autoRefreshSection.style.display = (isDicebear && isRandom) ? 'flex' : 'none';
  refreshTimeInput.style.display = (isDicebear && isRandom && isAutoRefresh) ? 'flex' : 'none';

  if (!isRandom && isDicebear) {
    updateDicebearParamsSection();
  }

  clearAvatarCache();
  applySettings(false);

  const params = collectDicebearParams();
  localStorage.setItem('dicebearParams', JSON.stringify(params));
});


avatarStyleSelect.querySelector('select').addEventListener('change', (e) => {
  const isDicebear = e.target.value === 'dicebear';
  const isRandom = randomAvatarCheckbox.querySelector('input').checked;

  initialsElements.forEach(el => el.style.display = isDicebear ? 'none' : 'flex');
  dicebearElements.forEach(el => el.style.display = isDicebear ? 'flex' : 'none');
  commonElements.forEach(el => el.style.display = 'flex');
  colorMethodSelect.style.display = isDicebear ? 'none' : 'flex';

  if (!isDicebear) {
    const colorMethod = colorMethodSelect.querySelector('select').value;
    solidColorInput.style.display = colorMethod === 'solid' ? 'flex' : 'none';
    gradientSelect.style.display = colorMethod === 'gradient' ? 'flex' : 'none';
  } else {
    solidColorInput.style.display = 'none';
    gradientSelect.style.display = 'none';
  }

  dicebearParamsSection.style.display = (isDicebear && !isRandom) ? 'flex' : 'none';
  applyDicebearBtn.style.display = isDicebear ? 'flex' : 'none';

  const isAutoRefresh = autoRefreshCheckbox.querySelector('input').checked;
  refreshTimeInput.style.display = (isDicebear && isAutoRefresh && isRandom) ? 'flex' : 'none';
  autoRefreshSection.style.display = (isDicebear && isRandom) ? 'flex' : 'none';

  if (isDicebear && !isRandom) {
    updateDicebearParamsSection();
  }

  clearAvatarCache();
  applySettings(false);

  if (isDicebear) {
    const params = collectDicebearParams();
    saveDicebearParams(params);
  }
});

  dicebearStyleSelect.querySelector('select').addEventListener('change', (e) => {
  const isRandom = randomAvatarCheckbox.querySelector('input').checked;
  if (!isRandom) {
    updateDicebearParamsSection();
  }

  const params = collectDicebearParams();
  localStorage.setItem('dicebearParams', JSON.stringify(params));

  clearAvatarCache();
  applySettings(false);
});

  colorMethodSelect.querySelector('select').addEventListener('change', (e) => {
  const value = e.target.value;
  const isDicebear = document.querySelector('#avatarStyle').value === 'dicebear';

  if (!isDicebear) {
    solidColorInput.style.display = value === 'solid' ? 'flex' : 'none';
    gradientSelect.style.display = value === 'gradient' ? 'flex' : 'none';
  } else {
    solidColorInput.style.display = 'none';
    gradientSelect.style.display = 'none';
  }

  clearAvatarCache();
  applySettings(false);
});

randomAvatarCheckbox.querySelector('input').checked = initialIsRandom;
dicebearParamsSection.style.display = (initialIsDicebear && !initialIsRandom) ? 'flex' : 'none';
dicebearStyleSelect.style.display = initialIsDicebear ? 'flex' : 'none';

initialsElements.forEach(el => el.style.display = initialIsDicebear ? 'none' : 'flex');
dicebearElements.forEach(el => el.style.display = initialIsDicebear ? 'flex' : 'none');
commonElements.forEach(el => el.style.display = 'flex');

  const bgCheckboxInitialChecked = dicebearBgCheckbox.querySelector('input').checked;
  dicebearBgColor.style.display = bgCheckboxInitialChecked ? 'flex' : 'none';

  function updateDicebearParamsSection() {
    const styleSelect = document.querySelector('#dicebearStyle');
    if (!styleSelect) {
      console.error('Dicebear stil seçim öğesi bulunamadı');
      return;
    }

    const style = styleSelect.value;
    const newParamsSection = createDicebearParamsSection(style);

    const oldParamsSection = document.getElementById('dicebearParamsSection');
    if (oldParamsSection) {
      oldParamsSection.innerHTML = '';
      oldParamsSection.appendChild(newParamsSection);
      attachDicebearParamsListeners(oldParamsSection);
    }
  }

  panel.appendChild(section);
  return panel;
}

export function createColorInput(name, label, value) {
  const container = document.createElement('div');
  container.className = 'input-container';

  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  labelElement.htmlFor = name + '-color';

  const colorContainer = document.createElement('div');
  colorContainer.style.display = 'flex';
  colorContainer.style.alignItems = 'center';
  colorContainer.style.gap = '8px';

  const input = document.createElement('input');
  input.type = 'color';
  input.id = name + '-color';
  input.name = name;
  input.value = value || '#FF4081';

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = value || '#FF4081';
  textInput.className = 'color-text-input';
  textInput.style.flex = '1';
  textInput.id = name + '-text';
  textInput.name = name + '-text';
  textInput.setAttribute('aria-label', label + ' (hex kodu)');

  const debouncedApply = debounce(() => {
    applySettings(false);
  }, 300);

  input.addEventListener('change', () => {
    textInput.value = input.value;
    debouncedApply();
  });

  textInput.addEventListener('change', () => {
    if (/^#[0-9A-F]{6}$/i.test(textInput.value)) {
      input.value = textInput.value;
      debouncedApply();
    }
  });

  colorContainer.appendChild(input);
  colorContainer.appendChild(textInput);

  container.appendChild(labelElement);
  container.appendChild(colorContainer);

  return container;
}

function getSystemFonts(labels) {
  const systemFonts = [
    { value: 'inherit', text: labels.fontInherit || 'Varsayılan' },
    { value: 'Arial, sans-serif', text: 'Arial' },
    { value: 'Helvetica, sans-serif', text: 'Helvetica' },
    { value: '"Times New Roman", serif', text: 'Times New Roman' },
    { value: 'Georgia, serif', text: 'Georgia' },
    { value: 'Verdana, sans-serif', text: 'Verdana' },
    { value: '"Trebuchet MS", sans-serif', text: 'Trebuchet MS' },
    { value: '"Palatino Linotype", serif', text: 'Palatino Linotype' },
    { value: '"Lucida Sans Unicode", sans-serif', text: 'Lucida Sans Unicode' },
    { value: '"Segoe UI", sans-serif', text: 'Segoe UI' },
    { value: 'Courier New, monospace', text: 'Courier New' },
    { value: 'Impact, sans-serif', text: 'Impact' },
    { value: '"Comic Sans MS", cursive, sans-serif', text: 'Comic Sans MS' },
    { value: 'Roboto, sans-serif', text: 'Roboto' },
    { value: '"Open Sans", sans-serif', text: 'Open Sans' },
    { value: '"Poppins", sans-serif', text: 'Poppins' },
    { value: '"Montserrat", sans-serif', text: 'Montserrat' },
    { value: '"Lato", sans-serif', text: 'Lato' },
    { value: '"Raleway", sans-serif', text: 'Raleway' },
    { value: '"Nunito", sans-serif', text: 'Nunito' },
    { value: '"Quicksand", sans-serif', text: 'Quicksand' },
    { value: '"Rubik", sans-serif', text: 'Rubik' },
    { value: '"Ubuntu", sans-serif', text: 'Ubuntu' },
    { value: '"Merriweather", serif', text: 'Merriweather' },
    { value: '"Playfair Display", serif', text: 'Playfair Display' },
    { value: 'Righteous, cursive', text: 'Righteous' },
    { value: '"Pacifico", cursive', text: 'Pacifico' },
    { value: '"Caveat", cursive', text: 'Caveat (El Yazısı)' },
    { value: '"Shadows Into Light", cursive', text: 'Shadows Into Light' },
    { value: '"Indie Flower", cursive', text: 'Indie Flower' },
    { value: 'system-ui, sans-serif', text: labels.systemdefault || 'Sistem Varsayılanı' },
    { value: '-apple-system, BlinkMacSystemFont', text: labels.appledefault || 'Apple Sistem Varsayılanı' },
    { value: '"Segoe UI", Roboto, Oxygen', text: 'Windows/Linux' }
  ];

  if (navigator.userAgent.includes('Windows')) {
    systemFonts.push(
      { value: '"Microsoft YaHei", sans-serif', text: 'Microsoft YaHei (Çince)' },
      { value: '"Microsoft JhengHei", sans-serif', text: 'Microsoft JhengHei (Çince-TW)' }
    );
  }

  if (navigator.userAgent.includes('Mac')) {
    systemFonts.push(
      { value: '"San Francisco", -apple-system', text: 'San Francisco' },
      { value: '"SF Pro Display", -apple-system', text: 'SF Pro Display' }
    );
  }

  return systemFonts;
}

export async function applyDicebearAvatar() {
  try {
    const params = collectDicebearParams();
    if (!saveDicebearParams(params)) {
      throw new Error('Parametreler kaydedilemedi');
    }

    const headerButton = document.querySelector('button.headerUserButton');
    if (!headerButton) return false;

    clearAvatarCache();
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('avatar-') && key.includes('dicebear')) {
        sessionStorage.removeItem(key);
      }
    });

    cleanAvatars(headerButton);
    await updateHeaderUserAvatar();
    return true;
  } catch (error) {
    console.error('Avatar uygulanırken hata:', error);
    throw error;
  }
}


function saveDicebearParams(params) {
  try {
    const paramsToSave = params || collectDicebearParams();

    if (!paramsToSave || typeof paramsToSave !== 'object') {
      console.error('Geçersiz parametreler:', paramsToSave);
      return false;
    }

    const jsonString = JSON.stringify(paramsToSave);
    if (!jsonString || jsonString === '{}') {
      console.warn('Boş parametreler kaydedilmeye çalışılıyor');
      return false;
    }

    localStorage.setItem('dicebearParams', jsonString);
    const saved = localStorage.getItem('dicebearParams');
    if (saved !== jsonString) {
      console.error('Kayıt başarısız oldu!');
      return false;
    }

    return true;
  } catch (e) {
    console.error('Dicebear parametreleri kaydedilirken hata oluştu:', e);
    localStorage.removeItem('dicebearParams');
    return false;
  }
}


function getDicebearParams() {
  try {
    const params = localStorage.getItem('dicebearParams');
    return params ? JSON.parse(params) : {};
  } catch (e) {
    console.error('Dicebear ayarları yüklenirken hata oluştu:', e);
    return {};
  }
}

function collectDicebearParams() {
  const container = document.querySelector('#dicebearParamsSection');
  if (!container) return {};

  const inputs = container.querySelectorAll('input, select');
  const params = {};

  inputs.forEach(input => {
    let name = input.name || input.id;
    if (!name) return;
    if (name.startsWith('dicebearParams.')) {
      name = name.replace('dicebearParams.', '');
    }

    if (input.type === 'checkbox') {
      params[name] = input.checked;
    } else if (input.type === 'number') {
      params[name] = Number(input.value);
    } else if (input.type === 'range') {
      params[name] = parseFloat(input.value);
    } else {
      params[name] = input.value;
    }
  });

  return params;
}

function attachDicebearParamsListeners(container) {
  const inputs = container.querySelectorAll('input, select');
  inputs.forEach(input => {
    input.addEventListener('change', () => {
      const params = collectDicebearParams();

      if (params && typeof params === 'object' && !Array.isArray(params)) {
        if (!saveDicebearParams(params)) {
          console.error('Parametreler kaydedilemedi!');
        }
      } else {
        console.error('Geçersiz parametre formatı:', params);
      }

      clearAvatarCache();
      applySettings(false);
    });
  });
}
function updateColorVisibility() {
  const methodSelect = document.querySelector('#avatarColorMethod');
  const value = methodSelect?.value;

  const solidColor = document.querySelector('#solidColorInput');
  const gradientColor = document.querySelector('#gradientSelect');

  if (!solidColor || !gradientColor) return;

  solidColor.style.display = value === 'solid' ? 'flex' : 'none';
  gradientColor.style.display = value === 'gradient' ? 'flex' : 'none';
}
