const API_ROOT = "/JMSFusion/parental-pin";
const POLICY_CACHE_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MINUTES = 15;
const DEFAULT_TRUST_MINUTES = 60;

let policyCache = {
  authKey: "",
  value: null,
  ts: 0,
  promise: null
};

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function pick(payload, ...keys) {
  for (const key of keys) {
    if (payload && payload[key] !== undefined) return payload[key];
  }
  return undefined;
}

function normalizeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") return null;

  const userId = String(pick(rule, "userId", "UserId") || "").trim();
  if (!userId) return null;

  return {
    userId,
    userName: String(pick(rule, "userName", "UserName") || "").trim(),
    ratingThreshold: Number(pick(rule, "ratingThreshold", "RatingThreshold") || 0),
    requireUnratedPin: pick(rule, "requireUnratedPin", "RequireUnratedPin") === true,
    updatedAtUtc: Number(pick(rule, "updatedAtUtc", "UpdatedAtUtc") || 0)
  };
}

function normalizeUser(user) {
  if (!user || typeof user !== "object") return null;

  const userId = String(pick(user, "userId", "UserId") || "").trim();
  if (!userId) return null;

  return {
    userId,
    userName: String(pick(user, "userName", "UserName") || "").trim(),
    isAdmin: pick(user, "isAdmin", "IsAdmin") === true,
  };
}

function normalizeLockState(entry) {
  if (!entry || typeof entry !== "object") return null;

  const userId = String(pick(entry, "userId", "UserId") || "").trim();
  if (!userId) return null;

  return {
    userId,
    userName: String(pick(entry, "userName", "UserName") || "").trim(),
    lockedUntilUtc: Math.max(0, normalizeInt(pick(entry, "lockedUntilUtc", "LockedUntilUtc"), 0)),
    remainingMinutes: Math.max(0, normalizeInt(pick(entry, "remainingMinutes", "RemainingMinutes"), 0))
  };
}

function normalizeSecurityState(data = {}) {
  const lockedUntilUtc = Math.max(0, normalizeInt(pick(data, "lockedUntilUtc", "LockedUntilUtc"), 0));
  const trustedUntilUtc = Math.max(0, normalizeInt(pick(data, "trustedUntilUtc", "TrustedUntilUtc"), 0));

  return {
    maxAttempts: Math.max(1, normalizeInt(pick(data, "maxAttempts", "MaxAttempts"), DEFAULT_MAX_ATTEMPTS)),
    lockoutMinutes: Math.max(1, normalizeInt(pick(data, "lockoutMinutes", "LockoutMinutes"), DEFAULT_LOCKOUT_MINUTES)),
    trustMinutes: Math.max(0, normalizeInt(pick(data, "trustMinutes", "TrustMinutes"), DEFAULT_TRUST_MINUTES)),
    remainingAttempts: Math.max(0, normalizeInt(pick(data, "remainingAttempts", "RemainingAttempts"), DEFAULT_MAX_ATTEMPTS)),
    lockedUntilUtc,
    trustedUntilUtc,
    isLocked: pick(data, "isLocked", "IsLocked") === true && lockedUntilUtc > Date.now(),
    isTrusted: pick(data, "isTrusted", "IsTrusted") === true && trustedUntilUtc > Date.now(),
  };
}

function normalizeSettingsResponse(data) {
  const usersRaw = pick(data, "users", "Users");
  const rulesRaw = pick(data, "rules", "Rules");
  const thresholdsRaw = pick(data, "thresholds", "Thresholds");
  const lockStatesRaw = pick(data, "lockStates", "LockStates");

  return {
    ...data,
    ok: pick(data, "ok", "Ok") !== false,
    hasPin: pick(data, "hasPin", "HasPin") === true,
    revision: normalizeInt(pick(data, "revision", "Revision"), 0),
    thresholds: Array.isArray(thresholdsRaw)
      ? thresholdsRaw.map((value) => Number(value)).filter(Number.isFinite)
      : [],
    users: Array.isArray(usersRaw) ? usersRaw.map(normalizeUser).filter(Boolean) : [],
    rules: Array.isArray(rulesRaw) ? rulesRaw.map(normalizeRule).filter(Boolean) : [],
    lockStates: Array.isArray(lockStatesRaw) ? lockStatesRaw.map(normalizeLockState).filter(Boolean) : [],
    maxAttempts: Math.max(1, normalizeInt(pick(data, "maxAttempts", "MaxAttempts"), DEFAULT_MAX_ATTEMPTS)),
    lockoutMinutes: Math.max(1, normalizeInt(pick(data, "lockoutMinutes", "LockoutMinutes"), DEFAULT_LOCKOUT_MINUTES)),
    trustMinutes: Math.max(0, normalizeInt(pick(data, "trustMinutes", "TrustMinutes"), DEFAULT_TRUST_MINUTES)),
  };
}

