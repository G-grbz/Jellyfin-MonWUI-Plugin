import { createSection } from "./shared.js";
import { showNotification } from "../player/ui/notification.js";

const RELEASE_WAIT_MS = 120;
const DELETE_TIMEOUT_MS = 5000;
const PROBE_DELETE_TIMEOUT_MS = 2500;
const BACKUP_FORMAT = "jms-indexeddb-backup";
const BACKUP_FILE_VERSION = 1;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setStatus(node, message) {
  node.textContent = message || "";
  node.style.display = message ? "block" : "none";
}

function formatLabel(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    return value == null ? "" : String(value);
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB isteği başarısız oldu."));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB işlemi iptal edildi."));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB işlemi başarısız oldu."));
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event?.target?.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Dosya okunamadı."));
    reader.readAsText(file);
  });
}

function countBackupRecords(backup) {
  return (backup?.stores || []).reduce((total, store) => {
    return total + (Array.isArray(store?.records) ? store.records.length : 0);
  }, 0);
}

function sanitizeFileNamePart(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "database";
}

function buildBackupFileName(entry, exportedAt) {
  const timestamp = String(exportedAt || new Date().toISOString())
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");

  return `${sanitizeFileNamePart(entry?.dbName || entry?.key)}-backup-${timestamp}.json`;
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    try {
      document.body.removeChild(anchor);
    } catch {}
    URL.revokeObjectURL(url);
  }, 100);
}

function deleteIndexedDatabase(dbName, { timeoutMs = DELETE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!dbName) {
      reject(new Error("Silinecek veritabanı adı bulunamadı."));
      return;
    }

    if (typeof indexedDB === "undefined") {
      reject(new Error("Bu tarayıcı IndexedDB desteklemiyor."));
      return;
    }

    let blocked = false;
    let settled = false;
    let timer = 0;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };

    try {
      const req = indexedDB.deleteDatabase(dbName);

      req.onblocked = () => {
        blocked = true;
      };

      req.onerror = () => {
        finish(() => {
          reject(req.error || new Error(`${dbName} silinemedi.`));
        });
      };

      req.onsuccess = () => {
        finish(() => resolve({ blocked }));
      };

      timer = setTimeout(() => {
        finish(() => {
          reject(new Error(
            blocked
              ? "Veritabanı şu anda başka bir sekme veya açık bağlantı tarafından kullanılıyor. Sayfayı yenileyip tekrar deneyin."
              : "Veritabanı silme işlemi zaman aşımına uğradı."
          ));
        });
      }, Math.max(1500, Number(timeoutMs) || DELETE_TIMEOUT_MS));
    } catch (error) {
      reject(error);
    }
  });
}

async function openExistingIndexedDatabase(dbName) {
  if (!dbName) {
    throw new Error("Veritabanı adı bulunamadı.");
  }

  if (typeof indexedDB === "undefined") {
    throw new Error("Bu tarayıcı IndexedDB desteklemiyor.");
  }

  if (typeof indexedDB.databases === "function") {
    try {
      const list = await indexedDB.databases();
      if (Array.isArray(list) && !list.some((entry) => entry?.name === dbName)) {
        return null;
      }
    } catch {}
  }

  return new Promise((resolve, reject) => {
    let createdDuringProbe = false;

    try {
      const req = indexedDB.open(dbName);

      req.onupgradeneeded = () => {
        createdDuringProbe = true;
      };

      req.onerror = () => {
        reject(req.error || new Error(`${dbName} açılamadı.`));
      };

      req.onsuccess = async () => {
        const db = req.result;
        const storeCount = Number(db?.objectStoreNames?.length || 0);

        if (createdDuringProbe && storeCount === 0) {
          try {
            db.close();
          } catch {}

          try {
            await deleteIndexedDatabase(dbName, { timeoutMs: PROBE_DELETE_TIMEOUT_MS });
          } catch {}

          resolve(null);
          return;
        }

        resolve(db);
      };
    } catch (error) {
      reject(error);
    }
  });
}

