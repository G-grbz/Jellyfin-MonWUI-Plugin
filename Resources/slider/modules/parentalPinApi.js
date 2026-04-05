const API_ROOT = "/JMSFusion/parental-pin";
const POLICY_CACHE_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MINUTES = 15;
const DEFAULT_TRUST_MINUTES = 60;

let policyCache = {
  userId: "",
  value: null,
  ts: 0,
  promise: null
};

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

function getTokenSafe() {
  try {
    return window.ApiClient?.accessToken?.() || window.ApiClient?._accessToken || "";
  } catch {
    return "";
  }
}

async function getUserIdSafe() {
  try {
    const user = await window.ApiClient?.getCurrentUser?.();
    return user?.Id || "";
  } catch {
    return "";
  }
}

async function getAuthHeaders() {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const token = getTokenSafe();
  const userId = await getUserIdSafe();
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
  const userId = await getUserIdSafe();
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
    policyCache.userId === userId &&
    !cachedExpired &&
    (now - policyCache.ts) < POLICY_CACHE_MS
  ) {
    return policyCache.value;
  }

  if (!force && policyCache.promise && policyCache.userId === userId) {
    return policyCache.promise;
  }

  policyCache.userId = userId;
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
    userId: "",
    value: null,
    ts: 0,
    promise: null
  };
}