function normalizePolicyResponse(data) {
  return {
    ...data,
    ok: pick(data, "ok", "Ok") !== false,
    hasPin: pick(data, "hasPin", "HasPin") === true,
    revision: normalizeInt(pick(data, "revision", "Revision"), 0),
    rule: normalizeRule(pick(data, "rule", "Rule")),
    ...normalizeSecurityState(data),
  };
}

function normalizeVerifyResponse(data) {
  return {
    ...data,
    ok: pick(data, "ok", "Ok") !== false,
    valid: pick(data, "valid", "Valid") === true,
    code: String(pick(data, "code", "Code") || "").trim(),
    ...normalizeSecurityState(data),
  };
}

function getApiClientSafe() {
  try {
    return window.ApiClient || window.apiClient || null;
  } catch {
    return null;
  }
}

function getTokenSafe() {
  const api = getApiClientSafe();
  let storageToken = "";
  try {
    storageToken = pickFirstString(
      sessionStorage.getItem("accessToken"),
      localStorage.getItem("accessToken"),
      sessionStorage.getItem("embyToken"),
      localStorage.getItem("embyToken")
    );
  } catch {}

  try {
    return pickFirstString(
      typeof api?.accessToken === "function" ? api.accessToken() : "",
      api?._serverInfo?.AccessToken,
      api?._accessToken,
      api?._authToken,
      storageToken
    );
  } catch {
    return storageToken;
  }
}

function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function readCredentialUserIdFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";

  const directUserId = pickFirstString(
    payload?.UserId,
    payload?.userId,
    payload?.User?.Id,
    payload?.user?.Id
  );
  if (directUserId) {
    return directUserId;
  }

  const servers = Array.isArray(payload?.Servers) ? payload.Servers : [];
  if (!servers.length) return "";

  const api = getApiClientSafe();
  const serverId = pickFirstString(
    api?._serverInfo?.SystemId,
    api?._serverInfo?.Id,
    sessionStorage.getItem("serverId"),
    localStorage.getItem("serverId"),
    sessionStorage.getItem("persist_server_id"),
    localStorage.getItem("persist_server_id")
  );
  const serverBase = pickFirstString(
    typeof api?.serverAddress === "function" ? api.serverAddress() : "",
    localStorage.getItem("jf_serverAddress"),
    sessionStorage.getItem("jf_serverAddress")
  );

  const matchedServer = servers.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (serverId) {
      return pickFirstString(entry?.Id, entry?.SystemId) === serverId;
    }

    const entryBases = [
      normalizeBase(entry?.ManualAddress),
      normalizeBase(entry?.LocalAddress)
    ].filter(Boolean);

    return !!serverBase && entryBases.includes(normalizeBase(serverBase));
  });

  return pickFirstString(
    matchedServer?.UserId,
    servers[0]?.UserId
  );
}

function getLiveUserIdSafe() {
  const api = getApiClientSafe();
  try {
    return pickFirstString(
      typeof api?.getCurrentUserId === "function" ? api.getCurrentUserId() : "",
      api?._currentUserId,
      api?._currentUser?.Id,
      api?._serverInfo?.UserId
    );
  } catch {
    return "";
  }
}

async function getUserIdSafe() {
  const liveUserId = getLiveUserIdSafe();
  if (liveUserId) return liveUserId;

  try {
    const user = await getApiClientSafe()?.getCurrentUser?.();
    const resolvedUserId = pickFirstString(user?.Id, user?.UserId);
    if (resolvedUserId) return resolvedUserId;
  } catch {}

  try {
    return pickFirstString(
      sessionStorage.getItem("userId"),
      localStorage.getItem("userId"),
      sessionStorage.getItem("jf_userId"),
      localStorage.getItem("jf_userId"),
      sessionStorage.getItem("persist_user_id"),
      localStorage.getItem("persist_user_id"),
      readCredentialUserIdFromPayload(readStoredJson("json-credentials")),
      readCredentialUserIdFromPayload(readStoredJson("jellyfin_credentials")),
      readCredentialUserIdFromPayload(readStoredJson("emby_credentials"))
    );
  } catch {
    return "";
  }
}

async function getAuthContext() {
  const [userId, token] = await Promise.all([
    getUserIdSafe(),
    Promise.resolve(getTokenSafe())
  ]);

  return {
    userId: String(userId || "").trim(),
    token: String(token || "").trim()
  };
}