async function exportIndexedDatabase(dbName) {
  const db = await openExistingIndexedDatabase(dbName);
  if (!db) return null;

  try {
    const storeNames = Array.from(db.objectStoreNames || []);
    if (!storeNames.length) return null;

    const stores = [];

    for (const storeName of storeNames) {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const indexes = Array.from(store.indexNames || []).map((indexName) => {
        const index = store.index(indexName);
        return {
          name: index.name,
          keyPath: index.keyPath ?? null,
          unique: index.unique === true,
          multiEntry: index.multiEntry === true
        };
      });
      const records = await requestToPromise(store.getAll());
      await transactionDone(tx);

      stores.push({
        name: store.name,
        keyPath: store.keyPath ?? null,
        autoIncrement: store.autoIncrement === true,
        indexes,
        records: Array.isArray(records) ? records : []
      });
    }

    return {
      format: BACKUP_FORMAT,
      backupVersion: BACKUP_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      dbName: db.name || dbName,
      dbVersion: Math.max(1, Number(db.version) || 1),
      stores,
      metadata: {
        totalStores: stores.length,
        totalRecords: stores.reduce((total, store) => total + store.records.length, 0)
      }
    };
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function normalizeStoreDefinition(rawStore) {
  const name = String(rawStore?.name || "").trim();
  if (!name) return null;

  const seenIndexes = new Set();
  const indexes = Array.isArray(rawStore?.indexes)
    ? rawStore.indexes
        .map((rawIndex) => {
          const indexName = String(rawIndex?.name || "").trim();
          if (!indexName || seenIndexes.has(indexName)) return null;
          seenIndexes.add(indexName);

          return {
            name: indexName,
            keyPath: rawIndex?.keyPath ?? null,
            unique: rawIndex?.unique === true,
            multiEntry: rawIndex?.multiEntry === true
          };
        })
        .filter(Boolean)
    : [];

  return {
    name,
    keyPath: rawStore?.keyPath ?? null,
    autoIncrement: rawStore?.autoIncrement === true,
    indexes,
    records: Array.isArray(rawStore?.records) ? rawStore.records : []
  };
}

function convertLegacyMusicBackup(rawBackup, entry) {
  if (entry?.dbName !== "GMMP-MusicDB") return null;
  if (!rawBackup || !Array.isArray(rawBackup.tracks)) return null;

  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_FILE_VERSION,
    exportedAt: rawBackup?.metadata?.createdAt || new Date().toISOString(),
    dbName: entry.dbName,
    dbVersion: 2,
    sourceFormat: "gmmp-legacy-v1",
    stores: [
      {
        name: "tracks",
        keyPath: "Id",
        autoIncrement: false,
        indexes: [
          { name: "Artists", keyPath: "Artists", unique: false, multiEntry: true },
          { name: "ArtistIds", keyPath: "ArtistIds", unique: false, multiEntry: true },
          { name: "Album", keyPath: "Album", unique: false, multiEntry: false },
          { name: "AlbumArtist", keyPath: "AlbumArtist", unique: false, multiEntry: false },
          { name: "DateCreated", keyPath: "DateCreated", unique: false, multiEntry: false },
          { name: "LastUpdated", keyPath: "LastUpdated", unique: false, multiEntry: false }
        ],
        records: Array.isArray(rawBackup.tracks) ? rawBackup.tracks : []
      },
      {
        name: "deletedTracks",
        keyPath: "id",
        autoIncrement: true,
        indexes: [
          { name: "trackId", keyPath: "trackId", unique: false, multiEntry: false },
          { name: "deletedAt", keyPath: "deletedAt", unique: false, multiEntry: false }
        ],
        records: Array.isArray(rawBackup.deletedTracks) ? rawBackup.deletedTracks : []
      },
      {
        name: "lyrics",
        keyPath: "trackId",
        autoIncrement: false,
        indexes: [],
        records: Array.isArray(rawBackup.lyrics) ? rawBackup.lyrics : []
      }
    ]
  };
}

function normalizeIndexedDatabaseBackup(rawBackup, entry, labels) {
  const genericBackup =
    rawBackup?.format === BACKUP_FORMAT && Array.isArray(rawBackup?.stores)
      ? rawBackup
      : convertLegacyMusicBackup(rawBackup, entry);

  if (!genericBackup) {
    throw new Error(labels?.dbRestoreInvalidFile || labels?.invalidBackupFile || "Geçersiz yedek dosyası.");
  }

  const dbName = String(genericBackup?.dbName || "").trim();
  if (!dbName) {
    throw new Error(labels?.dbRestoreInvalidFile || labels?.invalidBackupFile || "Geçersiz yedek dosyası.");
  }

  const seenStores = new Set();
  const stores = (genericBackup.stores || [])
    .map((store) => normalizeStoreDefinition(store))
    .filter((store) => {
      if (!store || seenStores.has(store.name)) return false;
      seenStores.add(store.name);
      return true;
    });

  if (!stores.length) {
    throw new Error(labels?.dbRestoreInvalidFile || labels?.invalidBackupFile || "Geçersiz yedek dosyası.");
  }

  return {
    format: BACKUP_FORMAT,
    backupVersion: Math.max(1, Number(genericBackup?.backupVersion) || BACKUP_FILE_VERSION),
    exportedAt: genericBackup?.exportedAt || new Date().toISOString(),
    dbName,
    dbVersion: Math.max(1, Number(genericBackup?.dbVersion) || 1),
    stores
  };
}

function createObjectStoreFromDefinition(db, storeDefinition) {
  const options = {};

  if (storeDefinition.keyPath != null) {
    options.keyPath = storeDefinition.keyPath;
  }

  if (storeDefinition.autoIncrement) {
    options.autoIncrement = true;
  }

  return Object.keys(options).length
    ? db.createObjectStore(storeDefinition.name, options)
    : db.createObjectStore(storeDefinition.name);
}

function ensureStoreIndexes(store, storeDefinition) {
  const existingIndexNames = new Set(Array.from(store.indexNames || []));

  for (const indexDefinition of storeDefinition.indexes || []) {
    if (!indexDefinition?.name || existingIndexNames.has(indexDefinition.name)) continue;

    store.createIndex(indexDefinition.name, indexDefinition.keyPath, {
      unique: indexDefinition.unique === true,
      multiEntry: indexDefinition.multiEntry === true
    });
  }
}

async function restoreIndexedDatabaseBackup(backup, { onStatus } = {}) {
  const stores = Array.isArray(backup?.stores) ? backup.stores : [];
  if (!backup?.dbName || !stores.length) {
    throw new Error("Geri yüklenecek geçerli veritabanı bilgisi bulunamadı.");
  }

  onStatus?.("Veritabanı şeması oluşturuluyor...");

  const db = await new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(backup.dbName, Math.max(1, Number(backup.dbVersion) || 1));

      req.onupgradeneeded = (event) => {
        const upgradeDb = req.result;
        const upgradeTx = event?.target?.transaction;

        for (const storeDefinition of stores) {
          let store;

          if (upgradeDb.objectStoreNames.contains(storeDefinition.name)) {
            store = upgradeTx?.objectStore(storeDefinition.name);
          } else {
            store = createObjectStoreFromDefinition(upgradeDb, storeDefinition);
          }

          if (store) {
            ensureStoreIndexes(store, storeDefinition);
          }
        }
      };

      req.onblocked = () => {
        reject(new Error("Veritabanı başka bir sekme veya açık bağlantı tarafından kullanılıyor."));
      };

      req.onerror = () => {
        reject(req.error || new Error(`${backup.dbName} oluşturulamadı.`));
      };

      req.onsuccess = () => resolve(req.result);
    } catch (error) {
      reject(error);
    }
  });

  try {
    for (let index = 0; index < stores.length; index++) {
      const storeDefinition = stores[index];
      const recordCount = Array.isArray(storeDefinition.records) ? storeDefinition.records.length : 0;

      onStatus?.(
        `"${storeDefinition.name}" geri yükleniyor (${index + 1}/${stores.length}, ${recordCount} kayıt)`
      );

      const tx = db.transaction(storeDefinition.name, "readwrite");
      const store = tx.objectStore(storeDefinition.name);

      for (const record of storeDefinition.records || []) {
        store.put(record);
      }

      await transactionDone(tx);
    }
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function getDatabaseEntries(labels) {
  return [
    {
      key: "slider-cache",
      dbName: "jms-slider-cache",
      title: labels?.sliderCacheDbTitle || "Slider genel önbellek DB",
      description:
        labels?.sliderCacheDbDescription ||
        "Genel slider içerik detayları, sorgu sonuçları ve kısa süreli API önbellek kayıtları burada tutulur.",
      prepare: async () => {
        const mod = await import("../sliderCache.js");
        await mod.prepareSliderCacheDbForDeletion?.();
      }
    },
    {
      key: "recent-rows",
      dbName: "monwui_recent_db",
      title: labels?.recentRowsDbTitle || "Son eklenen ve devam et kartları DB",
      description:
        labels?.recentRowsDbDescription ||
        "Son eklenenler, son bölümler, müzik satırları ve izlemeye devam kartlarında kullanılan önbellek verileri burada tutulur.",
      prepare: async () => {
        const mod = await import("../recentRowsDb.js");
        await mod.prepareRecentRowsDbForDeletion?.();
      }
    },
    {
      key: "director-rows",
      dbName: "jms_dirrows_db",
      title: labels?.directorRowsDbTitle || "Yönetmen kartları DB",
      description:
        labels?.directorRowsDbDescription ||
        "Yönetmen koleksiyon satırlarında kullanılan yönetmen ve içerik eşleşme verileri burada saklanır.",
      prepare: async () => {
        const mod = await import("../dirRowsDb.js");
        await mod.prepareDirRowsDbForDeletion?.();
      }
    },
    {
      key: "personal-recommendations",
      dbName: "jms_prc_db",
      title: labels?.personalRecommendationsDbTitle || "Kişisel öneriler DB",
      description:
        labels?.personalRecommendationsDbDescription ||
        "\"Sana Özel Öneriler\" ve benzeri kişiselleştirilmiş öneri satırlarında kullanılan önbellek verileri burada tutulur.",
      prepare: async () => {
        const mod = await import("../prcDb.js");
        await mod.preparePrcDbForDeletion?.();
      }
    },
    {
      key: "collection-cache",
      dbName: "jms_collection_cache",
      title: labels?.collectionCacheDbTitle || "Koleksiyon kartları DB",
      description:
        labels?.collectionCacheDbDescription ||
        "Boxset ve koleksiyon kartları ile bu koleksiyonların içerik listeleri için tutulan önbellek burada saklanır.",
      prepare: async () => {
        const mod = await import("../collectionCacheDb.js");
        await mod.prepareCollectionCacheDbForDeletion?.();
      }
    },
    {
      key: "gmmp-music",
      dbName: "GMMP-MusicDB",
      title: labels?.gmmpMusicDbTitle || "GMMP müzik DB",
      description:
        labels?.gmmpMusicDbDescription ||
        "GMMP tarafındaki parça arşivi, silinen kayıt geçmişi ve şarkı sözleri bu veritabanında tutulur.",
      prepare: async () => {
        const mod = await import("../player/utils/db.js");
        await mod.prepareMusicDbForDeletion?.();
      }
    }
  ];
}

function createDatabaseAction(entry, labels) {
  const row = document.createElement("div");
  row.className = "db-management-item";

  const info = document.createElement("div");
  info.className = "db-management-item-info";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent = entry.title;

  const description = document.createElement("div");
  description.className = "description-text";
  description.style.marginTop = "4px";
  description.textContent = entry.description;

  const dbName = document.createElement("div");
  dbName.className = "description-text2";
  dbName.style.marginTop = "4px";
  dbName.textContent = `DB: ${entry.dbName}`;

  const status = document.createElement("div");
  status.className = "description-text2";
  status.style.marginTop = "6px";
  status.style.display = "none";

  const actions = document.createElement("div");
  actions.className = "db-management-item-actions";

  const backupButton = document.createElement("button");
  backupButton.type = "button";
  backupButton.className = "db-management-item-button";
  backupButton.style.whiteSpace = "nowrap";

  const restoreButton = document.createElement("button");
  restoreButton.type = "button";
  restoreButton.className = "db-management-item-button";
  restoreButton.style.whiteSpace = "nowrap";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "db-management-item-button";
  deleteButton.style.whiteSpace = "nowrap";

  const restoreInput = document.createElement("input");
  restoreInput.type = "file";
  restoreInput.accept = ".json,application/json";
  restoreInput.style.display = "none";

  function resetButtonLabels() {
    backupButton.textContent = labels?.dbBackupButton || labels?.backupDatabase || "Yedeği İndir";
    restoreButton.textContent = labels?.dbRestoreButton || labels?.restoreDatabase || "Yedeği Geri Yükle";
    deleteButton.textContent = labels?.dbDeleteButton || "Tarayıcıdan Sil";
  }

  function setRowBusy(active) {
    row.dataset.busy = active ? "1" : "0";
    backupButton.disabled = active;
    restoreButton.disabled = active;
    deleteButton.disabled = active;
    restoreInput.disabled = active;
  }

  async function runRowAction(button, busyLabel, action) {
    if (row.dataset.busy === "1") return;

    setRowBusy(true);
    resetButtonLabels();
    button.textContent = busyLabel;

    try {
      await action();
    } finally {
      setRowBusy(false);
      resetButtonLabels();
    }
  }

  backupButton.addEventListener("click", async () => {
    await runRowAction(
      backupButton,
      labels?.dbBackingUpButton || labels?.backupInProgress || "İndiriliyor...",
      async () => {
        setStatus(status, labels?.dbBackupInProgress || "Veritabanı yedeği hazırlanıyor...");

        try {
          const backup = await exportIndexedDatabase(entry.dbName);
          if (!backup) {
            throw new Error(
              labels?.dbBackupMissingDatabase ||
              "Yedeklenecek bir veritabanı bulunamadı. İlgili modülü önce en az bir kez kullanın."
            );
          }

          downloadJsonFile(buildBackupFileName(entry, backup.exportedAt), backup);

          const successText =
            formatLabel(
              labels?.dbBackupSuccessMessage ||
                "Yedek indirildi. {storeCount} depo ve {recordCount} kayıt dışa aktarıldı.",
              {
                storeCount: backup.stores.length,
                recordCount: countBackupRecords(backup)
              }
            );

          setStatus(status, successText);
          showNotification(
            `<i class="fas fa-download" style="margin-right: 8px;"></i> ${successText}`,
            3200,
            "success"
          );
        } catch (error) {
          const errorText =
            String(error?.message || "").trim() ||
            labels?.dbBackupFailed ||
            "Veritabanı yedeklenemedi.";

          setStatus(status, errorText);
          showNotification(
            `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${errorText}`,
            4200,
            "error"
          );
        }
      }
    );
  });

  restoreButton.addEventListener("click", () => {
    if (row.dataset.busy === "1") return;
    restoreInput.click();
  });

  restoreInput.addEventListener("change", async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;

    const confirmMessage = [
      formatLabel(
        labels?.dbRestoreConfirmQuestion ||
          "Seçilen yedekten {name} veritabanını geri yüklemek istiyor musun?",
        { name: entry.title }
      ),
      `${labels?.dbDeleteConfirmDbLabel || "DB"}: ${entry.dbName}`,
      labels?.dbRestoreConfirmOverwriteNote ||
        "Mevcut tarayıcı verisi silinip yedek içeriği ile değiştirilecek."
    ].join("\n\n");

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      event.target.value = "";
      return;
    }

    await runRowAction(
      restoreButton,
      labels?.dbRestoringButton || "Yükleniyor...",
      async () => {
        try {
          const fileContent = await readFileAsText(file);
          const rawBackup = JSON.parse(fileContent);
          const backup = normalizeIndexedDatabaseBackup(rawBackup, entry, labels);

          if (backup.dbName !== entry.dbName) {
            throw new Error(
              formatLabel(
                labels?.dbRestoreWrongDatabase ||
                  "Seçilen yedek {name} veritabanına ait değil.",
                { name: entry.title }
              )
            );
          }

          setStatus(
            status,
            labels?.dbRestorePrepareInProgress ||
              "Açık bağlantılar kapatılıyor ve veritabanı geri yüklemeye hazırlanıyor..."
          );

          await entry.prepare?.();
          await wait(RELEASE_WAIT_MS);
          await deleteIndexedDatabase(entry.dbName);
          await wait(RELEASE_WAIT_MS);

          await restoreIndexedDatabaseBackup(backup, {
            onStatus: (message) => {
              setStatus(status, message || labels?.dbRestoreInProgress || "Yedek geri yükleniyor...");
            }
          });

          const successText =
            formatLabel(
              labels?.dbRestoreSuccessMessage ||
                "Geri yükleme tamamlandı. {storeCount} depo ve {recordCount} kayıt içeri aktarıldı.",
              {
                storeCount: backup.stores.length,
                recordCount: countBackupRecords(backup)
              }
            );

          setStatus(status, successText);
          showNotification(
            `<i class="fas fa-upload" style="margin-right: 8px;"></i> ${successText}`,
            3400,
            "success"
          );
        } catch (error) {
          const errorText =
            String(error?.message || "").trim() ||
            labels?.dbRestoreFailed ||
            "Veritabanı geri yüklenemedi.";

          setStatus(status, errorText);
          showNotification(
            `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${errorText}`,
            5000,
            "error"
          );
        } finally {
          event.target.value = "";
        }
      }
    );
  });

  deleteButton.addEventListener("click", async () => {
    const confirmMessage = [
      formatLabel(
        labels?.dbDeleteConfirmQuestion || "Do you want to delete the {name} database?",
        { name: entry.title }
      ),
      `${labels?.dbDeleteConfirmDbLabel || "DB"}: ${entry.dbName}`,
      labels?.dbDeleteConfirmRecreateNote || "This data will be recreated automatically when needed."
    ].join("\n\n");

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    await runRowAction(
      deleteButton,
      labels?.dbDeletingButton || "Siliniyor...",
      async () => {
        setStatus(
          status,
          labels?.dbDeleteInProgress || "Açık bağlantılar kapatılıyor ve veritabanı siliniyor..."
        );

        try {
          await entry.prepare?.();
          await wait(RELEASE_WAIT_MS);
          await deleteIndexedDatabase(entry.dbName);

          const successText =
            labels?.dbDeleteSuccessMessage ||
            "Silme tamamlandı. İlgili modül bu veritabanını ihtiyaç olduğunda yeniden oluşturur.";
          setStatus(status, successText);

          showNotification(
            `<i class="fas fa-database" style="margin-right: 8px;"></i> ${entry.title} silindi.`,
            3000,
            "success"
          );
        } catch (error) {
          const errorText =
            String(error?.message || "").trim() ||
            labels?.dbDeleteFailed ||
            "Veritabanı silinemedi.";

          setStatus(status, errorText);
          showNotification(
            `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${errorText}`,
            4200,
            "error"
          );
        }
      }
    );
  });

  resetButtonLabels();

  info.append(title, description, dbName, status);
  actions.append(backupButton, restoreButton, deleteButton, restoreInput);
  row.append(info, actions);
  return row;
}

export function createDbManagementPanel(config, labels) {
  const panel = document.createElement("div");
  panel.id = "db-management-panel";
  panel.className = "settings-panel";

  const introSection = createSection(labels?.dbManagementTab || "DB Yönetimi");

  const introText = document.createElement("div");
  introText.className = "description-text";
  introText.textContent =
    labels?.dbManagementDescription ||
    "Buradan tarayıcıdaki IndexedDB veritabanlarını yedekleyebilir, geri yükleyebilir veya silebilirsiniz.";

  const blockedHint = document.createElement("div");
  blockedHint.className = "description-text2";
  blockedHint.style.marginTop = "8px";
  blockedHint.textContent =
    labels?.dbManagementBlockedHint ||
    "İşlem açık bir sekme veya aktif bağlantı yüzünden engellenirse sayfayı yenileyip tekrar deneyin.";

  introSection.append(introText, blockedHint);

  const listSection = createSection(labels?.dbManagementListTitle || "Yönetilebilir Veritabanları");
  getDatabaseEntries(labels).forEach((entry) => {
    listSection.appendChild(createDatabaseAction(entry, labels));
  });

  panel.append(introSection, listSection);
  return panel;
}
