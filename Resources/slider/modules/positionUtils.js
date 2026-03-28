import { getConfig } from "./config.js";
import { forceHomeSectionsTop } from './positionOverrides.js';

const config = getConfig();

function setImportantStyle(element, property, value) {
  if (!element) return;

  if (value !== undefined && value !== null && value !== '') {
    element.style.setProperty(property, value, 'important');
  } else {
    element.style.removeProperty(property);
  }
}

export function applyContainerStyles(container, type = '') {
  const config = getConfig();
  let prefix;

  if (type === 'progress') {
    prefix = 'progressBar';
  } else if (type === 'progressSeconds') {
    prefix = 'progressSeconds';
  } else if (type) {
    prefix = `${type}Container`;
  } else {
    prefix = 'slide';
  }

  setImportantStyle(container, 'top',    config[`${prefix}Top`]    ? `${config[`${prefix}Top`]}%`    : '');
  setImportantStyle(container, 'left',   config[`${prefix}Left`]   ? `${config[`${prefix}Left`]}%`   : '');
  setImportantStyle(container, 'width',  config[`${prefix}Width`]  ? `${config[`${prefix}Width`]}%`  : '');
  setImportantStyle(container, 'height', config[`${prefix}Height`] ? `${config[`${prefix}Height`]}%` : '');

  if (type && type !== 'slide' && type !== 'progressSeconds' && type !== 'progress') {
    setImportantStyle(container, 'display',         config[`${prefix}Display`]        || '');
    setImportantStyle(container, 'flex-direction',  config[`${prefix}FlexDirection`]  || '');
    setImportantStyle(container, 'justify-content', config[`${prefix}JustifyContent`] || '');
    setImportantStyle(container, 'align-items',     config[`${prefix}AlignItems`]     || '');
    setImportantStyle(container, 'flex-wrap',       config[`${prefix}FlexWrap`]       || '');
  }
}

export function updateSlidePosition() {
  const config = getConfig();

  const slidesContainer = document.querySelector("#monwui-slides-container");
  if (slidesContainer) applyContainerStyles(slidesContainer);

  const containerTypes = [
    'logo', 'meta', 'status', 'rating', 'plot',
    'title', 'director', 'info', 'button',
    'existingDot', 'provider', 'providericons'
  ];

  containerTypes.forEach(type => {
    document.querySelectorAll(`.monwui-${type}-container`).forEach(container => {
      applyContainerStyles(container, type);
    });
  });

  const sliderWrapper = document.querySelector(".monwui-slider-wrapper");
  if (sliderWrapper) applyContainerStyles(sliderWrapper, 'slider');

  const progressBar = document.querySelector(".monwui-slide-progress-bar");
  if (progressBar) applyContainerStyles(progressBar, 'progress');

  const progressSeconds = document.querySelector(".monwui-slide-progress-seconds");
  if (progressSeconds) applyContainerStyles(progressSeconds, 'progressSeconds');

  const homeSectionsContainer = document.querySelector(".homeSectionsContainer");
  if (homeSectionsContainer) {
    setImportantStyle(
      homeSectionsContainer,
      'top',
      config.homeSectionsTop ? `${config.homeSectionsTop}vh` : ''
    );
  }
}