async function getAuthHeaders() {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const { userId, token } = await getAuthContext();
  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;
  return headers;
}

async function request(path, { method = "GET", body } = {}) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    cache: "no-store",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text ? { error: text } : {};
  }

  if (!response.ok) {
    const message = data?.error || data?.message || text || `HTTP ${response.status}`;
    const error = new Error(String(message));
    error.code = String(data?.code || data?.Code || "").trim();
    error.response = data;
    throw error;
  }

  return data;
}

export async function fetchParentalPinSettings() {
  const data = await request("/settings");
  return normalizeSettingsResponse(data);
}

export async function saveParentalPinSettings(payload = {}) {
  const data = await request("/settings", {
    method: "POST",
    body: payload || {}
  });
  invalidateParentalPinPolicyCache();
  return normalizeSettingsResponse(data);
}

export async function unlockParentalPinUser(userId) {
  const data = await request("/unlock", {
    method: "POST",
    body: { userId }
  });
  invalidateParentalPinPolicyCache();
  return normalizeSettingsResponse(data);
}

export async function fetchCurrentUserParentalPinPolicy({ force = false } = {}) {
  const { userId, token } = await getAuthContext();
  const authKey = `${userId}::${token ? token.slice(-16) : ""}`;
  const now = Date.now();
  const cachedExpired =
    policyCache.value &&
    (
      (Number(policyCache.value.lockedUntilUtc || 0) > 0 && Number(policyCache.value.lockedUntilUtc || 0) <= now)
      || (Number(policyCache.value.trustedUntilUtc || 0) > 0 && Number(policyCache.value.trustedUntilUtc || 0) <= now)
    );

  if (
    !force &&
    policyCache.value &&
    policyCache.authKey === authKey &&
    !cachedExpired &&
    (now - policyCache.ts) < POLICY_CACHE_MS
  ) {
    return policyCache.value;
  }

  if (!force && policyCache.promise && policyCache.authKey === authKey) {
    return policyCache.promise;
  }

  policyCache.authKey = authKey;
  policyCache.promise = request("/policy")
    .then((data) => {
      policyCache.value = normalizePolicyResponse(data);
      policyCache.ts = Date.now();
      return policyCache.value;
    })
    .finally(() => {
      policyCache.promise = null;
    });

  return policyCache.promise;
}

export async function verifyParentalPin(pin) {
  const data = await request("/verify", {
    method: "POST",
    body: { pin }
  });
  const normalized = normalizeVerifyResponse(data);
  invalidateParentalPinPolicyCache();
  return normalized;
}

export function getParentalPinErrorMessage(error, labels = {}, fallback = "") {
  const code = String(error?.code || error?.response?.code || "").trim();

  switch (code) {
    case "parental_pin_admin_required":
      return labels.parentalPinAdminOnly || "This action is only available to administrators.";
    case "parental_pin_user_required":
      return labels.parentalPinUserHeaderRequired || "The user header is missing.";
    case "parental_pin_user_not_found":
      return labels.parentalPinUserNotFound || "The user could not be found.";
    case "parental_pin_pin_required":
      return labels.parentalPinPinRequired || "Set a PIN before assigning rules.";
    case "parental_pin_invalid_format":
      return labels.parentalPinInvalidFormat || "PIN must be 4 to 8 digits.";
    case "parental_pin_unlock_user_required":
      return labels.parentalPinUnlockUserRequired || "Select a user to unlock.";
    case "parental_pin_unlock_user_not_found":
      return labels.parentalPinUnlockUserNotFound || "The locked user could not be found.";
    default:
      return error?.message || fallback || labels.parentalPinGenericError || "Request failed.";
  }
}

export function invalidateParentalPinPolicyCache() {
  policyCache = {
    authKey: "",
    value: null,
    ts: 0,
    promise: null
  };
}

if (typeof window !== "undefined" && !window.__jmsParentalPinPolicyCacheBound) {
  window.__jmsParentalPinPolicyCacheBound = true;
  window.addEventListener("storage", (event) => {
    if ([
      "userId",
      "jf_userId",
      "persist_user_id",
      "accessToken",
      "embyToken",
      "json-credentials",
      "jellyfin_credentials",
      "emby_credentials"
    ].includes(String(event?.key || ""))) {
      invalidateParentalPinPolicyCache();
    }
  });
  if (typeof document !== "undefined") {
    document.addEventListener("jms:auth-profile-changed", invalidateParentalPinPolicyCache);
  }
}
