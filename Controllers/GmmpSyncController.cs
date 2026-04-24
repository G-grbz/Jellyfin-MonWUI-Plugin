using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/gmmp")]
    [Route("Plugins/JMSFusion/gmmp")]
    public class GmmpSyncController : ControllerBase
    {
        private static readonly ConcurrentDictionary<string, GmmpStateRecord> StateRecords =
            new(StringComparer.OrdinalIgnoreCase);

        private static readonly ConcurrentDictionary<string, List<GmmpCommandRecord>> CommandQueues =
            new(StringComparer.OrdinalIgnoreCase);

        private static readonly object CommandSync = new();
        private static long _commandSequence;

        private static readonly TimeSpan StateTtl = TimeSpan.FromSeconds(20);
        private static readonly TimeSpan CommandTtl = TimeSpan.FromMinutes(2);

        private readonly IUserManager _users;

        public GmmpSyncController(IUserManager users)
        {
            _users = users;
        }

        public sealed class GmmpStateRequest
        {
            public string? SessionId { get; set; }

            public string? DeviceId { get; set; }

            public string? TrackId { get; set; }

            public string? ItemId { get; set; }

            public bool HasCurrentTrack { get; set; }

            public bool IsPaused { get; set; }

            public bool IsMuted { get; set; }

            public int VolumeLevel { get; set; }

            public long PositionTicks { get; set; }

            public long RuntimeTicks { get; set; }

            public bool IsLiveStream { get; set; }
        }

        public sealed class GmmpCommandRequest
        {
            public string? SessionId { get; set; }

            public string? DeviceId { get; set; }

            public string? Name { get; set; }

            public Dictionary<string, string?>? Arguments { get; set; }
        }

        private sealed class GmmpStateRecord
        {
            public string Key { get; init; } = string.Empty;

            public string SessionId { get; init; } = string.Empty;

            public string DeviceId { get; init; } = string.Empty;

            public Guid UserId { get; init; }

            public string UserName { get; init; } = string.Empty;

            public string TrackId { get; init; } = string.Empty;

            public string ItemId { get; init; } = string.Empty;

            public bool HasCurrentTrack { get; init; }

            public bool IsPaused { get; init; }

            public bool IsMuted { get; init; }

            public int VolumeLevel { get; init; }

            public long PositionTicks { get; init; }

            public long RuntimeTicks { get; init; }

            public bool IsLiveStream { get; init; }

            public DateTimeOffset UpdatedAtUtc { get; init; }
        }

        private sealed class GmmpCommandRecord
        {
            public long Sequence { get; init; }

            public string Name { get; init; } = string.Empty;

            public Dictionary<string, string?> Arguments { get; init; } = new(StringComparer.OrdinalIgnoreCase);

            public DateTimeOffset CreatedAtUtc { get; init; }
        }

        [HttpPost("state")]
        public IActionResult UpdateState([FromBody] GmmpStateRequest? request)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            CleanupExpiredEntries();

            var key = ResolveStateKey(request?.SessionId, request?.DeviceId);
            if (string.IsNullOrWhiteSpace(key))
            {
                NoCache();
                return BadRequest(new
                {
                    ok = false,
                    error = "SessionId veya DeviceId gerekli."
                });
            }

            if (request?.HasCurrentTrack != true)
            {
                RemoveStateAndCommands(request?.SessionId, request?.DeviceId);

                NoCache();
                return Ok(new
                {
                    ok = true,
                    active = false,
                    key
                });
            }

            var record = new GmmpStateRecord
            {
                Key = key,
                SessionId = CleanText(request?.SessionId),
                DeviceId = CleanText(request?.DeviceId),
                UserId = userCheck.UserId,
                UserName = CleanText(userCheck.User?.Username),
                TrackId = CleanText(request?.TrackId),
                ItemId = CleanText(request?.ItemId),
                HasCurrentTrack = request?.HasCurrentTrack == true,
                IsPaused = request?.IsPaused == true,
                IsMuted = request?.IsMuted == true,
                VolumeLevel = Clamp(request?.VolumeLevel ?? 0, 0, 100),
                PositionTicks = Math.Max(0, request?.PositionTicks ?? 0),
                RuntimeTicks = Math.Max(0, request?.RuntimeTicks ?? 0),
                IsLiveStream = request?.IsLiveStream == true,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };

            StateRecords[key] = record;

            NoCache();
            return Ok(new
            {
                ok = true,
                active = true,
                key,
                updatedAt = record.UpdatedAtUtc
            });
        }

        [HttpGet("states")]
        public IActionResult GetStates()
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            CleanupExpiredEntries();

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            var isAdmin = IsAdminUser(userCheck.User);

            if (!cfg.EnableCastModule)
            {
                NoCache();
                return StatusCode(403, new
                {
                    ok = false,
                    error = "Cast modulu devre disi."
                });
            }

            var allowShared = isAdmin || cfg.AllowSharedCastViewerForUsers;
            var requestUserId = userCheck.UserId;

            var items = StateRecords.Values
                .Where(record => record.HasCurrentTrack)
                .Where(record => allowShared || record.UserId == requestUserId)
                .OrderBy(record => record.UserName, StringComparer.OrdinalIgnoreCase)
                .ThenBy(record => record.DeviceId, StringComparer.OrdinalIgnoreCase)
                .Select(record => new
                {
                    record.SessionId,
                    record.DeviceId,
                    UserId = record.UserId.ToString("D"),
                    record.UserName,
                    record.TrackId,
                    record.ItemId,
                    record.HasCurrentTrack,
                    record.IsPaused,
                    record.IsMuted,
                    record.VolumeLevel,
                    record.PositionTicks,
                    record.RuntimeTicks,
                    record.IsLiveStream,
                    updatedAt = record.UpdatedAtUtc
                })
                .ToList();

            NoCache();
            return Ok(new
            {
                ok = true,
                items
            });
        }

        [HttpPost("commands")]
        public IActionResult EnqueueCommand([FromBody] GmmpCommandRequest? request)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            CleanupExpiredEntries();

            var key = ResolveStateKey(request?.SessionId, request?.DeviceId);
            var relatedKeys = GetRelatedStateKeys(request?.SessionId, request?.DeviceId);
            var commandName = CleanText(request?.Name);
            if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(commandName))
            {
                NoCache();
                return BadRequest(new
                {
                    ok = false,
                    error = "SessionId/DeviceId ve Name gerekli."
                });
            }

            var command = new GmmpCommandRecord
            {
                Sequence = Interlocked.Increment(ref _commandSequence),
                Name = commandName,
                Arguments = NormalizeArguments(request?.Arguments),
                CreatedAtUtc = DateTimeOffset.UtcNow
            };

            lock (CommandSync)
            {
                var queueKeys = relatedKeys.Length > 0 ? relatedKeys : new[] { key };
                foreach (var queueKey in queueKeys)
                {
                    if (!CommandQueues.TryGetValue(queueKey, out var list))
                    {
                        list = new List<GmmpCommandRecord>();
                        CommandQueues[queueKey] = list;
                    }

                    list.Add(command);
                }
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                key,
                sequence = command.Sequence
            });
        }

        [HttpGet("commands")]
        public IActionResult GetCommands(
            [FromQuery] string? sessionId = null,
            [FromQuery] string? deviceId = null,
            [FromQuery] long afterSequence = 0)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            CleanupExpiredEntries();

            var key = ResolveStateKey(sessionId, deviceId);
            var relatedKeys = GetRelatedStateKeys(sessionId, deviceId);
            if (string.IsNullOrWhiteSpace(key))
            {
                NoCache();
                return BadRequest(new
                {
                    ok = false,
                    error = "SessionId veya DeviceId gerekli."
                });
            }

            var accessibleStateRecord = relatedKeys
                .Select(candidateKey => StateRecords.TryGetValue(candidateKey, out var stateRecord) ? stateRecord : null)
                .FirstOrDefault(stateRecord => stateRecord is not null);

            if (accessibleStateRecord is not null && accessibleStateRecord.UserId != userCheck.UserId)
            {
                NoCache();
                return StatusCode(403, new
                {
                    ok = false,
                    error = "Bu GMMP oturumu icin erisim yok."
                });
            }

            List<GmmpCommandRecord> items;
            lock (CommandSync)
            {
                var queueKeys = relatedKeys.Length > 0 ? relatedKeys : new[] { key };
                items = queueKeys
                    .SelectMany(candidateKey => CommandQueues.TryGetValue(candidateKey, out var queue)
                        ? (IEnumerable<GmmpCommandRecord>)queue
                        : Array.Empty<GmmpCommandRecord>())
                    .Where(command => command.Sequence > afterSequence)
                    .GroupBy(command => command.Sequence)
                    .Select(group => group.First())
                    .OrderBy(command => command.Sequence)
                    .ToList();

                if (items.Count == 0)
                {
                    items = new List<GmmpCommandRecord>();
                }
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                items = items.Select(command => new
                {
                    command.Sequence,
                    command.Name,
                    command.Arguments,
                    createdAt = command.CreatedAtUtc
                })
            });
        }

        private static void CleanupExpiredEntries()
        {
            var now = DateTimeOffset.UtcNow;

            foreach (var pair in StateRecords.ToArray())
            {
                if ((now - pair.Value.UpdatedAtUtc) > StateTtl || !pair.Value.HasCurrentTrack)
                {
                    StateRecords.TryRemove(pair.Key, out _);
                }
            }

            lock (CommandSync)
            {
                foreach (var pair in CommandQueues.ToArray())
                {
                    pair.Value.RemoveAll(command => (now - command.CreatedAtUtc) > CommandTtl);
                    if (pair.Value.Count == 0)
                    {
                        CommandQueues.TryRemove(pair.Key, out _);
                    }
                }
            }
        }

        private static string BuildSessionStateKey(string? sessionId)
        {
            var cleanSessionId = CleanText(sessionId);
            if (!string.IsNullOrWhiteSpace(cleanSessionId))
            {
                return $"session:{cleanSessionId}";
            }

            return string.Empty;
        }

        private static string BuildDeviceStateKey(string? deviceId)
        {
            var cleanDeviceId = CleanText(deviceId);
            if (!string.IsNullOrWhiteSpace(cleanDeviceId))
            {
                return $"device:{cleanDeviceId}";
            }

            return string.Empty;
        }

        private static string[] GetRelatedStateKeys(string? sessionId, string? deviceId)
        {
            return new[]
            {
                BuildSessionStateKey(sessionId),
                BuildDeviceStateKey(deviceId)
            }
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        }

        private static string ResolveStateKey(string? sessionId, string? deviceId)
        {
            var sessionKey = BuildSessionStateKey(sessionId);
            if (!string.IsNullOrWhiteSpace(sessionKey))
            {
                if (StateRecords.ContainsKey(sessionKey))
                {
                    return sessionKey;
                }

                lock (CommandSync)
                {
                    if (CommandQueues.ContainsKey(sessionKey))
                    {
                        return sessionKey;
                    }
                }
            }

            var deviceKey = BuildDeviceStateKey(deviceId);
            if (!string.IsNullOrWhiteSpace(deviceKey))
            {
                if (StateRecords.ContainsKey(deviceKey))
                {
                    return deviceKey;
                }

                lock (CommandSync)
                {
                    if (CommandQueues.ContainsKey(deviceKey))
                    {
                        return deviceKey;
                    }
                }
            }

            return !string.IsNullOrWhiteSpace(sessionKey) ? sessionKey : deviceKey;
        }

        private static void RemoveStateAndCommands(string? sessionId, string? deviceId)
        {
            var keys = GetRelatedStateKeys(sessionId, deviceId);

            foreach (var key in keys)
            {
                StateRecords.TryRemove(key, out _);
            }

            lock (CommandSync)
            {
                foreach (var key in keys)
                {
                    CommandQueues.TryRemove(key, out _);
                }
            }
        }

        private static Dictionary<string, string?> NormalizeArguments(Dictionary<string, string?>? arguments)
        {
            var normalized = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            if (arguments is null)
            {
                return normalized;
            }

            foreach (var pair in arguments)
            {
                var key = CleanText(pair.Key);
                if (string.IsNullOrWhiteSpace(key))
                {
                    continue;
                }

                normalized[key] = pair.Value;
            }

            return normalized;
        }

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
                    error = "Bu islem sadece admin kullanicilar icindir."
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
                    error = "X-Emby-UserId gerekli."
                }));
            }

            var user = _users.GetUserById(userId);
            if (user is null)
            {
                return (null, Guid.Empty, Unauthorized(new
                {
                    ok = false,
                    error = "Kullanici bulunamadi."
                }));
            }

            return (user, userId, null);
        }

        private bool TryGetRequestUserId(out Guid userId)
        {
            foreach (var candidate in new[]
            {
                Request.Headers["X-Emby-UserId"].FirstOrDefault(),
                Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault(),
                Request.Query["userId"].FirstOrDefault(),
                Request.Query["UserId"].FirstOrDefault(),
                TryGetUserIdFromClaims(),
                TryGetUserIdFromAuthorizationHeader()
            })
            {
                if (Guid.TryParse(candidate, out userId) && userId != Guid.Empty)
                {
                    return true;
                }
            }

            userId = Guid.Empty;
            return false;
        }

        private string? TryGetUserIdFromClaims()
        {
            var claimTypes = new[]
            {
                ClaimTypes.NameIdentifier,
                "JellyfinUserId",
                "UserId",
                "user_id",
                "sub"
            };

            foreach (var claimType in claimTypes)
            {
                var claimValue = HttpContext?.User?.FindFirst(claimType)?.Value;
                if (!string.IsNullOrWhiteSpace(claimValue))
                {
                    return claimValue;
                }
            }

            return null;
        }

        private string? TryGetUserIdFromAuthorizationHeader()
        {
            var authorization =
                Request.Headers["X-Emby-Authorization"].FirstOrDefault() ??
                Request.Headers["Authorization"].FirstOrDefault();

            if (string.IsNullOrWhiteSpace(authorization))
            {
                return null;
            }

            const string quotedMarker = "UserId=\"";
            var quotedIndex = authorization.IndexOf(quotedMarker, StringComparison.OrdinalIgnoreCase);
            if (quotedIndex >= 0)
            {
                var start = quotedIndex + quotedMarker.Length;
                var end = authorization.IndexOf('"', start);
                if (end > start)
                {
                    return authorization[start..end];
                }
            }

            const string plainMarker = "UserId=";
            var plainIndex = authorization.IndexOf(plainMarker, StringComparison.OrdinalIgnoreCase);
            if (plainIndex >= 0)
            {
                var start = plainIndex + plainMarker.Length;
                var tail = authorization[start..];
                var end = tail.IndexOf(',');
                return (end >= 0 ? tail[..end] : tail).Trim().Trim('"');
            }

            return null;
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

        private static string CleanText(string? value)
            => string.Join(string.Empty, (value ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));

        private static int Clamp(int value, int min, int max)
            => Math.Min(max, Math.Max(min, value));

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }
    }
}
