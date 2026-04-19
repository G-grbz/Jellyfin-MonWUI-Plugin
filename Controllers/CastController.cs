using System;
using System.Linq;
using System.Security.Claims;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/cast")]
    [Route("Plugins/JMSFusion/cast")]
    public class CastController : ControllerBase
    {
        private readonly IUserManager _users;
        private readonly ISessionManager _sessions;

        public CastController(IUserManager users, ISessionManager sessions)
        {
            _users = users;
            _sessions = sessions;
        }

        public sealed class CastSettingsRequest
        {
            public bool? EnableCastModule { get; set; }

            public bool? AllowSharedCastViewerForUsers { get; set; }
        }

        [HttpGet("access")]
        public IActionResult GetAccess()
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            NoCache();
            return Ok(BuildAccessPayload(userCheck.User));
        }

        [HttpPost("settings")]
        public IActionResult SaveSettings([FromBody] CastSettingsRequest? request)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;

            if (request?.EnableCastModule.HasValue == true)
            {
                cfg.EnableCastModule = request.EnableCastModule.Value;
            }

            if (request?.AllowSharedCastViewerForUsers.HasValue == true)
            {
                cfg.AllowSharedCastViewerForUsers = request.AllowSharedCastViewerForUsers.Value;
            }

            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new
            {
                ok = true,
                settings = new
                {
                    cfg.EnableCastModule,
                    cfg.AllowSharedCastViewerForUsers
                },
                access = BuildAccessPayload(adminCheck.User)
            });
        }

        [HttpGet("sessions")]
        public IActionResult GetVisibleSessions()
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

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
            var requestUserId = userCheck.UserId.ToString("D");

            var items = (_sessions.Sessions ?? Array.Empty<SessionInfo>())
                .Where(session => session is not null && session.NowPlayingItem is not null)
                .Where(session => allowShared || SameUser(session, requestUserId))
                .OrderBy(session => NormalizeText(session.UserName), StringComparer.OrdinalIgnoreCase)
                .ThenBy(session => NormalizeText(session.DeviceName), StringComparer.OrdinalIgnoreCase)
                .Select(session => new
                {
                    session.Id,
                    UserId = session.UserId,
                    session.UserName,
                    session.Client,
                    session.DeviceName,
                    session.DeviceId,
                    session.DeviceType,
                    session.ApplicationVersion,
                    session.IsActive,
                    session.SupportsMediaControl,
                    session.SupportsRemoteControl,
                    session.Capabilities,
                    session.PlayableMediaTypes,
                    session.PlayState,
                    NowPlayingItem = session.FullNowPlayingItem,
                    NowPlayingItemId = session.NowPlayingItem?.Id,
                    NowPlayingItemName = session.NowPlayingItem?.Name,
                    NowPlayingItemType = session.NowPlayingItem?.GetType().Name
                })
                .ToList();

            NoCache();
            return Ok(new
            {
                ok = true,
                moduleEnabled = cfg.EnableCastModule,
                allowSharedViewerForUsers = cfg.AllowSharedCastViewerForUsers,
                isAdmin,
                canViewShared = allowShared,
                canControl = isAdmin,
                items
            });
        }

        private object BuildAccessPayload(User? user)
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            var isAdmin = IsAdminUser(user);
            var moduleEnabled = cfg.EnableCastModule;
            var allowShared = cfg.AllowSharedCastViewerForUsers;

            return new
            {
                ok = true,
                moduleEnabled,
                allowSharedViewerForUsers = allowShared,
                isAdmin,
                canViewShared = moduleEnabled && (isAdmin || allowShared),
                canControl = moduleEnabled && isAdmin,
                canAccessModule = moduleEnabled
            };
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

        private static bool SameUser(SessionInfo? session, string requestUserId)
        {
            var sessionUserId = NormalizeText(session is null ? null : session.UserId.ToString());
            return !string.IsNullOrWhiteSpace(sessionUserId) &&
                string.Equals(sessionUserId, requestUserId, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeText(string? value)
            => string.Join(string.Empty, (value ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }
    }
}
