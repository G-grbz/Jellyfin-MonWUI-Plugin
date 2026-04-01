import { getConfig } from "../config.js";
import { createCheckbox, createSection, createImageTypeSelect, bindCheckboxKontrol } from "../settings.js";

export function createQueryPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'query-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.queryStringInput || 'Api Sorgu Parametresi');
    const randomContentDiv = document.createElement('div');
    const randomContentCheckbox = createCheckbox(
        'useRandomContent',
        labels.useRandomContent || 'Rastgele İçerik',
        false
    );
    randomContentDiv.appendChild(randomContentCheckbox);
    section.appendChild(randomContentDiv);

    const useListFileCheckbox = createCheckbox(
      'useListFile',
      labels.useListFile || 'list.txt kullan',
      config.useListFile
    );
    section.appendChild(useListFileCheckbox);

    const manualListDiv = document.createElement('div');
    manualListDiv.className = 'form-group';
    const useManualListCheckbox = createCheckbox(
      'useManualList',
      labels.useManualList || 'Özel Liste Hazırla',
      config.useManualList
    );
    manualListDiv.appendChild(useManualListCheckbox);

    const manualListIdsDiv = document.createElement('div');
    manualListIdsDiv.className = 'form-group manual-list-container';
    manualListIdsDiv.id = 'manualListIdsContainer';
    manualListIdsDiv.style.display = config.useManualList ? 'block' : 'none';

    const manualListIdsLabel = document.createElement('label');
    manualListIdsLabel.textContent = labels.manualListIdsInput || 'İçerik ID\'leri (virgülle ayırın):';

    const manualListIdsInput = document.createElement('textarea');
    manualListIdsInput.className = 'form-control';
    manualListIdsInput.rows = 4;
    manualListIdsInput.name = 'manualListIds';
    manualListIdsInput.value = config.manualListIds || '';

    manualListIdsLabel.htmlFor = 'manualListIdsInput';
    manualListIdsInput.id = 'manualListIdsInput';
    manualListIdsDiv.append(manualListIdsLabel, manualListIdsInput);

    section.appendChild(manualListDiv);
    section.appendChild(manualListIdsDiv);

    const limitDiv = document.createElement('div');
    limitDiv.className = 'setting-item limit-container';

    const limitLabel = document.createElement('label');
    limitLabel.textContent = labels.limit || 'Slider Limiti:';

    const limitInput = document.createElement('input');
    limitInput.type = 'number';
    limitInput.value = typeof config.limit !== 'undefined' ? config.limit : 20;
    limitInput.name = 'limit';
    limitInput.min = 1;
    limitInput.max = 100;

    limitLabel.htmlFor = 'limitInput';
    limitInput.id = 'limitInput';
    limitDiv.append(limitLabel, limitInput);

    const limitDesc = document.createElement('div');
    limitDesc.className = 'description-text';
    limitDesc.textContent = labels.limitDesc ||
      'Görünecek slider limiti';

    section.appendChild(limitDesc);
    section.appendChild(limitDiv);

    const maxShufflingLimitDiv = document.createElement('div');
    maxShufflingLimitDiv.className = 'setting-item limit-container';

    const maxShufflingLimitLabel = document.createElement('label');
    maxShufflingLimitLabel.textContent = labels.maxShufflingLimit || 'Maksimum Karıştırılacak İçerik Limiti:';

    const maxShufflingLimitInput = document.createElement('input');
    maxShufflingLimitInput.type = 'number';
    maxShufflingLimitInput.value = typeof config.maxShufflingLimit !== 'undefined' ? config.maxShufflingLimit : 10000;
    maxShufflingLimitInput.name = 'maxShufflingLimit';
    maxShufflingLimitInput.min = 1;
    maxShufflingLimitInput.max = 1000000;

    maxShufflingLimitLabel.htmlFor = 'maxShufflingLimitInput';
    maxShufflingLimitInput.id = 'maxShufflingLimitInput';
    maxShufflingLimitDiv.append(maxShufflingLimitLabel, maxShufflingLimitInput);

    const maxShufflingLimitDesc = document.createElement('div');
    maxShufflingLimitDesc.className = 'description-text';
    maxShufflingLimitDesc.textContent = labels.maxShufflingLimitDesc ||
      'Slider oluşturmak için seçilecek içerik limitidir örneğin 1000 belirlerseniz 1000 içerik içinden seçim yaparak slider oluşturulur.';

    section.appendChild(maxShufflingLimitDesc);
    section.appendChild(maxShufflingLimitDiv);

    const shuffleSeedLimitDiv = document.createElement('div');
    shuffleSeedLimitDiv.className = 'setting-item shuffleSeedLimit-container';

    const shuffleSeedLimitLabel = document.createElement('label');
    shuffleSeedLimitLabel.textContent = labels.shuffleSeedLimit || 'shuffleSeedLimit (Tekrar Engelleme Limiti):';

    const shuffleSeedLimitInput = document.createElement('input');
    shuffleSeedLimitInput.type = 'number';
    shuffleSeedLimitInput.value = typeof config.shuffleSeedLimit !== 'undefined' ? config.shuffleSeedLimit : 200;
    shuffleSeedLimitInput.name = 'shuffleSeedLimit';
    shuffleSeedLimitInput.min = 1;
    shuffleSeedLimitInput.max = 100000;

    shuffleSeedLimitLabel.htmlFor = 'shuffleSeedLimitInput';
    shuffleSeedLimitInput.id = 'shuffleSeedLimitInput';
    shuffleSeedLimitDiv.append(shuffleSeedLimitLabel, shuffleSeedLimitInput);

    const shuffleSeedLimitDesc = document.createElement('div');
    shuffleSeedLimitDesc.className = 'description-text';
    shuffleSeedLimitDesc.textContent = labels.shuffleSeedLimitDesc ||
      'shuffleSeedLimit, aynı içeriklerin yeniden gösterilmesini önlemek amacıyla, karıştırma seçimleri sırasında kullanılan geçmiş belleğin maksimum uzunluğunu belirler. Bu limit aşıldığında karıştırma geçmişi otomatik olarak temizlenir. (Bu özellik sadece Anahtar Kelimeler listesindeki herhangi bir değerin, Api sorgu Parametresi içerisinde kullanılmıyorsa aktiftir. Yani eğer sıralı veya sabit içerik sorguları yapılıyorsa (örneğin: "en çok izlenenler", "yeni eklenenler"), bu filtre devre dışı kalır ve karıştırma geçmişi kullanılmaz.)';

    section.appendChild(shuffleSeedLimitDesc);
    section.appendChild(shuffleSeedLimitDiv);

    const playingLimitDiv = document.createElement('div');
    playingLimitDiv.className = 'setting-item playing-limit-container';
    playingLimitDiv.style.display = randomContentCheckbox.querySelector('input').checked ? 'block' : 'none';

    const playingLimitLabel = document.createElement('label');
    playingLimitLabel.textContent = labels.playingLimit || 'İzlenenlerden Getirilecek Miktar:';

    const playingLimitInput = document.createElement('input');
    playingLimitInput.type = 'number';
    playingLimitInput.value = config.playingLimit ?? 5;
    playingLimitInput.name = 'playingLimit';
    playingLimitInput.min = 0;
    playingLimitInput.max = 100;

    playingLimitLabel.htmlFor = 'playingLimitInput';
    playingLimitInput.id = 'playingLimitInput';
    playingLimitDiv.append(playingLimitLabel, playingLimitInput);

    const playingLimitDesc = document.createElement('div');
    playingLimitDesc.className = 'description-text';
    playingLimitDesc.textContent = labels.playingLimitDesc ||
      'İzlenmesi yarıda kesilen son içerikleri listeler. "0" değeri pasif hale getirir.';

    section.appendChild(playingLimitDesc);
    section.appendChild(playingLimitDiv);

    const excludeEpisodesDiv = document.createElement('div');
    excludeEpisodesDiv.className = 'setting-item exclude-episodes-container';
    excludeEpisodesDiv.style.display = randomContentCheckbox.querySelector('input').checked ? 'block' : 'none';

    const excludeEpisodesCheckbox = createCheckbox(
    'excludeEpisodesFromPlaying',
    labels.excludeEpisodesFromPlaying || 'Dizi Bölümlerini Hariç Tut',
    config.excludeEpisodesFromPlaying || false
    );

    excludeEpisodesDiv.appendChild(excludeEpisodesCheckbox);

    const excludeEpisodesDesc = document.createElement('div');
    excludeEpisodesDesc.className = 'description-text';
    excludeEpisodesDesc.textContent = labels.excludeEpisodesFromPlayingDesc ||
    'İşaretlenirse "İzlenenler" listesinden bölümleri hariç tutar';

    section.appendChild(excludeEpisodesDesc);
    section.appendChild(excludeEpisodesDiv);

    const queryStringLabel = document.createElement('label');
    queryStringLabel.className = 'customQueryStringInput query-string-label';
    queryStringLabel.textContent = labels.customQueryString || 'Api Sorgu Dizesi:';
    queryStringLabel.htmlFor = 'customQueryStringInput';
    section.appendChild(queryStringLabel);

    const queryStringDesc = document.createElement('div');
    queryStringDesc.className = 'description-text';
    queryStringDesc.textContent = labels.customQueryStringNote ||
      '(Ne yaptığınız hakkında fikriniz yok ise bu alanı değiştirmeyin ve sadece list.txt kullanılmadıkça etkin olduğunu unutmayın.)';
    section.appendChild(queryStringDesc);

    const queryStringTextarea = document.createElement('textarea');
    queryStringTextarea.id = 'customQueryStringInput';
    queryStringTextarea.className = 'query-string-input';
    queryStringTextarea.rows = 4;
    queryStringTextarea.name = 'customQueryString';
    queryStringTextarea.placeholder = labels.customQueryStringPlaceholder ||
      'Örnek: IncludeItemTypes=Movie&hasOverview=true&imageTypes=Backdrop';
    queryStringTextarea.value = config.customQueryString;
    section.appendChild(queryStringTextarea);

    const balanceTypesDiv = document.createElement('div');
    balanceTypesDiv.className = 'setting-item balance-types-container';

    const balanceTypesCheckbox = createCheckbox(
    'balanceItemTypes',
    labels.balanceItemTypes || 'Tür Dengeleme Aktif',
    config.balanceItemTypes || false
    );
    balanceTypesDiv.appendChild(balanceTypesCheckbox);

    const balanceTypesDesc = document.createElement('div');
    balanceTypesDesc.className = 'description-text';
    balanceTypesDesc.textContent = labels.balanceItemTypesDesc ||
      'İşaretlenirse seçilen içerikler türlere (Movie, Series, BoxSet) göre eşit dağılmaya çalışır.';

    section.appendChild(balanceTypesDesc);
    section.appendChild(balanceTypesDiv);

    const onlyUnwatchedDiv = document.createElement('div');
    onlyUnwatchedDiv.className = 'setting-item only-unwatched-container';
    const onlyUnwatchedCheckbox = createCheckbox(
    'onlyUnwatchedRandom',
    (labels.onlyUnwatchedRandom || 'Sadece izlenmeyenleri göster (Rastgele İçerik)'),
    !!config.onlyUnwatchedRandom
    );
    onlyUnwatchedDiv.appendChild(onlyUnwatchedCheckbox);

    const onlyUnwatchedDesc = document.createElement('div');
    onlyUnwatchedDesc.className = 'description-text';
    onlyUnwatchedDesc.textContent = labels.onlyUnwatchedRandomDesc ||
    'Etkinse, Rastgele İçerik modunda yalnızca hiç oynatılmamış (IsPlayed=false) öğeler listelenir. list.txt ve Özel Liste etkilenmez.';

    section.appendChild(onlyUnwatchedDesc);
    section.appendChild(onlyUnwatchedDiv);

    const sortingLabel = document.createElement('label');
    sortingLabel.textContent = labels.sortingKeywords || 'Anahtar Kelimeler (virgül ile ayırınız)';
    sortingLabel.htmlFor = 'sortingKeywordsInput';
    section.appendChild(sortingLabel);

    const sortingTextarea = document.createElement('textarea');
    sortingTextarea.id = 'sortingKeywordsInput';
    sortingTextarea.name = 'sortingKeywords';
    sortingTextarea.placeholder = 'DateCreated,PremiereDate,ProductionYear';
    sortingTextarea.value = config.sortingKeywords || '';
    section.appendChild(sortingTextarea);

    const finalDesc = document.createElement('div');
    finalDesc.className = 'description-text';
    finalDesc.innerHTML = labels.customQueryStringDescription ||
      'Bu ayar, slider için özel bir sorgu dizesi belirlemenizi sağlar. Tanımlı \'IncludeItemTypes\' itemleri: Movie, BoxSet ve Series\'dir. Anahtar Kelimeler alanı ise karıştırma yapılmaması gereken değerler içindir. Detaylar İçin <a href="https://api.jellyfin.org" target="_blank">burayı ziyaret edin.</a>.';
    section.appendChild(finalDesc);

    function handleSelection(selectedCheckbox) {
    const checkboxes = [
        randomContentCheckbox.querySelector('input'),
        useListFileCheckbox.querySelector('input'),
        useManualListCheckbox.querySelector('input')
    ];

    checkboxes.forEach(cb => {
        if (cb !== selectedCheckbox) cb.checked = false;
    });

    const isRandom = (selectedCheckbox === checkboxes[0]);

    limitDiv.style.display = isRandom ? 'block' : 'none';
    maxShufflingLimitDiv.style.display = isRandom ? 'block' : 'none';
    queryStringLabel.style.display = isRandom ? 'block' : 'none';
    sortingTextarea.style.display = isRandom ? 'block' : 'none';
    limitDesc.style.display = isRandom ? 'block' : 'none';
    excludeEpisodesDesc.style.display = isRandom ? 'block' : 'none';
    finalDesc.style.display = isRandom ? 'block' : 'none';
    queryStringDesc.style.display = isRandom ? 'block' : 'none';
    maxShufflingLimitDesc.style.display = isRandom ? 'block' : 'none';
    playingLimitDesc.style.display = isRandom ? 'block' : 'none';
    sortingLabel.style.display = isRandom ? 'block' : 'none';
    queryStringTextarea.style.display = isRandom ? 'block' : 'none';
    playingLimitDiv.style.display = isRandom ? 'block' : 'none';
    excludeEpisodesDiv.style.display = isRandom ? 'block' : 'none';
    shuffleSeedLimitLabel.style.display = isRandom ? 'block' : 'none';
    shuffleSeedLimitInput.style.display = isRandom ? 'block' : 'none';
    shuffleSeedLimitDesc.style.display = isRandom ? 'block' : 'none';
    balanceTypesDiv.style.display = isRandom ? 'block' : 'none';
    balanceTypesDesc.style.display = isRandom ? 'block' : 'none';
    onlyUnwatchedDiv.style.display = isRandom ? 'block' : 'none';
    onlyUnwatchedDesc.style.display = isRandom ? 'block' : 'none';
    onlyUnwatchedCheckbox.querySelector('input').disabled = !isRandom;

    limitInput.disabled = !isRandom;
    playingLimitInput.disabled = !isRandom;
    sortingTextarea.disabled = !isRandom;
    queryStringLabel.style.opacity = isRandom ? '1' : '0.6';

    manualListIdsDiv.style.display = (selectedCheckbox === checkboxes[2]) ? 'flex' : 'none';
    manualListIdsInput.disabled = (selectedCheckbox !== checkboxes[2]);
}

    [randomContentCheckbox, useListFileCheckbox, useManualListCheckbox].forEach(chkDiv => {
        chkDiv.querySelector('input').addEventListener('change', function() {
            if (this.checked) handleSelection(this);
        });
    });

    if (config.useListFile) {
        useListFileCheckbox.querySelector('input').checked = true;
        handleSelection(useListFileCheckbox.querySelector('input'));
    } else if (config.useManualList) {
        useManualListCheckbox.querySelector('input').checked = true;
        handleSelection(useManualListCheckbox.querySelector('input'));
    } else {
        randomContentCheckbox.querySelector('input').checked = true;
        handleSelection(randomContentCheckbox.querySelector('input'));
    }

    panel.appendChild(section);
    return panel;
}
