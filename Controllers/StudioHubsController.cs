using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JMSFusion;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using IOFile = System.IO.File;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/studio-hubs")]
    [Route("Plugins/JMSFusion/studio-hubs")]
    public class StudioHubsController : ControllerBase
    {
        private static readonly string[] AllowedVideoExtensions = { ".mp4", ".webm", ".m4v", ".mov" };
        private static readonly string[] AllowedLogoExtensions = { ".png", ".webp", ".svg", ".jpg", ".jpeg" };
        private static readonly string[] DefaultStudioHubNames =
        {
            "Marvel Studios",
            "Pixar",
            "Walt Disney Pictures",
            "Disney+",
            "DC",
            "Warner Bros. Pictures",
            "Lucasfilm Ltd.",
            "Columbia Pictures",
            "Paramount Pictures",
            "Netflix",
            "DreamWorks Animation"
        };
        private readonly IUserManager _users;

        public StudioHubsController(IUserManager users)
        {
            _users = users;
        }

        public sealed class ManualCollectionRequest
        {
            public string? StudioId { get; set; }
            public string? Name { get; set; }
        }

        public sealed class VisibilityRequest
        {
            public string? Profile { get; set; }
            public List<string>? HiddenNames { get; set; }
            public List<string>? OrderNames { get; set; }
        }

        [HttpGet("visibility")]
        public IActionResult GetVisibility([FromQuery] string? profile = null)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubVisibilityEntries ??= new();
            if (SanitizeStudioHubVisibilityEntries(cfg))
            {
                plugin.UpdateConfiguration(cfg);
            }

            var prof = NormalizeProfile(profile);
            var userId = userCheck.UserId.ToString("D");
            var entry = cfg.StudioHubVisibilityEntries.FirstOrDefault(item =>
                string.Equals(item?.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(NormalizeProfile(item?.Profile), prof, StringComparison.OrdinalIgnoreCase));

            var hiddenNames = NormalizeHiddenNames(entry?.HiddenNames);
            var orderNames = NormalizeHiddenNames(entry?.OrderNames);

            NoCache();
            return Ok(new
            {
                ok = true,
                profile = prof,
                userId,
                hiddenNames,
                orderNames,
                updatedAtUtc = entry?.UpdatedAtUtc ?? 0L
            });
        }

        [HttpPost("visibility")]
        public IActionResult SaveVisibility([FromBody] VisibilityRequest? request, [FromQuery] string? profile = null)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubVisibilityEntries ??= new();
            var visibilitySanitized = SanitizeStudioHubVisibilityEntries(cfg);
            var allowedNames = BuildAllowedStudioHubNameSet(cfg);

            var prof = NormalizeProfile(request?.Profile ?? profile);
            var userId = userCheck.UserId.ToString("D");
            var existing = cfg.StudioHubVisibilityEntries.FirstOrDefault(item =>
                string.Equals(item?.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(NormalizeProfile(item?.Profile), prof, StringComparison.OrdinalIgnoreCase));

            var hiddenNames = request?.HiddenNames is null
                ? SanitizeVisibilityNames(existing?.HiddenNames, allowedNames)
                : SanitizeVisibilityNames(request.HiddenNames, allowedNames);
            var orderNames = request?.OrderNames is null
                ? SanitizeVisibilityNames(existing?.OrderNames, allowedNames)
                : SanitizeVisibilityNames(request.OrderNames, allowedNames);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            cfg.StudioHubVisibilityEntries = cfg.StudioHubVisibilityEntries
                .Where(item =>
                    !(string.Equals(item?.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
                      string.Equals(NormalizeProfile(item?.Profile), prof, StringComparison.OrdinalIgnoreCase)))
                .ToList();

            if (hiddenNames.Count > 0 || orderNames.Count > 0)
            {
                cfg.StudioHubVisibilityEntries.Add(new StudioHubVisibilityEntry
                {
                    UserId = userId,
                    UserName = userCheck.User?.Username,
                    Profile = prof,
                    HiddenNames = hiddenNames,
                    OrderNames = orderNames,
                    UpdatedAtUtc = now
                });
            }

            cfg.StudioHubVisibilityEntries = cfg.StudioHubVisibilityEntries
                .Where(item => !string.IsNullOrWhiteSpace(item?.UserId))
                .GroupBy(
                    item => $"{item!.UserId}|{NormalizeProfile(item.Profile)}",
                    StringComparer.OrdinalIgnoreCase)
                .Select(group => group.OrderByDescending(item => item?.UpdatedAtUtc ?? 0L).First())
                .OrderBy(item => item?.UserId, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => NormalizeProfile(item?.Profile), StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (visibilitySanitized || hiddenNames.Count > 0 || orderNames.Count > 0 || existing is not null)
            {
                plugin.UpdateConfiguration(cfg);
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                profile = prof,
                userId,
                hiddenNames,
                orderNames,
                updatedAtUtc = now
            });
        }

        [HttpPost("collection")]
        public IActionResult AddCollection([FromBody] ManualCollectionRequest? request)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }
            var adminUser = adminCheck.User ?? throw new InvalidOperationException("Admin user not available.");

            var studioId = NormalizeId(request?.StudioId);
            var cleanName = NormalizeCollectionName(request?.Name);
            if (string.IsNullOrWhiteSpace(studioId) || string.IsNullOrWhiteSpace(cleanName))
            {
                return BadRequest(new { ok = false, error = "StudioId ve başlık gerekli." });
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubManualEntries ??= new();

            var existingById = cfg.StudioHubManualEntries.FirstOrDefault(entry => IdEquals(entry?.StudioId, studioId));
            if (existingById is not null)
            {
              existingById.Name = cleanName;
              existingById.UpdatedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
              plugin.UpdateConfiguration(cfg);
              NoCache();
              return Ok(new { ok = true, entry = existingById, entries = cfg.StudioHubManualEntries });
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var entry = new StudioHubManualEntry
            {
                StudioId = studioId,
                Name = cleanName,
                AddedAtUtc = now,
                UpdatedAtUtc = now,
                AddedBy = adminUser.Username,
                AddedByUserId = adminCheck.UserId.ToString("D")
            };

            cfg.StudioHubManualEntries.Add(entry);
            cfg.StudioHubManualEntries = cfg.StudioHubManualEntries
                .OrderBy(x => NormalizeCollectionName(x?.Name), StringComparer.OrdinalIgnoreCase)
                .ToList();
            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new { ok = true, entry, entries = cfg.StudioHubManualEntries });
        }

        [HttpGet("collection")]
        public IActionResult GetCollections()
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            if (SanitizeStudioHubAssets(plugin, cfg))
            {
                plugin.UpdateConfiguration(cfg);
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                entries = cfg.StudioHubManualEntries
            });
        }

        [HttpDelete("collection")]
        public IActionResult DeleteCollection([FromQuery] string? studioId)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cleanStudioId = NormalizeId(studioId);
            if (string.IsNullOrWhiteSpace(cleanStudioId))
            {
                return BadRequest(new { ok = false, error = "StudioId gerekli." });
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubManualEntries ??= new();
            cfg.StudioHubVideoEntries ??= new();

            var existing = cfg.StudioHubManualEntries.FirstOrDefault(entry => IdEquals(entry?.StudioId, cleanStudioId));
            if (existing is null)
            {
                return NotFound(new { ok = false, error = "Manuel koleksiyon bulunamadı." });
            }

            var logosDir = plugin.GetStorageDirectory("studio-hub-logos");
            DeleteLooseFile(logosDir, existing.LogoFileName);

            var videoEntry = cfg.StudioHubVideoEntries.FirstOrDefault(entry => NameEquals(entry?.Name, existing.Name));
            if (videoEntry is not null)
            {
                DeleteLooseFile(plugin.GetStorageDirectory("studio-hub-videos"), videoEntry.FileName);
                cfg.StudioHubVideoEntries.Remove(videoEntry);
            }

            RemoveCollectionNameFromVisibilityEntries(cfg, existing.Name);
            cfg.StudioHubManualEntries.Remove(existing);
            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new
            {
                ok = true,
                manualEntries = cfg.StudioHubManualEntries,
                videoEntries = cfg.StudioHubVideoEntries
            });
        }

        [HttpPost("logo")]
        public async Task<IActionResult> UploadLogo([FromForm] string? studioId, [FromForm] IFormFile? file, CancellationToken ct)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cleanStudioId = NormalizeId(studioId);
            if (string.IsNullOrWhiteSpace(cleanStudioId))
            {
                return BadRequest(new { ok = false, error = "StudioId gerekli." });
            }

            if (file is null || file.Length <= 0)
            {
                return BadRequest(new { ok = false, error = "Yüklenecek logo gerekli." });
            }

            var ext = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(ext) || !AllowedLogoExtensions.Contains(ext, StringComparer.OrdinalIgnoreCase))
            {
                return BadRequest(new { ok = false, error = "Sadece png, webp, svg, jpg veya jpeg logo kabul edilir." });
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubManualEntries ??= new();

            var entry = cfg.StudioHubManualEntries.FirstOrDefault(item => IdEquals(item?.StudioId, cleanStudioId));
            if (entry is null)
            {
                return NotFound(new { ok = false, error = "Önce manuel koleksiyonu ekleyin." });
            }

            var logosDir = plugin.GetStorageDirectory("studio-hub-logos");
            var fileName = $"{SanitizeFileStem(entry.Name)}-{Guid.NewGuid():N}{ext}";
            var targetPath = Path.Combine(logosDir, fileName);

            await using (var stream = new FileStream(targetPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await file.CopyToAsync(stream, ct).ConfigureAwait(false);
            }

            DeleteLooseFile(logosDir, entry.LogoFileName);
            entry.LogoFileName = fileName;
            entry.UpdatedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new { ok = true, entry, entries = cfg.StudioHubManualEntries });
        }

        [HttpDelete("logo")]
        public IActionResult DeleteLogo([FromQuery] string? studioId)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cleanStudioId = NormalizeId(studioId);
            if (string.IsNullOrWhiteSpace(cleanStudioId))
            {
                return BadRequest(new { ok = false, error = "StudioId gerekli." });
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubManualEntries ??= new();

            var entry = cfg.StudioHubManualEntries.FirstOrDefault(item => IdEquals(item?.StudioId, cleanStudioId));
            if (entry is null)
            {
                return NotFound(new { ok = false, error = "Manuel koleksiyon bulunamadı." });
            }

            DeleteLooseFile(plugin.GetStorageDirectory("studio-hub-logos"), entry.LogoFileName);
            entry.LogoFileName = null;
            entry.UpdatedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new { ok = true, entry, entries = cfg.StudioHubManualEntries });
        }

        [HttpGet("logo/{fileName}")]
        [HttpHead("logo/{fileName}")]
        public IActionResult GetLogo(string fileName)
        {
            var cleanFileName = Path.GetFileName(fileName ?? string.Empty);
            if (string.IsNullOrWhiteSpace(cleanFileName) || !string.Equals(cleanFileName, fileName, StringComparison.Ordinal))
            {
                return BadRequest("Invalid file name.");
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var logosDir = plugin.GetStorageDirectory("studio-hub-logos");
            var fullPath = Path.Combine(logosDir, cleanFileName);
            if (!IOFile.Exists(fullPath))
            {
                return NotFound();
            }

            NoCache();
            return PhysicalFile(fullPath, GetImageMimeType(cleanFileName));
        }

        [HttpPost("video")]
        public async Task<IActionResult> UploadVideo([FromForm] string? name, [FromForm] IFormFile? file, CancellationToken ct)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }
            var adminUser = adminCheck.User ?? throw new InvalidOperationException("Admin user not available.");

            var cleanName = NormalizeCollectionName(name);
            if (string.IsNullOrWhiteSpace(cleanName))
            {
                return BadRequest(new { ok = false, error = "Koleksiyon adı gerekli." });
            }

            if (file is null || file.Length <= 0)
            {
                return BadRequest(new { ok = false, error = "Yüklenecek video gerekli." });
            }

            var ext = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(ext) || !AllowedVideoExtensions.Contains(ext, StringComparer.OrdinalIgnoreCase))
            {
                return BadRequest(new { ok = false, error = "Sadece mp4, webm, m4v veya mov videolar kabul edilir." });
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubVideoEntries ??= new();

            var videosDir = plugin.GetStorageDirectory("studio-hub-videos");
            var existing = cfg.StudioHubVideoEntries.FirstOrDefault(entry => NameEquals(entry?.Name, cleanName));
            var fileName = $"{SanitizeFileStem(cleanName)}-{Guid.NewGuid():N}{ext}";
            var targetPath = Path.Combine(videosDir, fileName);

            await using (var stream = new FileStream(targetPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await file.CopyToAsync(stream, ct).ConfigureAwait(false);
            }

            if (existing is not null)
            {
                DeleteLooseFile(videosDir, existing.FileName);
                cfg.StudioHubVideoEntries.Remove(existing);
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var entry = new StudioHubVideoEntry
            {
                Name = cleanName,
                FileName = fileName,
                UpdatedAtUtc = now,
                UpdatedBy = adminUser.Username,
                UpdatedByUserId = adminCheck.UserId.ToString("D")
            };

            cfg.StudioHubVideoEntries.Add(entry);
            cfg.StudioHubVideoEntries = cfg.StudioHubVideoEntries
                .OrderBy(x => NormalizeCollectionName(x?.Name), StringComparer.OrdinalIgnoreCase)
                .ToList();

            plugin.UpdateConfiguration(cfg);
            NoCache();
            return Ok(new { ok = true, entry, entries = cfg.StudioHubVideoEntries });
        }

        [HttpDelete("video")]
        public IActionResult DeleteVideo([FromQuery] string? name)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cleanName = NormalizeCollectionName(name);
            if (string.IsNullOrWhiteSpace(cleanName))
            {
                return BadRequest(new { ok = false, error = "Koleksiyon adı gerekli." });
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            cfg.StudioHubVideoEntries ??= new();

            var existing = cfg.StudioHubVideoEntries.FirstOrDefault(entry => NameEquals(entry?.Name, cleanName));
            if (existing is null)
            {
                return NotFound(new { ok = false, error = "Bu koleksiyon için kayıtlı hover video bulunamadı." });
            }

            var videosDir = plugin.GetStorageDirectory("studio-hub-videos");
            DeleteLooseFile(videosDir, existing.FileName);
            cfg.StudioHubVideoEntries.Remove(existing);
            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new { ok = true, entries = cfg.StudioHubVideoEntries });
        }

        [HttpGet("video")]
        public IActionResult GetVideos()
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            if (SanitizeStudioHubAssets(plugin, cfg))
            {
                plugin.UpdateConfiguration(cfg);
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                entries = cfg.StudioHubVideoEntries
            });
        }

        [HttpGet("video/{fileName}")]
        [HttpHead("video/{fileName}")]
        public IActionResult GetVideo(string fileName)
        {
            var cleanFileName = Path.GetFileName(fileName ?? string.Empty);
            if (string.IsNullOrWhiteSpace(cleanFileName) || !string.Equals(cleanFileName, fileName, StringComparison.Ordinal))
            {
                return BadRequest("Invalid file name.");
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var videosDir = plugin.GetStorageDirectory("studio-hub-videos");
            var fullPath = Path.Combine(videosDir, cleanFileName);
            if (!IOFile.Exists(fullPath))
            {
                return NotFound();
            }

            NoCache();
            return PhysicalFile(fullPath, GetMimeType(cleanFileName), enableRangeProcessing: true);
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
                return (null, Guid.Empty, StatusCode(403, new { ok = false, error = "Bu işlem sadece admin kullanıcılar içindir." }));
            }

            return userCheck;
        }

        private (User? User, Guid UserId, IActionResult? Result) TryGetRequestUser()
        {
            if (!TryGetRequestUserId(out var userId))
            {
                return (null, Guid.Empty, Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli." }));
            }

            var user = _users.GetUserById(userId);
            if (user is null)
            {
                return (null, Guid.Empty, Unauthorized(new { ok = false, error = "Kullanıcı bulunamadı." }));
            }

            return (user, userId, null);
        }

        private bool TryGetRequestUserId(out Guid userId)
        {
            var userIdHeader =
                Request.Headers["X-Emby-UserId"].FirstOrDefault() ??
                Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault();

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

        private static string NormalizeCollectionName(string? value)
        {
            return string.Join(" ", (value ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        }

        private static string NormalizeProfile(string? value)
        {
            var profile = (value ?? string.Empty).Trim().ToLowerInvariant();
            return profile == "mobile" || profile == "m" ? "mobile" : "desktop";
        }

        private static List<string> NormalizeHiddenNames(IEnumerable<string>? values)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var value in values ?? Array.Empty<string>())
            {
                var clean = NormalizeCollectionName(value);
                if (string.IsNullOrWhiteSpace(clean)) continue;
                if (!seen.Add(clean)) continue;
                result.Add(clean);
            }

            return result;
        }

        private static void RemoveCollectionNameFromVisibilityEntries(JMSFusionConfiguration cfg, string? collectionName)
        {
            cfg.StudioHubVisibilityEntries ??= new();

            var cleanCollectionName = NormalizeCollectionName(collectionName);
            if (string.IsNullOrWhiteSpace(cleanCollectionName))
            {
                return;
            }

            foreach (var entry in cfg.StudioHubVisibilityEntries)
            {
                if (entry is null)
                {
                    continue;
                }

                entry.HiddenNames = NormalizeHiddenNames(entry.HiddenNames)
                    .Where(name => !NameEquals(name, cleanCollectionName))
                    .ToList();

                entry.OrderNames = NormalizeHiddenNames(entry.OrderNames)
                    .Where(name => !NameEquals(name, cleanCollectionName))
                    .ToList();
            }

            cfg.StudioHubVisibilityEntries = cfg.StudioHubVisibilityEntries
                .Where(item =>
                    !string.IsNullOrWhiteSpace(item?.UserId) &&
                    (NormalizeHiddenNames(item?.HiddenNames).Count > 0 || NormalizeHiddenNames(item?.OrderNames).Count > 0))
                .GroupBy(
                    item => $"{item!.UserId}|{NormalizeProfile(item.Profile)}",
                    StringComparer.OrdinalIgnoreCase)
                .Select(group => group.OrderByDescending(item => item?.UpdatedAtUtc ?? 0L).First())
                .OrderBy(item => item?.UserId, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => NormalizeProfile(item?.Profile), StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static HashSet<string> BuildAllowedStudioHubNameSet(JMSFusionConfiguration cfg)
        {
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var name in DefaultStudioHubNames)
            {
                var clean = NormalizeCollectionName(name);
                if (!string.IsNullOrWhiteSpace(clean))
                {
                    allowed.Add(clean);
                }
            }

            foreach (var entry in cfg.StudioHubManualEntries ?? new List<StudioHubManualEntry>())
            {
                var clean = NormalizeCollectionName(entry?.Name);
                if (!string.IsNullOrWhiteSpace(clean))
                {
                    allowed.Add(clean);
                }
            }

            return allowed;
        }

        private static List<string> SanitizeVisibilityNames(IEnumerable<string>? values, HashSet<string> allowedNames)
        {
            return NormalizeHiddenNames(values)
                .Where(name => allowedNames.Contains(name))
                .ToList();
        }

        private static bool SanitizeStudioHubVisibilityEntries(JMSFusionConfiguration cfg)
        {
            cfg.StudioHubManualEntries ??= new();
            cfg.StudioHubVisibilityEntries ??= new();

            var changed = false;
            var allowedNames = BuildAllowedStudioHubNameSet(cfg);

            foreach (var entry in cfg.StudioHubVisibilityEntries)
            {
                if (entry is null)
                {
                    continue;
                }

                var nextHidden = SanitizeVisibilityNames(entry.HiddenNames, allowedNames);
                var nextOrder = SanitizeVisibilityNames(entry.OrderNames, allowedNames);

                if (!Enumerable.SequenceEqual(nextHidden, entry.HiddenNames ?? new List<string>(), StringComparer.OrdinalIgnoreCase))
                {
                    entry.HiddenNames = nextHidden;
                    changed = true;
                }

                if (!Enumerable.SequenceEqual(nextOrder, entry.OrderNames ?? new List<string>(), StringComparer.OrdinalIgnoreCase))
                {
                    entry.OrderNames = nextOrder;
                    changed = true;
                }
            }

            var nextEntries = cfg.StudioHubVisibilityEntries
                .Where(item =>
                    !string.IsNullOrWhiteSpace(item?.UserId) &&
                    (NormalizeHiddenNames(item?.HiddenNames).Count > 0 || NormalizeHiddenNames(item?.OrderNames).Count > 0))
                .GroupBy(
                    item => $"{item!.UserId}|{NormalizeProfile(item.Profile)}",
                    StringComparer.OrdinalIgnoreCase)
                .Select(group => group.OrderByDescending(item => item?.UpdatedAtUtc ?? 0L).First())
                .OrderBy(item => item?.UserId, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => NormalizeProfile(item?.Profile), StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (nextEntries.Count != cfg.StudioHubVisibilityEntries.Count)
            {
                changed = true;
            }
            else
            {
                for (var i = 0; i < nextEntries.Count; i++)
                {
                    if (!ReferenceEquals(nextEntries[i], cfg.StudioHubVisibilityEntries[i]))
                    {
                        changed = true;
                        break;
                    }
                }
            }

            cfg.StudioHubVisibilityEntries = nextEntries;
            return changed;
        }

        private static string NormalizeId(string? value)
        {
            return string.Join(string.Empty, (value ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        }

        private static bool NameEquals(string? left, string? right)
        {
            return string.Equals(
                NormalizeCollectionName(left),
                NormalizeCollectionName(right),
                StringComparison.OrdinalIgnoreCase);
        }

        private static bool IdEquals(string? left, string? right)
        {
            return string.Equals(
                NormalizeId(left),
                NormalizeId(right),
                StringComparison.OrdinalIgnoreCase);
        }

        private static string SanitizeFileStem(string value)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var chars = NormalizeCollectionName(value)
                .Select(ch => invalid.Contains(ch) ? '-' : ch)
                .ToArray();

            var sanitized = new string(chars)
                .Replace(' ', '-')
                .Replace("--", "-")
                .Trim('-', '.');

            return string.IsNullOrWhiteSpace(sanitized) ? "studio-hub" : sanitized.ToLowerInvariant();
        }

        private static void DeleteLooseFile(string rootDir, string? fileName)
        {
            try
            {
                var cleanFileName = Path.GetFileName(fileName ?? string.Empty);
                if (string.IsNullOrWhiteSpace(cleanFileName))
                {
                    return;
                }

                var fullPath = Path.Combine(rootDir, cleanFileName);
                if (IOFile.Exists(fullPath))
                {
                    IOFile.Delete(fullPath);
                }
            }
            catch
            {
            }
        }

        private static bool SanitizeStudioHubAssets(JMSFusionPlugin plugin, JMSFusionConfiguration cfg)
        {
            cfg.StudioHubManualEntries ??= new();
            cfg.StudioHubVideoEntries ??= new();

            var changed = false;
            var logosDir = plugin.GetStorageDirectory("studio-hub-logos");
            var videosDir = plugin.GetStorageDirectory("studio-hub-videos");

            foreach (var entry in cfg.StudioHubManualEntries)
            {
                var cleanLogoName = Path.GetFileName(entry?.LogoFileName ?? string.Empty);
                if (string.IsNullOrWhiteSpace(cleanLogoName))
                {
                    if (!string.IsNullOrWhiteSpace(entry?.LogoFileName))
                    {
                        entry!.LogoFileName = null;
                        changed = true;
                    }
                    continue;
                }

                var fullLogoPath = Path.Combine(logosDir, cleanLogoName);
                if (!IOFile.Exists(fullLogoPath))
                {
                    entry!.LogoFileName = null;
                    changed = true;
                }
                else if (!string.Equals(cleanLogoName, entry!.LogoFileName, StringComparison.Ordinal))
                {
                    entry.LogoFileName = cleanLogoName;
                    changed = true;
                }
            }

            var sanitizedVideos = new List<StudioHubVideoEntry>();
            foreach (var entry in cfg.StudioHubVideoEntries)
            {
                var cleanName = NormalizeCollectionName(entry?.Name);
                var cleanFileName = Path.GetFileName(entry?.FileName ?? string.Empty);
                if (string.IsNullOrWhiteSpace(cleanName) || string.IsNullOrWhiteSpace(cleanFileName))
                {
                    changed = true;
                    continue;
                }

                var fullVideoPath = Path.Combine(videosDir, cleanFileName);
                if (!IOFile.Exists(fullVideoPath))
                {
                    changed = true;
                    continue;
                }

                if (!string.Equals(cleanName, entry!.Name, StringComparison.Ordinal))
                {
                    entry.Name = cleanName;
                    changed = true;
                }

                if (!string.Equals(cleanFileName, entry.FileName, StringComparison.Ordinal))
                {
                    entry.FileName = cleanFileName;
                    changed = true;
                }

                sanitizedVideos.Add(entry);
            }

            if (sanitizedVideos.Count != cfg.StudioHubVideoEntries.Count)
            {
                cfg.StudioHubVideoEntries = sanitizedVideos
                    .OrderBy(x => NormalizeCollectionName(x?.Name), StringComparer.OrdinalIgnoreCase)
                    .ToList();
                changed = true;
            }

            return changed;
        }

        private static string GetImageMimeType(string fileName)
        {
            var ext = Path.GetExtension(fileName).ToLowerInvariant();
            return ext switch
            {
                ".svg" => "image/svg+xml",
                ".webp" => "image/webp",
                ".jpg" => "image/jpeg",
                ".jpeg" => "image/jpeg",
                _ => "image/png"
            };
        }

        private static string GetMimeType(string fileName)
        {
            var ext = Path.GetExtension(fileName).ToLowerInvariant();
            return ext switch
            {
                ".webm" => "video/webm",
                ".m4v" => "video/mp4",
                ".mov" => "video/quicktime",
                _ => "video/mp4"
            };
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }
    }
}
