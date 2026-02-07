import { musicPlayerState } from "../core/state.js";

class MusicDB {
  constructor() {
    this.dbName = "GMMP-MusicDB";
    this.dbVersion = 2;
    this.storeName = "tracks";
    this.deletedStoreName = "deletedTracks";
    this.lyricsStoreName = "lyrics";
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        let store;

        if (!db.objectStoreNames.contains(this.storeName)) {
          store = db.createObjectStore(this.storeName, { keyPath: "Id" });
        } else {
          store = e.currentTarget.transaction.objectStore(this.storeName);
        }

        if (!store.indexNames.contains("Artists"))
          store.createIndex("Artists", "Artists", { multiEntry: true });

        if (!store.indexNames.contains("ArtistIds"))
          store.createIndex("ArtistIds", "ArtistIds", { multiEntry: true });

        if (!store.indexNames.contains("Album"))
          store.createIndex("Album", "Album");

        if (!store.indexNames.contains("AlbumArtist"))
          store.createIndex("AlbumArtist", "AlbumArtist");

        if (!store.indexNames.contains("DateCreated"))
          store.createIndex("DateCreated", "DateCreated");

        if (!store.indexNames.contains("LastUpdated"))
          store.createIndex("LastUpdated", "LastUpdated");

        if (!db.objectStoreNames.contains(this.deletedStoreName)) {
          const del = db.createObjectStore(this.deletedStoreName, {
            keyPath: "id",
            autoIncrement: true,
          });
          del.createIndex("trackId", "trackId");
          del.createIndex("deletedAt", "deletedAt");
        }

        if (!db.objectStoreNames.contains(this.lyricsStoreName)) {
          db.createObjectStore(this.lyricsStoreName, { keyPath: "trackId" });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  _tx(store, mode = "readonly") {
    return this.db.transaction(store, mode).objectStore(store);
  }

  async _ensure() {
    if (!this.db) await this.open();
  }

  async addOrUpdateTracks(tracks = []) {
    if (!tracks.length) return;
    await this._ensure();

    const tx = this.db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    const now = Date.now();

    for (const t of tracks) {
      if (!t?.Id) continue;
      t.LastUpdated = now;

      if (!t.ArtistIds && Array.isArray(t.ArtistItems)) {
        t.ArtistIds = t.ArtistItems.map(a => a.Id).filter(Boolean);
      }

      store.put(t);
    }

    return tx.complete;
  }

  async getAllTracks() {
    await this._ensure();
    return new Promise((resolve, reject) => {
      const req = this._tx(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteTracks(ids = []) {
    if (!ids.length) return;
    await this._ensure();

    const tx = this.db.transaction(
      [this.storeName, this.deletedStoreName],
      "readwrite"
    );
    const store = tx.objectStore(this.storeName);
    const delStore = tx.objectStore(this.deletedStoreName);
    const now = Date.now();

    ids.forEach(id => {
      store.delete(id);
      delStore.add({ trackId: id, deletedAt: now });
    });

    return tx.complete;
  }

  async getTracksByArtist(value, useId = false) {
    await this._ensure();
    const indexName = useId ? "ArtistIds" : "Artists";

    return new Promise((resolve) => {
      const store = this._tx(this.storeName);
      if (!store.indexNames.contains(indexName)) return resolve([]);

      const req = store.index(indexName).getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async saveLyrics(trackId, data) {
    await this._ensure();
    return new Promise((resolve, reject) => {
      const req = this._tx(this.lyricsStoreName, "readwrite").put({
        trackId,
        ...data,
      });
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  }

  async getLyrics(trackId) {
    await this._ensure();
    return new Promise((resolve) => {
      const req = this._tx(this.lyricsStoreName).get(trackId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async saveCustomLyrics(trackId, lyricsText) {
    const lyricsData = {
      text: lyricsText,
      source: "user",
      addedAt: new Date().toISOString(),
    };

    await this.saveLyrics(trackId, lyricsData);

    if (musicPlayerState.currentTrack?.Id === trackId) {
      musicPlayerState.lyricsCache[trackId] = lyricsData;

      try {
        window.dispatchEvent(
          new CustomEvent("gmmp:lyrics-updated", {
            detail: { trackId, lyricsText, lyricsData },
          })
        );
      } catch {}
    }
  }
}

export const musicDB = new MusicDB();
