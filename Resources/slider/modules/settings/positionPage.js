import { getConfig } from "../config.js";
import { updateSlidePosition } from '../positionUtils.js';
import { applySettings } from "./applySettings.js";

const config = getConfig();

export function createPositionEditor(config, labels, section) {
  function createSettingItem(labelText, configKey, cssProperty, placeholder, target = 'slides', containerType = '') {
    const container = document.createElement('div');
    container.className = 'position-item';

    const inputId = `input-${configKey}`;

    const label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = inputId;

    const input = document.createElement('input');
    input.type = 'number';
    input.name = configKey;
    input.id = inputId;
    input.value = config[configKey] || '';
    input.placeholder = placeholder || config.languageLabels.placeholderText || 'Değer giriniz';

    const allowsNegative = ['top', 'left'].includes(cssProperty);
    const isProgressHeight = configKey === 'progressBarHeight';

    if (!allowsNegative) {
      input.min = 0;
    }
    if (isProgressHeight) {
      input.min = 0.1;
      input.max = 10;
      input.step = 0.1;
    }

    const resetBtn = document.createElement('button');
    resetBtn.textContent = config.languageLabels.resetButton || 'Sıfırla';
    resetBtn.type = 'button';
    resetBtn.className = 'reset-button';
    resetBtn.addEventListener('click', () => {
      input.value = '';
      config[configKey] = '';
      updateContainerStyle(target, containerType, cssProperty, '');
    });

    input.addEventListener('click', function(e) {
      e.stopPropagation();
      openPositionModal(this, configKey, cssProperty, placeholder, target, containerType);
    });

    input.addEventListener('input', function() {
      let value = parseFloat(this.value);
      if (!allowsNegative && value < 0) {
        value = 0;
      }
      if (isProgressHeight) {
        if (value < 0.1) value = 0.1;
        if (value > 10) value = 10;
      }
      const newValue = isNaN(value) ? '' : value;
      this.value = newValue;
      config[configKey] = newValue;
      updateContainerStyle(target, containerType, cssProperty, newValue);
    });

    container.append(label, input, resetBtn);
    return container;
}

  function createGlobalResetButton() {
    const container = document.createElement('div');
    container.className = 'global-reset-container';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = config.languageLabels.resetAllButton || 'Tümünü Sıfırla';
    resetBtn.type = 'button';
    resetBtn.className = 'global-reset-button';
    resetBtn.addEventListener('click', resetAllSettings);

    container.appendChild(resetBtn);
    return container;
  }

  function resetAllSettings() {
    document.querySelectorAll('.position-item input').forEach(input => {
      input.value = '';
      const configKey = input.name;
      const cssProperty = input.dataset.cssProperty || '';
      const target = input.dataset.target || 'slides';
      const containerType = input.dataset.containerType || '';

      config[configKey] = '';
      updateContainerStyle(target, containerType, cssProperty, '');
    });

    document.querySelectorAll('.flex-item select').forEach(select => {
      select.value = '';
      const configKey = select.name;
      const containerType = select.dataset.containerType || '';

      config[configKey] = '';
      updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), '');
    });

    if (config.homeSectionsTop !== undefined) {
      config.homeSectionsTop = '';
      updateContainerStyle('homeSections', '', 'top', '');
    }

    if (config.sliderContainerTop !== undefined) {
      config.sliderContainerTop = '';
      updateContainerStyle('slider', 'slider', 'top', '');
    }

    if (config.progressBarTop !== undefined) {
      config.progressBarTop = '';
      updateContainerStyle('progress', 'progress', 'top', '');
    }
  }

  function openPositionModal(inputElement, configKey, cssProperty, placeholder, target, containerType) {
  const mainModal = document.getElementById('settings-modal');
  if (mainModal) mainModal.style.display = 'none';

  const modal = document.createElement('div');
  modal.className = 'position-modal';
  modal.style.display = 'block';

  const modalContent = document.createElement('div');
  modalContent.className = 'position-modal-content';

  const closeBtn = document.createElement('span');
  closeBtn.className = 'position-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => {
    modal.remove();
    if (mainModal) mainModal.style.display = 'block';
  };

  const title = document.createElement('h3');
  let sectionLabel;
  if (containerType === 'homeSections') {
    sectionLabel = config.languageLabels.homeSectionsPosition;
  } else if (containerType) {
    sectionLabel = config.languageLabels[`${containerType}Container`];
  } else {
    sectionLabel = config.languageLabels.slidesPosition;
  }

  const fieldLabel = inputElement.previousElementSibling?.textContent
    || config.languageLabels[configKey]
    || configKey.replace(/([A-Z])/g, ' $1').trim();

  title.textContent = sectionLabel
    ? `${sectionLabel} — ${fieldLabel}`
    : fieldLabel;
  title.className = 'position-modal-title';

  const inputContainer = document.createElement('div');
  inputContainer.className = 'position-modal-input-container';

  const modalInput = document.createElement('input');
  modalInput.type = 'number';
  modalInput.value = inputElement.value;
  modalInput.placeholder = placeholder || config.languageLabels.placeholderText || 'Değer giriniz';
  modalInput.className = 'position-modal-input';

  const isProgressHeight = configKey === 'progressBarHeight';
  if (isProgressHeight) {
    modalInput.min = 0.1;
    modalInput.max = 10;
    modalInput.step = 0.1;
  } else if (cssProperty === 'width' || cssProperty === 'height') {
    modalInput.min = 0;
  }

  inputContainer.append(modalInput);

  if (configKey === 'homeSectionsTop') {
    const applyBtn = document.createElement('button');
    applyBtn.className = 'position-modal-apply';
    applyBtn.textContent = config.languageLabels.applyButton || 'Uygula';
    applyBtn.onclick = () => {
      if (typeof applySettings === 'function') {
        applySettings(false);
      }
    };
    inputContainer.append(applyBtn);
  }

  modalInput.addEventListener('input', () => {
    let value = parseFloat(modalInput.value);
    if (isProgressHeight) {
      if (isNaN(value)) {
        value = '';
      } else {
        if (value < 0.1) value = 0.1;
        if (value > 10) value = 10;
        modalInput.value = value.toFixed(1);
      }
    } else if ((cssProperty === 'width' || cssProperty === 'height') && value < 0) {
      value = 0;
      modalInput.value = value;
    }

    inputElement.value = isNaN(value) ? '' : value;
    config[configKey] = isNaN(value) ? '' : value;
    updateContainerStyle(target, containerType, cssProperty, isNaN(value) ? '' : value);
  });

  modalContent.append(closeBtn, title, inputContainer);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      if (mainModal) mainModal.style.display = 'block';
    }
  });

  setTimeout(() => {
    modalInput.focus();
  }, 100);

  return modal;
}


  function createFlexSettingItem(labelText, configKey, options, containerType) {
    const container = document.createElement('div');
    container.className = 'flex-item';

    const selectId = `select-${configKey}`;

    const label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = selectId;

    const select = document.createElement('select');
    select.name = configKey;
    select.id = selectId;

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = config.languageLabels.selectDefault || 'Varsayılan';
    select.appendChild(emptyOption);

    options.forEach(option => {
      const optElement = document.createElement('option');
      optElement.value = option.value;
      optElement.textContent = option.label;
      if (config[configKey] === option.value) {
        optElement.selected = true;
      }
      select.appendChild(optElement);
    });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = config.languageLabels.resetButton || 'Sıfırla';
    resetBtn.type = 'button';
    resetBtn.className = 'reset-button';
    resetBtn.addEventListener('click', () => {
      select.value = '';
      config[configKey] = '';
      updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), '');
    });

    select.addEventListener('change', function() {
      config[configKey] = this.value;
      updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), this.value);
    });

    select.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openSelectModal(this, configKey, options, containerType);
    });

    container.append(label, select, resetBtn);
    return container;
}

  function openSelectModal(selectElement, configKey, options, containerType) {
  const mainModal = document.getElementById('settings-modal');
  if (mainModal) mainModal.style.display = 'none';

  const modal = document.createElement('div');
  modal.className = 'position-modal';
  modal.style.display = 'block';

  const modalContent = document.createElement('div');
  modalContent.className = 'position-modal-content';

  const title = document.createElement('h3');
  const sectionLabel = containerType
    ? config.languageLabels[`${containerType}Container`]
    : config.languageLabels.slidesPosition;
  const fieldLabel = selectElement.previousElementSibling?.textContent
    || config.languageLabels[configKey]
    || configKey.replace(/([A-Z])/g, ' $1').trim();
  title.textContent = sectionLabel
    ? `${sectionLabel} — ${fieldLabel}`
    : fieldLabel;
  title.className = 'position-modal-title';
  modalContent.appendChild(title);

  const closeBtn = document.createElement('span');
  closeBtn.className = 'position-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => {
    modal.remove();
    if (mainModal) mainModal.style.display = 'block';
  };
  modalContent.appendChild(closeBtn);

  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'position-modal-options';

  options.forEach(option => {
    const optionBtn = document.createElement('button');
    optionBtn.className = 'position-modal-option';
    if (selectElement.value === option.value) {
      optionBtn.classList.add('active');
    }
    optionBtn.textContent = option.label;
    optionBtn.onclick = () => {
      selectElement.value = option.value;
      config[configKey] = option.value;
      updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), option.value);
      optionsContainer.querySelectorAll('.position-modal-option').forEach(btn => btn.classList.remove('active'));
      optionBtn.classList.add('active');
    };
    optionsContainer.appendChild(optionBtn);
  });

  modalContent.appendChild(optionsContainer);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      if (mainModal) mainModal.style.display = 'block';
    }
  });
}

  function updateContainerStyle(target, containerType, cssProperty, newValue) {
  if (target === 'homeSections') {
    const elements = [
      document.querySelector(".homeSectionsContainer"),
      document.querySelector("#favoritesTab")
    ];

    elements.forEach(el => {
      if (el) {
        el.style[cssProperty] = newValue === '' ? '' : `${newValue}vh`;
      }
    });
   } else {
    const selector = containerType
      ? (containerType === 'button' ? '.monwui-main-button-container'
        : containerType === 'slider' ? '.monwui-slider-wrapper'
        : containerType === 'existingDot' ? '.monwui-dot-navigation-container'
        : containerType === 'progress' ? '.monwui-slide-progress-bar'
        : containerType === 'progressSeconds' ? '.monwui-slide-progress-seconds'
        : `.monwui-${containerType}-container`)
      : "#monwui-slides-container";

    document.querySelectorAll(selector).forEach(el => {
      el.style[cssProperty] = newValue === '' ? '' : `${newValue}%`;
    });
  }
}

  function updateFlexStyle(containerType, flexProperty, newValue) {
  const selector =
    containerType === 'button' ? '.monwui-main-button-container' :
    containerType === 'slider' ? '.monwui-slider-wrapper' :
    containerType === 'existingDot' ? '.monwui-dot-navigation-container' :
    containerType === 'progress' ? '.monwui-slide-progress-bar' :
    containerType === 'progressSeconds' ? '.monwui-slide-progress-seconds' :
    `.monwui-${containerType}-container`;

  document.querySelectorAll(selector).forEach(el => {
    if (flexProperty.includes('Display')) {
      el.style.display = newValue || '';
    } else {
      let camel = flexProperty.charAt(0).toLowerCase() + flexProperty.slice(1);
      const cssProp = camel.replace(/([A-Z])/g, m => '-' + m.toLowerCase());
      el.style[cssProp] = newValue || '';
    }
  });
}

  function render() {
    section.appendChild(createGlobalResetButton());
    const homeSectionsHeader = document.createElement('h3');
    homeSectionsHeader.textContent = config.languageLabels.homeSectionsPosition || 'Ana Bölüm Pozisyonu';
    section.appendChild(homeSectionsHeader);

    const homeSectionsHeaderNote = document.createElement('h5');
    homeSectionsHeaderNote.textContent = config.languageLabels.homeSectionsPositionNote || '(Eksi (-) değerler, konumlandırmayı ters yönde değiştirir.)';
    section.appendChild(homeSectionsHeaderNote);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop || 'Dikey Konum (vh):',
        'homeSectionsTop',
        'top',
        config.languageLabels.placeholderText,
        'homeSections'
      )
    );

    const slidesHeader = document.createElement('h3');
    slidesHeader.textContent = config.languageLabels.slidesPosition || 'Slayt Konteyner Pozisyonu';
    section.appendChild(slidesHeader);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop ?? 'Dikey Konum (%):',
        'slideTop',
        'top',
        config.languageLabels.placeholderText
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerLeft ?? 'Yatay Konum (%):',
        'slideLeft',
        'left',
        config.languageLabels.placeholderText
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerWidth ?? 'Genişlik (%):',
        'slideWidth',
        'width',
        config.languageLabels.placeholderText
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerHeight ?? 'Yükseklik (%):',
        'slideHeight',
        'height',
        config.languageLabels.placeholderText
      )
    );

    const containers = [
      { type: 'logo', label: config.languageLabels.logoContainer || 'Logo Konteyneri', flexSettings: false, positionSettings: true },
      { type: 'meta', label: config.languageLabels.metaContainer || 'Meta Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'status', label: config.languageLabels.statusContainer || 'Durum Pozisyonu', flexSettings: true, positionSettings: true },
      { type: 'rating', label: config.languageLabels.ratingContainer || 'Oylama Pozisyonu', flexSettings: true, positionSettings: true },
      { type: 'plot', label: config.languageLabels.plotContainer || 'Plot Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'title', label: config.languageLabels.titleContainer || 'Başlık Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'director', label: config.languageLabels.directorContainer || 'Yönetmen Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'info', label: config.languageLabels.infoContainer || 'Bilgi Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'button', label: config.languageLabels.buttonContainer || 'Buton Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'existingDot', label: config.languageLabels.dotContainer || 'Dot Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'provider', label: config.languageLabels.providerContainer || 'Sağlayıcı Konteyneri', flexSettings: true, positionSettings: true },
      { type: 'providericons', label: config.languageLabels.providericonsContainer || 'Sağlayıcı ikon Pozisyonu', flexSettings: true, positionSettings: false }
    ];

    containers.forEach(({ type, label, flexSettings, positionSettings }) => {
      const header = document.createElement('h3');
      header.textContent = label;
      section.appendChild(header);

      if (positionSettings) {
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerTop || 'Dikey Konum (%):',
            `${type}ContainerTop`,
            'top',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerLeft || 'Yatay Konum (%):',
            `${type}ContainerLeft`,
            'left',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerWidth || 'Genişlik (%):',
            `${type}ContainerWidth`,
            'width',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerHeight || 'Yükseklik (%):',
            `${type}ContainerHeight`,
            'height',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
      }

      if (flexSettings) {
        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.flexDisplay || 'Görüntüleme Tipi:',
            `${type}ContainerDisplay`,
            [
              { value: 'flex', label: config.languageLabels.flex || 'Flex' },
              { value: 'inline-flex', label: config.languageLabels.inlineFlex || 'Inline Flex' },
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.flexDirection || 'Flex Direction:',
            `${type}ContainerFlexDirection`,
            [
              { value: 'row', label: config.languageLabels.row || 'Row' },
              { value: 'column', label: config.languageLabels.column || 'Column' },
              { value: 'row-reverse', label: config.languageLabels.rowreverse || 'Row Reverse' },
              { value: 'column-reverse', label: config.languageLabels.columnreverse || 'Column Reverse' }
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.justifyContent || 'Ana Eksen Hizası:',
            `${type}ContainerJustifyContent`,
            [
              { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
              { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
              { value: 'center', label: config.languageLabels.center || 'Center' },
              { value: 'space-between', label: config.languageLabels.spacebetween || 'Space Between' },
              { value: 'space-around', label: config.languageLabels.spacearound || 'Space Around' },
              { value: 'space-evenly', label: config.languageLabels.spaceevenly || 'Space Evenly' }
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.alignItems || 'Çapraz Eksen Hizası:',
            `${type}ContainerAlignItems`,
            [
              { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
              { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
              { value: 'center', label: config.languageLabels.center || 'Center' },
              { value: 'baseline', label: config.languageLabels.baseline || 'Baseline' },
              { value: 'stretch', label: config.languageLabels.stretch || 'Stretch' }
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.flexWrap || 'Sarma Davranışı:',
            `${type}ContainerFlexWrap`,
            [
              { value: 'nowrap', label: config.languageLabels.nowrap || 'No Wrap' },
              { value: 'wrap', label: config.languageLabels.wrap || 'Wrap' },
              { value: 'wrap-reverse', label: config.languageLabels.wrapreverse || 'Wrap Reverse' }
            ],
            type
          )
        );
      }
    });

    const sliderWrapperHeader = document.createElement('h3');
    sliderWrapperHeader.textContent = config.languageLabels.sliderWrapperContainer || 'Slider Wrapper Konteyneri';
    section.appendChild(sliderWrapperHeader);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop || 'Dikey Konum (%):',
        'sliderContainerTop',
        'top',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerLeft || 'Yatay Konum (%):',
        'sliderContainerLeft',
        'left',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerWidth || 'Genişlik (%):',
        'sliderContainerWidth',
        'width',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerHeight || 'Yükseklik (%):',
        'sliderContainerHeight',
        'height',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.flexDisplay || 'Görüntüleme Tipi:',
        'sliderContainerDisplay',
        [
          { value: 'flex', label: config.languageLabels.flex || 'Flex' },
          { value: 'inline-flex', label: config.languageLabels.inlineFlex || 'Inline Flex' },
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.flexDirection || 'Esnek Yön:',
        'sliderContainerFlexDirection',
        [
          { value: 'row', label: config.languageLabels.row || 'Row' },
          { value: 'column', label: config.languageLabels.column || 'Column' },
          { value: 'row-reverse', label: config.languageLabels.rowreverse || 'Row Reverse' },
          { value: 'column-reverse', label: config.languageLabels.columnreverse || 'Column Reverse' }
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.justifyContent || 'Ana Eksen Hizası:',
        'sliderContainerJustifyContent',
        [
          { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
          { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
          { value: 'center', label: config.languageLabels.center || 'Center' },
          { value: 'space-between', label: config.languageLabels.spacebetween || 'Space Between' },
          { value: 'space-around', label: config.languageLabels.spacearound || 'Space Around' },
          { value: 'space-evenly', label: config.languageLabels.spaceevenly || 'Space Evenly' }
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.alignItems || 'Çapraz Eksen Hizası:',
        'sliderContainerAlignItems',
        [
          { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
          { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
          { value: 'center', label: config.languageLabels.center || 'Center' },
          { value: 'baseline', label: config.languageLabels.baseline || 'Baseline' },
          { value: 'stretch', label: config.languageLabels.stretch || 'Stretch' }
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.flexWrap || 'Sarma Davranışı:',
        'sliderContainerFlexWrap',
        [
          { value: 'nowrap', label: config.languageLabels.nowrap || 'No Wrap' },
          { value: 'wrap', label: config.languageLabels.wrap || 'Wrap' },
          { value: 'wrap-reverse', label: config.languageLabels.wrapreverse || 'Wrap Reverse' }
        ],
        'slider'
      )
    );

const progressSecondsHeader = document.createElement('h3');
progressSecondsHeader.textContent = config.languageLabels.progressSecondsHeader || 'Progress (Saniye) Konteyneri';
section.appendChild(progressSecondsHeader);

section.appendChild(
  createSettingItem(
    config.languageLabels.containerTop || 'Dikey Konum (%):',
    'progressSecondsTop',
    'top',
    config.languageLabels.placeholderText,
    'progress',
    'progressSeconds'
  )
);
section.appendChild(
  createSettingItem(
    config.languageLabels.containerLeft || 'Yatay Konum (%):',
    'progressSecondsLeft',
    'left',
    config.languageLabels.placeholderText,
    'progress',
    'progressSeconds'
  )
);

    const progressBarHeader = document.createElement('h3');
    progressBarHeader.textContent = config.languageLabels.progressBarHeader || 'Progress Konteyneri';
    section.appendChild(progressBarHeader);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop || 'Dikey Konum (%):',
        'progressBarTop',
        'top',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerLeft || 'Yatay Konum (%):',
        'progressBarLeft',
        'left',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerWidth || 'Genişlik (%):',
        'progressBarWidth',
        'width',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerHeight || 'Yükseklik (%):',
        'progressBarHeight',
        'height',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    return section;
  }

  return {
    render,
    updateContainerStyle,
    updateFlexStyle
  };
}
