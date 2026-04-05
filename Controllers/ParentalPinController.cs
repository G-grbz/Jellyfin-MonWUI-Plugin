using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

[ApiController]
[Route("JMSFusion/parental-pin")]
[Route("Plugins/JMSFusion/parental-pin")]
public class ParentalPinController : ControllerBase
{
    private const int DefaultMaxAttempts = 5;
    private const int DefaultLockoutMinutes = 15;
    private const int DefaultTrustMinutes = 60;
    private const int MinMaxAttempts = 1;
    private const int MaxMaxAttempts = 20;
    private const int MinLockoutMinutes = 1;
    private const int MaxLockoutMinutes = 1440;
    private const int MinTrustMinutes = 0;
    private const int MaxTrustMinutes = 1440;
    private static readonly int[] AllowedThresholds = [7, 10, 13, 16, 18];
    private static readonly Regex PinRegex = new(@"^\d{4,8}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly ConcurrentDictionary<string, ParentalPinAccessState> AccessStates = new(StringComparer.OrdinalIgnoreCase);
    private readonly IUserManager _users;

    public ParentalPinController(IUserManager users)
    {
        _users = users;
    }

    private sealed class ParentalPinAccessState
    {
        public int FailedAttempts { get; set; }

        public long LockedUntilUtc { get; set; }

        public long TrustedUntilUtc { get; set; }
    }

    private sealed record AccessSnapshot(
        bool IsLocked,
        long LockedUntilUtc,
        bool IsTrusted,
        long TrustedUntilUtc,
        int RemainingAttempts);

    private sealed record LockedUserSnapshot(
        string UserId,
        string UserName,
        long LockedUntilUtc,
        int RemainingMinutes);

    public sealed class SaveSettingsRequest
    {
        public string? Pin { get; set; }

        public List<RuleDto>? Rules { get; set; }

        public int? MaxAttempts { get; set; }

        public int? LockoutMinutes { get; set; }

        public int? TrustMinutes { get; set; }
    }

    public sealed class VerifyPinRequest
    {
        public string? Pin { get; set; }
    }

    public sealed class UnlockUserRequest
    {
        public string? UserId { get; set; }
    }

    public sealed class RuleDto
    {
        public string? UserId { get; set; }
        public int RatingThreshold { get; set; }
        public bool RequireUnratedPin { get; set; }
    }

    public sealed class UserDto
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("userName")]
        public string UserName { get; set; } = string.Empty;

