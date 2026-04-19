const JSON_PREFIX = "Stored JSON credentials:";

export function getStoredServerBase() {
  try {
    const raw =
      localStorage.getItem("jf_serverAddress") ||
      sessionStorage.getItem("jf_serverAddress") ||
      "";
    if (!raw || typeof raw !== "string") return "";
    return raw.trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeServerBase(s) {
  if (!s || typeof s !== "string") return "";
  return s.trim().replace(/\/+$/, "");
}

function isLikelyGuidOrHex32(id) {
  if (typeof id !== "string") return false;
  const s = id.trim();
  const guid = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const hex32 = /^[0-9a-f]{32}$/i;
  return guid.test(s) || hex32.test(s);
}

function chooseServerFromServersList(credentials) {
  const servers = Array.isArray(credentials?.Servers) ? credentials.Servers : [];
  if (!servers.length) return { id: null, why: "no Servers[]" };

  let activeBase = "";
  try {
    const ac = window.ApiClient || window.apiClient || null;
    const apiBase =
      (ac && typeof ac.serverAddress === "function" ? ac.serverAddress()
      : (ac && typeof ac.serverAddress === "string" ? ac.serverAddress : "")) || "";
    activeBase = normalizeServerBase(apiBase);
  } catch {}

  if (!activeBase) {
    activeBase = normalizeServerBase(credentials?.Servers?.[0]?.ManualAddress || credentials?.Servers?.[0]?.LocalAddress || "");
  }

  if (!activeBase) {
    try {
      activeBase = normalizeServerBase(
        localStorage.getItem("jf_serverAddress") || sessionStorage.getItem("jf_serverAddress") || ""
      );
    } catch {}
  }

  if (activeBase) {
    const match = servers.find(s => {
      const m = normalizeServerBase(s?.ManualAddress || "");
      const l = normalizeServerBase(s?.LocalAddress || "");
      return m === activeBase || l === activeBase;
    });
    if (match?.Id && isLikelyGuidOrHex32(String(match.Id))) {
      return { id: String(match.Id), why: `Servers[] address match (${activeBase})` };
    }
    if (match?.SystemId && isLikelyGuidOrHex32(String(match.SystemId))) {
      return { id: String(match.SystemId), why: `Servers[] address match SystemId (${activeBase})` };
    }
  }

  const firstGood = servers.find(s => isLikelyGuidOrHex32(String(s?.Id || "")) || isLikelyGuidOrHex32(String(s?.SystemId || "")));
  if (firstGood?.Id && isLikelyGuidOrHex32(String(firstGood.Id))) {
    return { id: String(firstGood.Id), why: "Servers[] first good Id" };
  }
  if (firstGood?.SystemId && isLikelyGuidOrHex32(String(firstGood.SystemId))) {
    return { id: String(firstGood.SystemId), why: "Servers[] first good SystemId" };
  }

  return { id: null, why: "Servers[] had no good ids" };
}

function pickBestServerId(credentials) {
  try {
    const ac = window.ApiClient || window.apiClient || null;
    const apiId = ac?._serverInfo?.SystemId || ac?._serverInfo?.Id || null;
    if (apiId && isLikelyGuidOrHex32(String(apiId))) {
      return { id: String(apiId), why: "ApiClient._serverInfo" };
    }
  } catch {}

  const fromServers = chooseServerFromServersList(credentials);
  if (fromServers.id) return fromServers;

  const fallback =
    credentials?.SystemId ||
    credentials?.ServerId ||
    null;

  if (fallback && isLikelyGuidOrHex32(String(fallback))) {
    return { id: String(fallback), why: "top-level fallback" };
  }

  return { id: null, why: "no serverId found" };
}

function safeParseJson(raw) {
  try {
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStoredCredentialsObject() {
  try {
    return (
      safeParseJson(sessionStorage.getItem("json-credentials")) ||
      safeParseJson(localStorage.getItem("json-credentials")) ||
      null
    );
  } catch { return null; }
}

function findActiveServerEntry(credentials, chosenServerId) {
  try {
    const servers = Array.isArray(credentials?.Servers) ? credentials.Servers : [];
    if (!servers.length) return null;
    const sid = String(chosenServerId || "").trim();
    if (!sid) return null;

    const hit = servers.find(s =>
      String(s?.Id || "").trim() === sid ||
      String(s?.SystemId || "").trim() === sid
    );
    return hit || null;
  } catch {
    return null;
  }
}

export function saveCredentials(credentials) {
  try {
    credentials = credentials ? JSON.parse(JSON.stringify(credentials)) : {};
    const raw = JSON.stringify(credentials);
    sessionStorage.setItem("json-credentials", raw);
    localStorage.setItem("json-credentials", raw);

    if (credentials?.AccessToken) {
      sessionStorage.setItem("accessToken", credentials.AccessToken);
      localStorage.setItem("accessToken", credentials.AccessToken);
    }

    const chosen = pickBestServerId(credentials);
    if (chosen.id) {
      sessionStorage.setItem("serverId", chosen.id);
      localStorage.setItem("serverId", chosen.id);
      console.log("✅ serverId seçildi:", chosen.id, "| kaynak:", chosen.why);
      const active = findActiveServerEntry(credentials, chosen.id);
      const activeUserId = active?.UserId ? String(active.UserId) : "";
      const activeToken  = active?.AccessToken ? String(active.AccessToken) : "";

      if (activeUserId) {
        sessionStorage.setItem("userId", activeUserId);
        localStorage.setItem("userId", activeUserId);
        if (!credentials.User || typeof credentials.User !== "object") credentials.User = {};
        credentials.User.Id = activeUserId;
      }

      if (activeToken) {
        credentials.AccessToken = activeToken;
        sessionStorage.setItem("accessToken", activeToken);
        localStorage.setItem("accessToken", activeToken);
      }

      try {
        const normalizedRaw = JSON.stringify(credentials);
        sessionStorage.setItem("json-credentials", normalizedRaw);
        localStorage.setItem("json-credentials", normalizedRaw);
      } catch {}

    } else {
      console.warn("⚠️ serverId seçilemedi:", chosen.why, credentials);
    }
    console.log("Kimlik bilgileri kaydedildi.");
  } catch (err) {
    console.error("Kimlik bilgileri kaydedilirken hata:", err);
  }
}

export function getWebClientHints() {
  const hints = {};
  try {
    const ac = window.ApiClient || window.apiClient || null;
    if (ac) {
      hints.userId =
        (typeof ac.getCurrentUserId === "function" ? ac.getCurrentUserId() : ac._currentUserId) || null;
      hints.sessionId =
        ac._sessionId || ac.sessionId || ac?.connectionManager?._session?.Id || null;
      hints.deviceId =
        ac._deviceId || (typeof ac.deviceId === "function" ? ac.deviceId() : ac.deviceId) || null;
      hints.deviceName =
        ac._deviceName ||
        (typeof ac.getDeviceName === "function" ? ac.getDeviceName() : ac.deviceName) ||
        null;
      hints.accessToken =
        ac._authToken ||
        (typeof ac.accessToken === "function" ? ac.accessToken() : ac.accessToken) ||
        ac?._serverInfo?.AccessToken ||
        null;
      hints.clientName = ac._appName || ac.name || "Jellyfin Web";
      hints.clientVersion = ac._appVersion || ac.appVersion || "1.0.0";
      hints.serverId =
        ac?._serverInfo?.SystemId ||
        ac?._serverInfo?.Id ||
        null;
    }
  } catch {}

  try {
    const lsDeviceId =
      localStorage.getItem("deviceId") ||
      localStorage.getItem("emby.device.id") ||
      null;
    if (!hints.deviceId && lsDeviceId) hints.deviceId = lsDeviceId;

    const lsSessionId =
      localStorage.getItem("sessionId") ||
      localStorage.getItem("emby.session.id") ||
      null;
    if (!hints.sessionId && lsSessionId) hints.sessionId = lsSessionId;
    const lsServerId =
      localStorage.getItem("serverId") ||
      localStorage.getItem("emby.server.id") ||
      null;
    if (!hints.serverId && lsServerId) hints.serverId = lsServerId;
  } catch {}

  return hints;
}

export function saveApiKey(apiKey) {
  try {
    sessionStorage.setItem("api-key", apiKey);
    localStorage.setItem("api-key", apiKey);
    sessionStorage.setItem("accessToken", apiKey);
    localStorage.setItem("accessToken", apiKey);
    try {
      const storedCreds = getStoredCredentialsObject();
      const chosen =
        pickBestServerId(storedCreds || {}) ||
        { id: null, why: "picker returned null" };

      if (chosen?.id) {
        sessionStorage.setItem("serverId", chosen.id);
        localStorage.setItem("serverId", chosen.id);
        console.log("✅ serverId (saveApiKey) seçildi:", chosen.id, "| kaynak:", chosen.why);
      } else {
        const ac = window.ApiClient || window.apiClient || null;
        const apiId = ac?._serverInfo?.SystemId || ac?._serverInfo?.Id || null;
        if (apiId) {
          sessionStorage.setItem("serverId", String(apiId));
          localStorage.setItem("serverId", String(apiId));
          console.log("✅ serverId (saveApiKey) ApiClient fallback:", String(apiId));
        }
      }
    } catch (e) {
      console.warn("⚠️ saveApiKey serverId set edilemedi:", e);
    }
    console.log("API anahtarı kaydedildi.");
  } catch (err) {
    console.error("API anahtarı kaydedilirken hata:", err);
  }
}

function clearCredentials() {
  ["json-credentials","api-key","accessToken","serverId","userId"].forEach(k => {
    try {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    } catch {}
  });

  try {
    const ac = window.ApiClient || window.apiClient || null;
    if (ac) {
      ac._authToken      = null;
      ac._accessToken    = null;
      ac._currentUserId  = null;
      ac._serverInfo     = null;
      if (ac.connectionManager?._session) {
        ac.connectionManager._session = null;
      }
    }
  } catch {}

  console.log("Tüm kimlik bilgileri (storage + ApiClient) temizlendi.");
}

export function getAuthToken() {
  return (
    sessionStorage.getItem("api-key") ||
    localStorage.getItem("api-key") ||
    sessionStorage.getItem("accessToken") ||
    localStorage.getItem("accessToken") ||
    new URLSearchParams(window.location.search).get("api_key") ||
    (window.ApiClient && window.ApiClient._authToken) ||
    null
  );
}

(function interceptConsoleLog() {
  const orig = console.log;
  console.log = function(...args) {
    const hasWsError = args.some(arg =>
      typeof arg === "string" &&
      (arg.includes("WebSocket connection") || arg.includes("websocket") || arg.includes("socket"))
    );

    if (!hasWsError) {
      args.forEach(arg => {
        if (typeof arg === "string" && arg.startsWith(JSON_PREFIX)) {
          try {
            const cred = JSON.parse(arg.slice(JSON_PREFIX.length).trim());
            clearCredentials();
            saveCredentials(cred);
          } catch {}
        }
        else if (arg && typeof arg === "object" && arg.AccessToken && arg.SessionId && arg.User) {
          clearCredentials();
          saveCredentials(arg);
        }
      });
    }
    orig.apply(console, args);
  };
})();

async function onLoginSubmit(credentials) {
  const response = await authenticateUser(username, password);
  saveCredentials(response);
  saveApiKey(response.AccessToken);
  initApp();
}

export {
  clearCredentials,
};
