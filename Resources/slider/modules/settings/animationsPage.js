import { getConfig } from "../config.js";
import { createCheckbox, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol } from "./shared.js";
import { applySettings, applyRawConfig } from "./applySettings.js";

export function createAnimationPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'animation-panel';
    panel.className = 'settings-panel';

    const slideAnimDiv = document.createElement('div');
    slideAnimDiv.className = 'fsetting-item';

    const slideAnimCheckbox = createCheckbox(
        'enableSlideAnimations',
        labels.enableSlideAnimations || 'Slayt Animasyonlarını Etkinleştir',
        config.enableSlideAnimations
    );
    slideAnimDiv.appendChild(slideAnimCheckbox);

    const slideTypeDiv = document.createElement('div');
    slideTypeDiv.className = 'fsetting-item slide-anim-container';
    const slideTypeLabel = document.createElement('label');
    slideTypeLabel.textContent = labels.slideTransitionType || 'Slayt Geçiş Türü:';
    const slideTypeSelect = document.createElement('select');
    slideTypeSelect.name = 'slideTransitionType';

    const slideTypes = [
        { value: 'flip', label: labels.flipAnimation || '3D Flip' },
        { value: 'glitch', label: labels.glitchAnimation || 'Glitch Etkisi' },
        { value: 'morph', label: labels.morphAnimation || 'Morph' },
        { value: 'cube', label: labels.cubeAnimation || '3D Küp' },
        { value: 'zoom', label: labels.zoomAnimation || 'Zoom Döngüsü' },
        { value: 'slide', label: labels.slide || 'Düz Kaydırma' },
        { value: 'slide3d', label: labels.slide3dAnimation || '3D Kaydırma' },
        { value: 'slideTop', label: labels.slideTop || 'Yukarıdan Kaydırma' },
        { value: 'slideBottom', label: labels.slideBottom || 'Aşağıdan Kaydırma' },
        { value: 'diagonal', label: labels.diagonal || 'Çapraz Kaydırma' },
        { value: 'fadezoom', label: labels.fadezoom || 'Silinerek Yakınlaşma' },
        { value: 'parallax', label: labels.parallax || 'Paralaks'},
        { value: 'blur-fade', label: labels.blurfade || 'Bulanıklaşma'},
        { value: 'rotateIn', label: labels.rotateIn || 'Dönerek Giriş'},
        { value: 'flipInX', label: labels.flipInX || 'Çevirerek Giriş X'},
        { value: 'flipInY', label: labels.flipInY || 'Çevirerek Giriş Y'},
        { value: 'jelly', label: labels.jelly || 'Jöle'},
        { value: 'eye', label: labels.eye || 'Göz'},
    ];

    slideTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type.value;
        option.textContent = type.label;
        if (type.value === config.slideTransitionType) {
            option.selected = true;
        }
        slideTypeSelect.appendChild(option);
    });

    slideTypeLabel.htmlFor = 'slideTypeSelect';
    slideTypeSelect.id = 'slideTypeSelect';
    slideTypeDiv.append(slideTypeLabel, slideTypeSelect);

    const slideDurationDiv = document.createElement('div');
    slideDurationDiv.className = 'fsetting-item slide-anim-container';
    const slideDurationLabel = document.createElement('label');
    slideDurationLabel.textContent = labels.slideAnimationDuration || 'Slayt Animasyon Süresi (ms):';
    const slideDurationInput = document.createElement('input');
    slideDurationInput.type = 'number';
    slideDurationInput.value = config.slideAnimationDuration || 800;
    slideDurationInput.name = 'slideAnimationDuration';
    slideDurationInput.min = 100;
    slideDurationInput.max = 3000;
    slideDurationInput.step = 50;
    slideDurationLabel.htmlFor = 'slideDurationInput';
    slideDurationInput.id = 'slideDurationInput';
    slideDurationDiv.append(slideDurationLabel, slideDurationInput);

    const dotAnimDiv = document.createElement('div');
    dotAnimDiv.className = 'fsetting-item';

    const dotAnimCheckbox = createCheckbox(
        'enableDotPosterAnimations',
        labels.enableDotPosterAnimations || 'Nokta Navigasyon Poster Animasyonlarını Etkinleştir',
        config.enableDotPosterAnimations
    );

    dotAnimDiv.appendChild(dotAnimCheckbox);

    const dotTypeDiv = document.createElement('div');
    dotTypeDiv.className = 'fsetting-item dot-anim-container';
    const dotTypeLabel = document.createElement('label');
    dotTypeLabel.textContent = labels.dotPosterTransitionType || 'Dot Geçiş Türü:';
    const dotTypeSelect = document.createElement('select');
    dotTypeSelect.name = 'dotPosterTransitionType';

    const dotTypes = [
        { value: 'scale', label: labels.scaleAnimation || 'Ölçekleme' },
        { value: 'bounce', label: labels.bounceAnimation || 'Zıplama' },
        { value: 'rotate', label: labels.rotateAnimation || 'Döndürme' },
        { value: 'color', label: labels.colorAnimation || 'Renk Değişimi' },
        { value: 'float', label: labels.floatAnimation || 'Yüzdürme' },
        { value: 'pulse', label: labels.pulseAnimation || 'Nabız' },
        { value: 'tilt', label: labels.tiltAnimation || 'Eğilme' },
        { value: 'shake', label: labels.shakeAnimation || 'Titreme' },
        { value: 'glow', label: labels.glow || 'Parıltı' },
        { value: 'rubberBand', label: labels.rubberBand || 'Lastik' },
        { value: 'swing', label: labels.swing || 'Sallanma' },
        { value: 'flip', label: labels.flip || 'Çevir' },
        { value: 'flash', label: labels.flash || 'flaş' },
        { value: 'wobble', label: labels.wobble || 'Salla' },
    ];

    dotTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type.value;
        option.textContent = type.label;
        if (type.value === config.dotPosterTransitionType) {
            option.selected = true;
        }
        dotTypeSelect.appendChild(option);
    });

    dotTypeLabel.htmlFor = 'dotTypeSelect';
    dotTypeSelect.id = 'dotTypeSelect';
    dotTypeDiv.append(dotTypeLabel, dotTypeSelect);

    const dotDurationDiv = document.createElement('div');
    dotDurationDiv.className = 'fsetting-item dot-anim-container';
    const dotDurationLabel = document.createElement('label');
    dotDurationLabel.textContent = labels.dotPosterAnimationDuration || 'Dot Animasyon Süresi (ms):';
    const dotDurationInput = document.createElement('input');
    dotDurationInput.type = 'number';
    dotDurationInput.value = config.dotPosterAnimationDuration || 500;
    dotDurationInput.name = 'dotPosterAnimationDuration';
    dotDurationInput.min = 100;
    dotDurationInput.max = 3000;
    dotDurationInput.step = 50;
    dotDurationLabel.htmlFor = 'dotDurationInput';
    dotDurationInput.id = 'dotDurationInput';
    dotDurationDiv.append(dotDurationLabel, dotDurationInput);

    panel.append(
        slideAnimDiv,
        slideTypeDiv,
        slideDurationDiv,
        dotAnimDiv,
        dotTypeDiv,
       dotDurationDiv
    );

    bindCheckboxKontrol('#enableSlideAnimations', '.slide-anim-container', 0.6, [slideTypeSelect, slideDurationInput]);
    bindCheckboxKontrol('#enableDotPosterAnimations', '.dot-anim-container', 0.6, [dotTypeSelect, dotDurationInput]);
    return panel;
}
