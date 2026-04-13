import { musicPlayerState } from "../core/state.js";
import { buildLyricsRecord, normalizeLyricsPayload } from "../lyrics/normalizer.js";

const GMMP_MUSIC_DB_NAME = "GMMP-MusicDB";

class MusicDB {
  constructor() {
    this.dbName = GMMP_MUSIC_DB_NAME;
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

        if (!store.indexNames.contains("Artists")) {
          store.createIndex("Artists", "Artists", { multiEntry: true });
        }

        if (!store.indexNames.contains("ArtistIds")) {
          store.createIndex("ArtistIds", "ArtistIds", { multiEntry: true });
        }

        if (!store.indexNames.contains("Album")) {
          store.createIndex("Album", "Album");
        }

        if (!store.indexNames.contains("AlbumArtist")) {
          store.createIndex("AlbumArtist", "AlbumArtist");
        }

        if (!store.indexNames.contains("DateCreated")) {
          store.createIndex("DateCreated", "DateCreated");
        }

        if (!store.indexNames.contains("LastUpdated")) {
          store.createIndex("LastUpdated", "LastUpdated");
        }

        if (!db.objectStoreNames.contains(this.deletedStoreName)) {
          const deletedStore = db.createObjectStore(this.deletedStoreName, {
            keyPath: "id",
            autoIncrement: true,
          });
          deletedStore.createIndex("trackId", "trackId");
          deletedStore.createIndex("deletedAt", "deletedAt");
        }

        if (!db.objectStoreNames.contains(this.lyricsStoreName)) {
          db.createObjectStore(this.lyricsStoreName, { keyPath: "trackId" });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => {
          try {
            this.db?.close();
          } catch {}
          this.db = null;
        };
        resolve(this.db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  async openDB() {
    return this.open();
  }

  async init() {
    return this.open();
  }

  async ready() {
    return this.open();
  }

  async close() {
    try {
      this.db?.close?.();
    } catch {}
    this.db = null;
  }

  _tx(store, mode = "readonly") {
    return this.db.transaction(store, mode).objectStore(store);
  }

  _awaitTransaction(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    });
  }

  _toMillis(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  _trackSortValue(track) {
    return (
      this._toMillis(track?.DateCreated) ||
      this._toMillis(track?.PremiereDate) ||
      this._toMillis(track?.LastUpdated)
    );
  }

  async _ensure() {
    if (!this.db) await this.open();
  }

  async _getTrackById(trackId) {
    await this._ensure();
    return new Promise((resolve) => {
      const req = this._tx(this.storeName).get(trackId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async addOrUpdateTracks(tracks = []) {
    if (!Array.isArray(tracks) || !tracks.length) return;
    await this._ensure();

    const tx = this.db.transaction([this.storeName], "readwrite");
    const store = tx.objectStore(this.storeName);
    const now = Date.now();

    for (const sourceTrack of tracks) {
      if (!sourceTrack?.Id) continue;

      const track = { ...sourceTrack, LastUpdated: now };
      if (!track.ArtistIds && Array.isArray(track.ArtistItems)) {
        track.ArtistIds = track.ArtistItems.map((artist) => artist?.Id).filter(Boolean);
      }

      store.put(track);
    }

    await this._awaitTransaction(tx);
  }

  async saveTracks(tracks = []) {
    await this.deleteAllTracks();
    if (Array.isArray(tracks) && tracks.length) {
      await this.saveTracksInBatches(tracks);
    }
  }

  async saveTracksInBatches(tracks = [], batchSize = 500) {
    if (!Array.isArray(tracks) || !tracks.length) return;

    const size = Math.max(1, Number(batchSize) || 500);
    for (let start = 0; start < tracks.length; start += size) {
      await this.addOrUpdateTracks(tracks.slice(start, start + size));
    }
  }

  async getAllTracks() {
    await this._ensure();
    return new Promise((resolve, reject) => {
      const req = this._tx(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteAllTracks() {
    await this._ensure();
    const tx = this.db.transaction([this.storeName], "readwrite");
    tx.objectStore(this.storeName).clear();
    await this._awaitTransaction(tx);
  }

  async deleteTracks(ids = []) {
    if (!Array.isArray(ids) || !ids.length) return;
    await this._ensure();

    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const storedTracks = await Promise.all(
      uniqueIds.map(async (trackId) => [trackId, await this._getTrackById(trackId)])
    );
    const trackMap = new Map(storedTracks);

    const tx = this.db.transaction(
      [this.storeName, this.deletedStoreName],
      "readwrite"
    );
    const store = tx.objectStore(this.storeName);
    const deletedStore = tx.objectStore(this.deletedStoreName);

    uniqueIds.forEach((trackId) => {
      const trackData = trackMap.get(trackId);
      store.delete(trackId);
      deletedStore.put({
        trackId,
        deletedAt: new Date().toISOString(),
        trackData: trackData || {
          Id: trackId,
          Name: "Bilinmeyen Parca",
          Artists: [],
          AlbumArtist: "",
        },
      });
    });

    await this._awaitTransaction(tx);
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

  async getStats(recentLimit = null) {
    const tracks = await this.getAllTracks();
    const albums = new Set();
    const artists = new Set();

    tracks.forEach((track) => {
      if (track?.Album) albums.add(track.Album);

      if (Array.isArray(track?.Artists)) {
        track.Artists.forEach((artist) => {
          if (artist) artists.add(artist);
        });
      }

      if (track?.AlbumArtist) {
        artists.add(track.AlbumArtist);
      }

      if (Array.isArray(track?.ArtistItems)) {
        track.ArtistItems.forEach((artist) => {
          if (artist?.Name) artists.add(artist.Name);
        });
      }
    });

    const sortedTracks = tracks
      .slice()
      .sort((a, b) => this._trackSortValue(b) - this._trackSortValue(a));

    return {
      totalTracks: tracks.length,
      totalAlbums: albums.size,
      totalArtists: artists.size,
      recentlyAdded: Number.isFinite(recentLimit)
        ? sortedTracks.slice(0, recentLimit)
        : sortedTracks,
    };
  }

  async getRecentlyDeleted(limit = null) {
    await this._ensure();
    return new Promise((resolve, reject) => {
      const req = this._tx(this.deletedStoreName).getAll();
      req.onsuccess = () => {
        const entries = (req.result || [])
          .map((entry) => ({
            ...entry,
            trackData: entry?.trackData || {
              Id: entry?.trackId,
              Name: "Bilinmeyen Parca",
              Artists: [],
              AlbumArtist: "",
              DateCreated: entry?.deletedAt || null,
            },
          }))
          .sort((a, b) => this._toMillis(b?.deletedAt) - this._toMillis(a?.deletedAt));

        resolve(Number.isFinite(limit) ? entries.slice(0, limit) : entries);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveLyrics(trackId, data) {
    await this._ensure();
    const record = buildLyricsRecord(trackId, data);
    if (!record) return;

    return new Promise((resolve, reject) => {
      const req = this._tx(this.lyricsStoreName, "readwrite").put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getLyrics(trackId) {
    await this._ensure();
    return new Promise((resolve) => {
      const req = this._tx(this.lyricsStoreName).get(trackId);
      req.onsuccess = () => resolve(normalizeLyricsPayload(req.result) || null);
      req.onerror = () => resolve(null);
    });
  }

  async deleteLyrics(trackId) {
    if (!trackId) return;
    await this._ensure();
    return new Promise((resolve, reject) => {
      const req = this._tx(this.lyricsStoreName, "readwrite").delete(trackId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAllLyrics() {
    await this._ensure();
    return new Promise((resolve, reject) => {
      const req = this._tx(this.lyricsStoreName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getLyricsCount() {
    await this._ensure();
    return new Promise((resolve, reject) => {
      const req = this._tx(this.lyricsStoreName).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
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

export async function prepareMusicDbForDeletion() {
  await musicDB.close();
  try {
    musicPlayerState.lyricsCache = {};
  } catch {}
}