        [JsonPropertyName("isAdmin")]
        public bool IsAdmin { get; set; }
    }

    [HttpGet("settings")]
    public IActionResult GetSettings()
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
        cfg.ParentalPinRules = sanitizedRules;
        var securityChanged = NormalizeSecuritySettings(cfg);
        if (rulesChanged || securityChanged)
        {
            plugin.UpdateConfiguration(cfg);
        }

        NoCache();
        return Ok(BuildSettingsResponse(cfg, users, sanitizedRules));
    }

    [HttpPost("settings")]
    public IActionResult SaveSettings([FromBody] SaveSettingsRequest? request)
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        NormalizeSecuritySettings(cfg);
        var normalizedRules = SanitizeRules(
            (request?.Rules ?? [])
                .Select(rule => new ParentalPinRuleEntry
                {
                    UserId = NormalizeUserId(rule?.UserId),
                    RatingThreshold = rule?.RatingThreshold ?? 0,
                    RequireUnratedPin = rule?.RequireUnratedPin == true
                })
                .ToList(),
            users,
            out _);
        var nextMaxAttempts = NormalizeMaxAttempts(request?.MaxAttempts ?? cfg.ParentalPinMaxAttempts);
        var nextLockoutMinutes = NormalizeLockoutMinutes(request?.LockoutMinutes ?? cfg.ParentalPinLockoutMinutes);
        var nextTrustMinutes = NormalizeTrustMinutes(request?.TrustMinutes ?? cfg.ParentalPinTrustMinutes);

        var nextPin = NormalizePin(request?.Pin);
        var hasExistingPin = HasConfiguredPin(cfg);

        if (normalizedRules.Count > 0 && string.IsNullOrWhiteSpace(nextPin) && !hasExistingPin)
        {
            return BadRequest(new
            {
                ok = false,
                code = "parental_pin_pin_required",
                error = "A PIN must be configured before rules can be assigned."
            });
        }

        if (!string.IsNullOrWhiteSpace(request?.Pin) && nextPin is null)
        {
            return BadRequest(new
            {
                ok = false,
                code = "parental_pin_invalid_format",
                error = "PIN must be 4 to 8 digits."
            });
        }

        var rulesChanged = !AreRulesEqual(cfg.ParentalPinRules, normalizedRules);
        var securityChanged =
            cfg.ParentalPinMaxAttempts != nextMaxAttempts
            || cfg.ParentalPinLockoutMinutes != nextLockoutMinutes
            || cfg.ParentalPinTrustMinutes != nextTrustMinutes;
        var pinChanged = false;

        if (!string.IsNullOrWhiteSpace(nextPin))
        {
            var hashed = HashPin(nextPin);
            cfg.ParentalPinHash = hashed.Hash;
            cfg.ParentalPinSalt = hashed.Salt;
            pinChanged = true;
        }

        if (rulesChanged)
        {
            cfg.ParentalPinRules = normalizedRules;
        }

        if (securityChanged)
        {
            cfg.ParentalPinMaxAttempts = nextMaxAttempts;
            cfg.ParentalPinLockoutMinutes = nextLockoutMinutes;
            cfg.ParentalPinTrustMinutes = nextTrustMinutes;
        }

        if (rulesChanged || pinChanged || securityChanged)
        {
            cfg.ParentalPinRevision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            AccessStates.Clear();
            plugin.UpdateConfiguration(cfg);
        }

        NoCache();
        return Ok(BuildSettingsResponse(cfg, users, cfg.ParentalPinRules));
    }

    [HttpPost("unlock")]
    public IActionResult UnlockUser([FromBody] UnlockUserRequest? request)
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
        cfg.ParentalPinRules = sanitizedRules;
        var securityChanged = NormalizeSecuritySettings(cfg);
        if (rulesChanged || securityChanged)
        {
            plugin.UpdateConfiguration(cfg);
        }

        var userId = NormalizeUserId(request?.UserId);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return BadRequest(new
            {
                ok = false,
                code = "parental_pin_unlock_user_required",
                error = "UserId is required."
            });
        }

        if (!users.TryGetValue(userId, out _))
        {
            return NotFound(new
            {
                ok = false,
                code = "parental_pin_unlock_user_not_found",
                error = "User not found."
            });
        }

        ClearAccessState(userId);
        NoCache();
        return Ok(BuildSettingsResponse(cfg, users, sanitizedRules, userId));
    }

    [HttpGet("policy")]
    public IActionResult GetCurrentUserPolicy()
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
        cfg.ParentalPinRules = sanitizedRules;
        var securityChanged = NormalizeSecuritySettings(cfg);
        if (rulesChanged || securityChanged)
        {
            plugin.UpdateConfiguration(cfg);
        }

        var userId = userCheck.UserId.ToString("D");
        var rule = sanitizedRules.FirstOrDefault(entry =>
            string.Equals(entry.UserId, userId, StringComparison.OrdinalIgnoreCase));
        var hasPin = HasConfiguredPin(cfg);
        if (!hasPin || rule is null)
        {
            ClearAccessState(userId);
        }

        var access = hasPin && rule is not null
            ? GetAccessSnapshot(userId, cfg.ParentalPinMaxAttempts)
            : CreateEmptyAccessSnapshot(cfg.ParentalPinMaxAttempts);

        NoCache();
        return Ok(new
        {
            ok = true,
            hasPin,
            revision = cfg.ParentalPinRevision,
            rule = rule is null ? null : ToRuleResponse(rule),
            maxAttempts = cfg.ParentalPinMaxAttempts,
            lockoutMinutes = cfg.ParentalPinLockoutMinutes,
            trustMinutes = cfg.ParentalPinTrustMinutes,
            remainingAttempts = access.RemainingAttempts,
            lockedUntilUtc = access.LockedUntilUtc,
            trustedUntilUtc = access.TrustedUntilUtc,
            isLocked = access.IsLocked,
            isTrusted = access.IsTrusted
        });
    }

    [HttpPost("verify")]
    public IActionResult VerifyPin([FromBody] VerifyPinRequest? request)
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
        cfg.ParentalPinRules = sanitizedRules;
        var securityChanged = NormalizeSecuritySettings(cfg);
        if (rulesChanged || securityChanged)
        {
            plugin.UpdateConfiguration(cfg);
        }

        var userId = userCheck.UserId.ToString("D");
        var rule = sanitizedRules.FirstOrDefault(entry =>
            string.Equals(entry.UserId, userId, StringComparison.OrdinalIgnoreCase));
        var hasPin = HasConfiguredPin(cfg);
        if (!hasPin || rule is null)
        {
            ClearAccessState(userId);
            NoCache();
            return Ok(new
            {
                ok = true,
                valid = false,
                maxAttempts = cfg.ParentalPinMaxAttempts,
                remainingAttempts = cfg.ParentalPinMaxAttempts,
                lockoutMinutes = cfg.ParentalPinLockoutMinutes,
                trustMinutes = cfg.ParentalPinTrustMinutes,
                lockedUntilUtc = 0,
                trustedUntilUtc = 0,
                isLocked = false,
                isTrusted = false
            });
        }

        var state = GetAccessState(userId);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var maxAttempts = cfg.ParentalPinMaxAttempts;
        var lockoutMinutes = cfg.ParentalPinLockoutMinutes;
        var trustMinutes = cfg.ParentalPinTrustMinutes;
        var pin = NormalizePin(request?.Pin);

        lock (state)
        {
            NormalizeAccessState(state, now);
            var beforeSnapshot = CreateAccessSnapshot(state, now, maxAttempts);

            if (beforeSnapshot.IsTrusted)
            {
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = true,
                    maxAttempts,
                    remainingAttempts = beforeSnapshot.RemainingAttempts,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = beforeSnapshot.LockedUntilUtc,
                    trustedUntilUtc = beforeSnapshot.TrustedUntilUtc,
                    isLocked = beforeSnapshot.IsLocked,
                    isTrusted = beforeSnapshot.IsTrusted
                });
            }

            if (beforeSnapshot.IsLocked)
            {
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = false,
                    maxAttempts,
                    remainingAttempts = 0,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = beforeSnapshot.LockedUntilUtc,
                    trustedUntilUtc = beforeSnapshot.TrustedUntilUtc,
                    isLocked = true,
                    isTrusted = false
                });
            }

            if (pin is null)
            {
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = false,
                    code = "parental_pin_invalid_format",
                    maxAttempts,
                    remainingAttempts = beforeSnapshot.RemainingAttempts,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = 0,
                    trustedUntilUtc = 0,
                    isLocked = false,
                    isTrusted = false
                });
            }

            var valid = VerifyPinHash(pin, cfg.ParentalPinHash, cfg.ParentalPinSalt);
            if (valid)
            {
                state.FailedAttempts = 0;
                state.LockedUntilUtc = 0;
                state.TrustedUntilUtc = trustMinutes > 0
                    ? now + (trustMinutes * 60_000L)
                    : 0;

                var successSnapshot = CreateAccessSnapshot(state, now, maxAttempts);
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = true,
                    maxAttempts,
                    remainingAttempts = successSnapshot.RemainingAttempts,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = successSnapshot.LockedUntilUtc,
                    trustedUntilUtc = successSnapshot.TrustedUntilUtc,
                    isLocked = successSnapshot.IsLocked,
                    isTrusted = successSnapshot.IsTrusted
                });
            }

            state.TrustedUntilUtc = 0;
            state.FailedAttempts = Math.Min(maxAttempts, Math.Max(0, state.FailedAttempts) + 1);
            if (state.FailedAttempts >= maxAttempts)
            {
                state.FailedAttempts = maxAttempts;
                state.LockedUntilUtc = now + (lockoutMinutes * 60_000L);
            }

            var failureSnapshot = CreateAccessSnapshot(state, now, maxAttempts);
            NoCache();
            return Ok(new
            {
                ok = true,
                valid = false,
                maxAttempts,
                remainingAttempts = failureSnapshot.RemainingAttempts,
                lockoutMinutes,
                trustMinutes,
                lockedUntilUtc = failureSnapshot.LockedUntilUtc,
                trustedUntilUtc = failureSnapshot.TrustedUntilUtc,
                isLocked = failureSnapshot.IsLocked,
                isTrusted = failureSnapshot.IsTrusted
            });
        }
    }

    private Dictionary<string, User> GetKnownUsers()
    {
        var map = new Dictionary<string, User>(StringComparer.OrdinalIgnoreCase);
        foreach (var user in _users.Users)
        {
            if (user is null || user.Id == Guid.Empty)
            {
                continue;
            }

            map[user.Id.ToString("D")] = user;
        }

        return map;
    }

    private static object ToRuleResponse(ParentalPinRuleEntry entry)
        => new
        {
            userId = entry.UserId,
            userName = entry.UserName,
            ratingThreshold = entry.RatingThreshold,
            requireUnratedPin = entry.RequireUnratedPin,
            updatedAtUtc = entry.UpdatedAtUtc
        };

    private object BuildSettingsResponse(
        JMSFusionConfiguration cfg,
        IReadOnlyDictionary<string, User> users,
        IReadOnlyList<ParentalPinRuleEntry> rules,
        string? unlockedUserId = null)
    {
        var lockStates = GetLockedUserSnapshots(users, cfg.ParentalPinMaxAttempts)
            .Select(entry => new
            {
                userId = entry.UserId,
                userName = entry.UserName,
                lockedUntilUtc = entry.LockedUntilUtc,
                remainingMinutes = entry.RemainingMinutes
            })
            .ToList();

        return new
        {
            ok = true,
            hasPin = HasConfiguredPin(cfg),
            revision = cfg.ParentalPinRevision,
            thresholds = AllowedThresholds,
            rules = rules.Select(ToRuleResponse).ToList(),
            maxAttempts = cfg.ParentalPinMaxAttempts,
            lockoutMinutes = cfg.ParentalPinLockoutMinutes,
            trustMinutes = cfg.ParentalPinTrustMinutes,
            users = users.Values
                .OrderBy(user => user.Username, StringComparer.OrdinalIgnoreCase)
                .Select(user => new UserDto
                {
                    UserId = user.Id.ToString("D"),
                    UserName = user.Username ?? "User",
                    IsAdmin = IsAdminUser(user)
                })
                .ToList(),
            lockStates,
            unlockedUserId = string.IsNullOrWhiteSpace(unlockedUserId) ? null : unlockedUserId
        };
    }

    private static List<ParentalPinRuleEntry> SanitizeRules(
        IEnumerable<ParentalPinRuleEntry>? rules,
        IReadOnlyDictionary<string, User> users,
        out bool changed)
    {
        changed = false;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var output = new List<ParentalPinRuleEntry>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rule in rules ?? Array.Empty<ParentalPinRuleEntry>())
        {
            var userId = NormalizeUserId(rule?.UserId);
            if (string.IsNullOrWhiteSpace(userId))
            {
                changed = true;
                continue;
            }

            if (!users.TryGetValue(userId, out var user))
            {
                changed = true;
                continue;
            }

            if (!seen.Add(userId))
            {
                changed = true;
                continue;
            }

            var threshold = NormalizeThreshold(rule?.RatingThreshold ?? 0);
            var requireUnratedPin = rule?.RequireUnratedPin == true;
            if (threshold <= 0 && !requireUnratedPin)
            {
                changed = true;
                continue;
            }

            var userName = user.Username ?? "User";
            var updatedAtUtc = rule?.UpdatedAtUtc ?? 0;
            if (updatedAtUtc <= 0)
            {
                updatedAtUtc = now;
                changed = true;
            }

            var normalized = new ParentalPinRuleEntry
            {
                UserId = userId,
                UserName = userName,
                RatingThreshold = threshold,
                RequireUnratedPin = requireUnratedPin,
                UpdatedAtUtc = updatedAtUtc
            };

            if (!RuleEquals(rule, normalized))
            {
                changed = true;
            }

            output.Add(normalized);
        }

        return output
            .OrderBy(rule => rule.UserName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(rule => rule.UserId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool AreRulesEqual(
        IReadOnlyList<ParentalPinRuleEntry>? left,
        IReadOnlyList<ParentalPinRuleEntry>? right)
    {
        var leftList = left ?? Array.Empty<ParentalPinRuleEntry>();
        var rightList = right ?? Array.Empty<ParentalPinRuleEntry>();
        if (leftList.Count != rightList.Count)
        {
            return false;
        }

        for (var i = 0; i < leftList.Count; i++)
        {
            if (!RuleEquals(leftList[i], rightList[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static bool RuleEquals(ParentalPinRuleEntry? left, ParentalPinRuleEntry? right)
    {
        if (left is null && right is null)
        {
            return true;
        }

        if (left is null || right is null)
        {
            return false;
        }

        return string.Equals(NormalizeUserId(left.UserId), NormalizeUserId(right.UserId), StringComparison.OrdinalIgnoreCase)
            && string.Equals(left.UserName ?? string.Empty, right.UserName ?? string.Empty, StringComparison.Ordinal)
            && left.RatingThreshold == right.RatingThreshold
            && left.RequireUnratedPin == right.RequireUnratedPin
            && left.UpdatedAtUtc == right.UpdatedAtUtc;
    }

    private static int NormalizeThreshold(int value)
        => AllowedThresholds.Contains(value) ? value : 0;

    private static bool NormalizeSecuritySettings(JMSFusionConfiguration cfg)
    {
        var maxAttempts = NormalizeMaxAttempts(cfg.ParentalPinMaxAttempts);
        var lockoutMinutes = NormalizeLockoutMinutes(cfg.ParentalPinLockoutMinutes);
        var trustMinutes = NormalizeTrustMinutes(cfg.ParentalPinTrustMinutes);
        var changed =
            cfg.ParentalPinMaxAttempts != maxAttempts
            || cfg.ParentalPinLockoutMinutes != lockoutMinutes
            || cfg.ParentalPinTrustMinutes != trustMinutes;

        cfg.ParentalPinMaxAttempts = maxAttempts;
        cfg.ParentalPinLockoutMinutes = lockoutMinutes;
        cfg.ParentalPinTrustMinutes = trustMinutes;
        return changed;
    }

    private static int NormalizeMaxAttempts(int value)
        => value < MinMaxAttempts ? DefaultMaxAttempts : Math.Clamp(value, MinMaxAttempts, MaxMaxAttempts);

    private static int NormalizeLockoutMinutes(int value)
        => value < MinLockoutMinutes ? DefaultLockoutMinutes : Math.Clamp(value, MinLockoutMinutes, MaxLockoutMinutes);

    private static int NormalizeTrustMinutes(int value)
        => value < MinTrustMinutes ? DefaultTrustMinutes : Math.Clamp(value, MinTrustMinutes, MaxTrustMinutes);

    private static List<LockedUserSnapshot> GetLockedUserSnapshots(
        IReadOnlyDictionary<string, User> users,
        int maxAttempts)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var output = new List<LockedUserSnapshot>();

        foreach (var entry in AccessStates)
        {
            var userId = NormalizeUserId(entry.Key);
            if (string.IsNullOrWhiteSpace(userId) || !users.TryGetValue(userId, out var user))
            {
                continue;
            }

            var state = entry.Value;
            AccessSnapshot snapshot;
            lock (state)
            {
                NormalizeAccessState(state, now);
                snapshot = CreateAccessSnapshot(state, now, maxAttempts);
            }

            if (!snapshot.IsLocked)
            {
                continue;
            }

            output.Add(new LockedUserSnapshot(
                userId,
                user.Username ?? "User",
                snapshot.LockedUntilUtc,
                GetRemainingLockMinutes(snapshot.LockedUntilUtc, now)));
        }

        return output
            .OrderBy(entry => entry.UserName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.UserId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string NormalizeUserId(string? value)
    {
        if (!Guid.TryParse((value ?? string.Empty).Trim(), out var userId) || userId == Guid.Empty)
        {
            return string.Empty;
        }

        return userId.ToString("D");
    }

    private static string? NormalizePin(string? value)
    {
        var pin = string.Concat((value ?? string.Empty).Where(char.IsDigit));
        if (string.IsNullOrWhiteSpace(pin))
        {
            return null;
        }

        return PinRegex.IsMatch(pin) ? pin : null;
    }

    private static bool HasConfiguredPin(JMSFusionConfiguration cfg)
        => !string.IsNullOrWhiteSpace(cfg.ParentalPinHash)
            && !string.IsNullOrWhiteSpace(cfg.ParentalPinSalt);

    private static (string Hash, string Salt) HashPin(string pin)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(pin),
            salt,
            100_000,
            HashAlgorithmName.SHA256,
            32);

        return (Convert.ToBase64String(hash), Convert.ToBase64String(salt));
    }

    private static bool VerifyPinHash(string pin, string? storedHash, string? storedSalt)
    {
        if (string.IsNullOrWhiteSpace(pin)
            || string.IsNullOrWhiteSpace(storedHash)
            || string.IsNullOrWhiteSpace(storedSalt))
        {
            return false;
        }

        try
        {
            var expectedHash = Convert.FromBase64String(storedHash);
            var salt = Convert.FromBase64String(storedSalt);
            var computedHash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(pin),
                salt,
                100_000,
                HashAlgorithmName.SHA256,
                expectedHash.Length);

            return CryptographicOperations.FixedTimeEquals(computedHash, expectedHash);
        }
        catch
        {
            return false;
        }
    }

    private static ParentalPinAccessState GetAccessState(string userId)
        => AccessStates.GetOrAdd(userId, static _ => new ParentalPinAccessState());

    private static void ClearAccessState(string userId)
    {
        if (!string.IsNullOrWhiteSpace(userId))
        {
            AccessStates.TryRemove(userId, out _);
        }
    }

    private static void NormalizeAccessState(ParentalPinAccessState state, long now)
    {
        if (state.LockedUntilUtc > 0 && state.LockedUntilUtc <= now)
        {
            state.LockedUntilUtc = 0;
            state.FailedAttempts = 0;
        }

        if (state.TrustedUntilUtc > 0 && state.TrustedUntilUtc <= now)
        {
            state.TrustedUntilUtc = 0;
        }

        if (state.FailedAttempts < 0)
        {
            state.FailedAttempts = 0;
        }
    }

    private static int GetRemainingLockMinutes(long lockedUntilUtc, long now)
    {
        var remainingMs = Math.Max(0, lockedUntilUtc - now);
        return Math.Max(1, (int)Math.Ceiling(remainingMs / 60_000d));
    }

    private static AccessSnapshot GetAccessSnapshot(string userId, int maxAttempts)
    {
        var state = GetAccessState(userId);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        lock (state)
        {
            NormalizeAccessState(state, now);
            return CreateAccessSnapshot(state, now, maxAttempts);
        }
    }

    private static AccessSnapshot CreateAccessSnapshot(ParentalPinAccessState state, long now, int maxAttempts)
    {
        var lockedUntilUtc = state.LockedUntilUtc > now ? state.LockedUntilUtc : 0;
        var trustedUntilUtc = state.TrustedUntilUtc > now ? state.TrustedUntilUtc : 0;
        var isLocked = lockedUntilUtc > 0;
        var isTrusted = trustedUntilUtc > 0;
        var remainingAttempts = isLocked
            ? 0
            : Math.Clamp(maxAttempts - Math.Max(0, state.FailedAttempts), 0, maxAttempts);

        return new AccessSnapshot(isLocked, lockedUntilUtc, isTrusted, trustedUntilUtc, remainingAttempts);
    }

    private static AccessSnapshot CreateEmptyAccessSnapshot(int maxAttempts)
        => new(false, 0, false, 0, Math.Max(0, maxAttempts));

    private (User? User, Guid UserId, IActionResult? Result) TryGetAdminUser()
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck;
        }

        if (!IsAdminUser(userCheck.User))
        {
            return (null, Guid.Empty, StatusCode(403, new
            {
                ok = false,
                code = "parental_pin_admin_required",
                error = "This action is only available to administrators."
            }));
        }

        return userCheck;
    }

    private (User? User, Guid UserId, IActionResult? Result) TryGetRequestUser()
    {
        if (!TryGetRequestUserId(out var userId))
        {
            return (null, Guid.Empty, Unauthorized(new
            {
                ok = false,
                code = "parental_pin_user_required",
                error = "X-Emby-UserId is required."
            }));
        }

        var user = _users.GetUserById(userId);
        if (user is null)
        {
            return (null, Guid.Empty, Unauthorized(new
            {
                ok = false,
                code = "parental_pin_user_not_found",
                error = "User not found."
            }));
        }

        return (user, userId, null);
    }

    private bool TryGetRequestUserId(out Guid userId)
    {
        var userIdHeader =
            Request.Headers["X-Emby-UserId"].FirstOrDefault()
            ?? Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault();

        return Guid.TryParse(userIdHeader, out userId) && userId != Guid.Empty;
    }

    private static bool IsAdminUser(User? user)
    {
        if (user is null)
        {
            return false;
        }

        return user.Permissions.Any(permission =>
            permission.Kind == PermissionKind.IsAdministrator && permission.Value);
    }

    private void NoCache()
    {
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
    }
}
