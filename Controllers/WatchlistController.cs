using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/watchlist")]
    [Route("Plugins/JMSFusion/watchlist")]
    public class WatchlistController : ControllerBase
    {
        private static readonly object SyncRoot = new();
        private const int MaxItemsPerUser = 500;
        private const int MaxSharesPerOwner = 2000;
        private const int MaxNoteLength = 600;

        public sealed class AddItemRequest
        {
            public string? ItemId { get; set; }
            public string? ItemType { get; set; }
            public string? Name { get; set; }
            public string? Overview { get; set; }
            public int? ProductionYear { get; set; }
            public long? RunTimeTicks { get; set; }
            public double? CommunityRating { get; set; }
            public string? OfficialRating { get; set; }
            public List<string>? Genres { get; set; }
            public string? AlbumArtist { get; set; }
            public List<string>? Artists { get; set; }
            public string? ParentName { get; set; }
        }

        public sealed class ShareItemRequest
        {
            public string? ItemId { get; set; }
            public List<ShareTargetDto>? Targets { get; set; }
            public string? Note { get; set; }
        }

        public sealed class ShareTargetDto
        {
            public string? UserId { get; set; }
            public string? UserName { get; set; }
        }

        private sealed class UserContext
        {
            public string UserId { get; init; } = "";
            public string UserName { get; init; } = "";
        }

        [HttpGet]
        public IActionResult GetDashboard()
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);
                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                var myItems = cfg.WatchlistEntries
                    .Where(entry => Same(entry.OwnerUserId, user.UserId))
                    .OrderByDescending(entry => entry.AddedAtUtc)
                    .ToList();

                var entryById = cfg.WatchlistEntries
                    .Where(entry => !string.IsNullOrWhiteSpace(entry.Id))
                    .GroupBy(entry => entry.Id!, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

                var sharedWithMe = cfg.WatchlistShares
                    .Where(share => Same(share.TargetUserId, user.UserId))
                    .OrderByDescending(share => share.SharedAtUtc)
                    .Select(share => new
                    {
                        share.Id,
                        share.ItemId,
                        share.Note,
                        share.SharedAtUtc,
                        share.OwnerUserId,
                        share.OwnerUserName,
                        share.TargetUserId,
                        share.TargetUserName,
                        Entry = ResolveSharedEntry(share, entryById)
                    })
                    .Where(row => row.Entry is not null)
                    .ToList();

                var outgoingShares = cfg.WatchlistShares
                    .Where(share => Same(share.OwnerUserId, user.UserId))
                    .OrderByDescending(share => share.SharedAtUtc)
                    .Select(share => new
                    {
                        share.Id,
                        share.ItemId,
                        share.Note,
                        share.SharedAtUtc,
                        share.TargetUserId,
                        share.TargetUserName,
                        Entry = ResolveSharedEntry(share, entryById)
                    })
                    .Where(row => row.Entry is not null)
                    .ToList();

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.WatchlistRevision,
                    myItems,
                    sharedWithMe,
                    outgoingShares
                });
            }
        }

        [HttpPost("items")]
        public IActionResult AddItem([FromBody] AddItemRequest req)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var itemId = Clean(req.ItemId);
            if (string.IsNullOrWhiteSpace(itemId))
            {
                return BadRequest(new { ok = false, error = "itemId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);

                var existing = cfg.WatchlistEntries.FirstOrDefault(entry =>
                    Same(entry.OwnerUserId, user.UserId) &&
                    Same(entry.ItemId, itemId));

                if (existing is null)
                {
                    existing = new WatchlistEntry
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        ItemId = itemId,
                        AddedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        OwnerUserId = user.UserId,
                        OwnerUserName = user.UserName
                    };
                    cfg.WatchlistEntries.Add(existing);
                    changed = true;
                }

                changed |= ApplySnapshot(existing, req, user);
                changed |= TrimOwnerItems(cfg, user.UserId);

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    inWatchlist = true,
                    revision = cfg.WatchlistRevision,
                    item = existing
                });
            }
        }

        [HttpDelete("items/{itemId}")]
        public IActionResult RemoveItem(string itemId)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var cleanItemId = Clean(itemId);
            if (string.IsNullOrWhiteSpace(cleanItemId))
            {
                return BadRequest(new { ok = false, error = "itemId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);

                var hasOwnEntry = cfg.WatchlistEntries.Any(entry =>
                    Same(entry.OwnerUserId, user.UserId) &&
                    Same(entry.ItemId, cleanItemId));

                if (hasOwnEntry)
                {
                    changed |= cfg.WatchlistEntries.RemoveAll(entry =>
                        Same(entry.OwnerUserId, user.UserId) &&
                        Same(entry.ItemId, cleanItemId)) > 0;
                }
                else
                {
                    changed |= cfg.WatchlistShares.RemoveAll(share =>
                        Same(share.TargetUserId, user.UserId) &&
                        Same(share.ItemId, cleanItemId)) > 0;
                }

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    inWatchlist = false,
                    revision = cfg.WatchlistRevision
                });
            }
        }

        [HttpPost("shares")]
        public IActionResult ShareItem([FromBody] ShareItemRequest req)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var itemId = Clean(req.ItemId);
            if (string.IsNullOrWhiteSpace(itemId))
            {
                return BadRequest(new { ok = false, error = "itemId gerekli" });
            }

            var targets = (req.Targets ?? new List<ShareTargetDto>())
                .Select(target => new
                {
                    UserId = Clean(target.UserId),
                    UserName = Clean(target.UserName)
                })
                .Where(target => !string.IsNullOrWhiteSpace(target.UserId) && !Same(target.UserId, user.UserId))
                .GroupBy(target => target.UserId!, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToList();

            if (targets.Count == 0)
            {
                return BadRequest(new { ok = false, error = "En az bir kullanıcı seçilmeli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);

                var entry = cfg.WatchlistEntries.FirstOrDefault(candidate =>
                    Same(candidate.OwnerUserId, user.UserId) &&
                    Same(candidate.ItemId, itemId));

                if (entry is null)
                {
                    return NotFound(new { ok = false, error = "Öğe watchlist içinde bulunamadı" });
                }

                var note = NormalizeNote(req.Note);
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                foreach (var target in targets)
                {
                    var share = cfg.WatchlistShares.FirstOrDefault(candidate =>
                        Same(candidate.OwnerUserId, user.UserId) &&
                        Same(candidate.TargetUserId, target.UserId) &&
                        Same(candidate.ItemId, itemId));

                    if (share is null)
                    {
                        share = new WatchlistShareEntry
                        {
                            Id = Guid.NewGuid().ToString("N"),
                            WatchlistEntryId = entry.Id,
                            ItemId = entry.ItemId,
                            OwnerUserId = user.UserId,
                            OwnerUserName = user.UserName,
                            TargetUserId = target.UserId,
                            TargetUserName = target.UserName,
                            Note = note,
                            SharedAtUtc = now
                        };
                        cfg.WatchlistShares.Add(share);
                        changed = true;
                    }

                    if (!Same(share.WatchlistEntryId, entry.Id)) { share.WatchlistEntryId = entry.Id; changed = true; }
                    if (!Same(share.OwnerUserName, user.UserName)) { share.OwnerUserName = user.UserName; changed = true; }
                    if (!Same(share.TargetUserName, target.UserName) && !string.IsNullOrWhiteSpace(target.UserName))
                    {
                        share.TargetUserName = target.UserName;
                        changed = true;
                    }
                    if (!Same(share.Note, note)) { share.Note = note; changed = true; }
                    if (share.SharedAtUtc != now) { share.SharedAtUtc = now; changed = true; }
                    changed |= ApplyShareSnapshot(share, entry);
                }

                changed |= TrimOwnerShares(cfg, user.UserId);

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.WatchlistRevision,
                    sharedCount = targets.Count
                });
            }
        }

        [HttpDelete("shares/{shareId}")]
        public IActionResult RemoveShare(string shareId)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var cleanShareId = Clean(shareId);
            if (string.IsNullOrWhiteSpace(cleanShareId))
            {
                return BadRequest(new { ok = false, error = "shareId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);

                var share = cfg.WatchlistShares.FirstOrDefault(candidate => Same(candidate.Id, cleanShareId));
                if (share is null)
                {
                    return NotFound(new { ok = false, error = "Paylaşım bulunamadı" });
                }

                if (!Same(share.OwnerUserId, user.UserId) && !Same(share.TargetUserId, user.UserId))
                {
                    return StatusCode(403, new { ok = false, error = "Bu paylaşımı kaldıramazsın" });
                }

                changed |= cfg.WatchlistShares.RemoveAll(candidate => Same(candidate.Id, cleanShareId)) > 0;

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.WatchlistRevision
                });
            }
        }

        private static object? ResolveSharedEntry(
            WatchlistShareEntry share,
            IReadOnlyDictionary<string, WatchlistEntry> entryById)
        {
            var entryId = Clean(share.WatchlistEntryId);
            if (!string.IsNullOrWhiteSpace(entryId) && entryById.TryGetValue(entryId, out var entry))
            {
                return entry;
            }

            return HasShareSnapshot(share) ? share.EntrySnapshot : null;
        }

        private static bool ApplySnapshot(WatchlistEntry entry, AddItemRequest req, UserContext user)
        {
            var changed = false;
            var itemType = Clean(req.ItemType);
            var name = Clean(req.Name);
            var overview = Clean(req.Overview);
            var officialRating = Clean(req.OfficialRating);
            var albumArtist = Clean(req.AlbumArtist);
            var parentName = Clean(req.ParentName);

            if (!Same(entry.ItemType, itemType))
            {
                entry.ItemType = itemType;
                changed = true;
            }

            if (!Same(entry.Name, name))
            {
                entry.Name = name;
                changed = true;
            }

            if (!Same(entry.Overview, overview))
            {
                entry.Overview = overview;
                changed = true;
            }

            if (!Same(entry.OfficialRating, officialRating))
            {
                entry.OfficialRating = officialRating;
                changed = true;
            }

            if (!Same(entry.AlbumArtist, albumArtist))
            {
                entry.AlbumArtist = albumArtist;
                changed = true;
            }

            if (!Same(entry.ParentName, parentName))
            {
                entry.ParentName = parentName;
                changed = true;
            }

            if (!string.IsNullOrWhiteSpace(user.UserName) && !Same(entry.OwnerUserName, user.UserName))
            {
                entry.OwnerUserName = user.UserName;
                changed = true;
            }

            if (entry.ProductionYear != req.ProductionYear)
            {
                entry.ProductionYear = req.ProductionYear;
                changed = true;
            }

            if (entry.RunTimeTicks != req.RunTimeTicks)
            {
                entry.RunTimeTicks = req.RunTimeTicks;
                changed = true;
            }

            if (entry.CommunityRating != req.CommunityRating)
            {
                entry.CommunityRating = req.CommunityRating;
                changed = true;
            }

            var genres = NormalizeStringList(req.Genres);
            if (!ListsEqual(entry.Genres, genres))
            {
                entry.Genres = genres;
                changed = true;
            }

            var artists = NormalizeStringList(req.Artists);
            if (!ListsEqual(entry.Artists, artists))
            {
                entry.Artists = artists;
                changed = true;
            }

            return changed;
        }

        private static bool TrimOwnerItems(JMSFusionConfiguration cfg, string ownerUserId)
        {
            var ownerItems = cfg.WatchlistEntries
                .Where(entry => Same(entry.OwnerUserId, ownerUserId))
                .OrderByDescending(entry => entry.AddedAtUtc)
                .ToList();

            if (ownerItems.Count <= MaxItemsPerUser) return false;

            var removeIds = ownerItems
                .Skip(MaxItemsPerUser)
                .Select(entry => Clean(entry.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var removed = cfg.WatchlistEntries.RemoveAll(entry =>
                Same(entry.OwnerUserId, ownerUserId) &&
                removeIds.Contains(Clean(entry.Id))) > 0;

            return removed;
        }

        private static bool TrimOwnerShares(JMSFusionConfiguration cfg, string ownerUserId)
        {
            var shares = cfg.WatchlistShares
                .Where(share => Same(share.OwnerUserId, ownerUserId))
                .OrderByDescending(share => share.SharedAtUtc)
                .ToList();

            if (shares.Count <= MaxSharesPerOwner) return false;

            var removeIds = shares
                .Skip(MaxSharesPerOwner)
                .Select(share => Clean(share.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            return cfg.WatchlistShares.RemoveAll(share =>
                Same(share.OwnerUserId, ownerUserId) &&
                removeIds.Contains(Clean(share.Id))) > 0;
        }

        private static bool NormalizeConfig(JMSFusionConfiguration cfg)
        {
            var changed = false;

            cfg.WatchlistEntries ??= new List<WatchlistEntry>();
            cfg.WatchlistShares ??= new List<WatchlistShareEntry>();

            var uniqueEntries = new Dictionary<string, WatchlistEntry>(StringComparer.OrdinalIgnoreCase);
            var normalizedEntries = new List<WatchlistEntry>();

            foreach (var raw in cfg.WatchlistEntries)
            {
                if (raw is null) { changed = true; continue; }

                var entry = NormalizeEntry(raw);
                if (string.IsNullOrWhiteSpace(entry.ItemId) || string.IsNullOrWhiteSpace(entry.OwnerUserId))
                {
                    changed = true;
                    continue;
                }

                var dedupeKey = $"{entry.OwnerUserId}::{entry.ItemId}";
                if (uniqueEntries.TryGetValue(dedupeKey, out var existing))
                {
                    if (MergeEntry(existing, entry)) changed = true;
                    changed = true;
                    continue;
                }

                uniqueEntries[dedupeKey] = entry;
                normalizedEntries.Add(entry);
                if (!ReferenceEquals(raw, entry)) changed = true;
            }

            cfg.WatchlistEntries = normalizedEntries;

            var validEntryIds = normalizedEntries
                .Select(entry => Clean(entry.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var entryById = normalizedEntries
                .Where(entry => !string.IsNullOrWhiteSpace(entry.Id))
                .GroupBy(entry => entry.Id!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

            var uniqueShares = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var normalizedShares = new List<WatchlistShareEntry>();

            foreach (var raw in cfg.WatchlistShares)
            {
                if (raw is null) { changed = true; continue; }

                var share = NormalizeShare(raw);
                if (NormalizeShareSnapshot(share)) changed = true;

                var hasValidEntryRef =
                    !string.IsNullOrWhiteSpace(share.WatchlistEntryId) &&
                    validEntryIds.Contains(share.WatchlistEntryId);

                if (hasValidEntryRef &&
                    entryById.TryGetValue(share.WatchlistEntryId!, out var linkedEntry) &&
                    ApplyShareSnapshot(share, linkedEntry))
                {
                    changed = true;
                }

                if (string.IsNullOrWhiteSpace(share.Id) ||
                    string.IsNullOrWhiteSpace(share.ItemId) ||
                    string.IsNullOrWhiteSpace(share.OwnerUserId) ||
                    string.IsNullOrWhiteSpace(share.TargetUserId) ||
                    (!hasValidEntryRef && !HasShareSnapshot(share)))
                {
                    changed = true;
                    continue;
                }

                var dedupeKey = $"{share.OwnerUserId}::{share.TargetUserId}::{share.ItemId}";
                if (!uniqueShares.Add(dedupeKey))
                {
                    changed = true;
                    continue;
                }

                normalizedShares.Add(share);
                if (!ReferenceEquals(raw, share)) changed = true;
            }

            cfg.WatchlistShares = normalizedShares;

            return changed;
        }

        private static WatchlistEntry NormalizeEntry(WatchlistEntry source)
        {
            source.Id = Clean(source.Id);
            if (string.IsNullOrWhiteSpace(source.Id))
            {
                source.Id = Guid.NewGuid().ToString("N");
            }

            source.ItemId = Clean(source.ItemId);
            source.ItemType = Clean(source.ItemType);
            source.Name = Clean(source.Name);
            source.Overview = Clean(source.Overview);
            source.OfficialRating = Clean(source.OfficialRating);
            source.AlbumArtist = Clean(source.AlbumArtist);
            source.ParentName = Clean(source.ParentName);
            source.OwnerUserId = Clean(source.OwnerUserId);
            source.OwnerUserName = Clean(source.OwnerUserName);
            source.Genres = NormalizeStringList(source.Genres);
            source.Artists = NormalizeStringList(source.Artists);
            if (source.AddedAtUtc <= 0) source.AddedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return source;
        }

        private static WatchlistShareEntry NormalizeShare(WatchlistShareEntry source)
        {
            source.Id = Clean(source.Id);
            if (string.IsNullOrWhiteSpace(source.Id))
            {
                source.Id = Guid.NewGuid().ToString("N");
            }

            source.WatchlistEntryId = Clean(source.WatchlistEntryId);
            source.ItemId = Clean(source.ItemId);
            source.OwnerUserId = Clean(source.OwnerUserId);
            source.OwnerUserName = Clean(source.OwnerUserName);
            source.TargetUserId = Clean(source.TargetUserId);
            source.TargetUserName = Clean(source.TargetUserName);
            source.Note = NormalizeNote(source.Note);
            if (source.SharedAtUtc <= 0) source.SharedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return source;
        }

        private static bool ApplyShareSnapshot(WatchlistShareEntry share, WatchlistEntry entry)
        {
            var snapshot = CreateShareSnapshot(entry, share);
            if (EntriesEqual(share.EntrySnapshot, snapshot))
            {
                return false;
            }

            share.EntrySnapshot = snapshot;
            return true;
        }

        private static bool NormalizeShareSnapshot(WatchlistShareEntry share)
        {
            if (share.EntrySnapshot is null)
            {
                return false;
            }

            var snapshot = CreateShareSnapshot(share.EntrySnapshot, share);
            if (EntriesEqual(share.EntrySnapshot, snapshot))
            {
                return false;
            }

            share.EntrySnapshot = snapshot;
            return true;
        }

        private static bool HasShareSnapshot(WatchlistShareEntry share)
        {
            return !string.IsNullOrWhiteSpace(Clean(share.EntrySnapshot?.ItemId));
        }

        private static WatchlistEntry CreateShareSnapshot(WatchlistEntry source, WatchlistShareEntry share)
        {
            var snapshot = CloneEntry(source);
            var snapshotId = Clean(share.WatchlistEntryId);
            if (!string.IsNullOrWhiteSpace(snapshotId))
            {
                snapshot.Id = snapshotId;
            }

            snapshot.ItemId = Clean(share.ItemId);
            snapshot.OwnerUserId = Clean(share.OwnerUserId);
            if (!string.IsNullOrWhiteSpace(Clean(share.OwnerUserName)))
            {
                snapshot.OwnerUserName = Clean(share.OwnerUserName);
            }

            NormalizeEntry(snapshot);
            return snapshot;
        }

        private static WatchlistEntry CloneEntry(WatchlistEntry source)
        {
            return new WatchlistEntry
            {
                Id = Clean(source.Id),
                ItemId = Clean(source.ItemId),
                ItemType = Clean(source.ItemType),
                Name = Clean(source.Name),
                Overview = Clean(source.Overview),
                ProductionYear = source.ProductionYear,
                RunTimeTicks = source.RunTimeTicks,
                CommunityRating = source.CommunityRating,
                OfficialRating = Clean(source.OfficialRating),
                Genres = NormalizeStringList(source.Genres),
                AlbumArtist = Clean(source.AlbumArtist),
                Artists = NormalizeStringList(source.Artists),
                ParentName = Clean(source.ParentName),
                AddedAtUtc = source.AddedAtUtc,
                OwnerUserId = Clean(source.OwnerUserId),
                OwnerUserName = Clean(source.OwnerUserName)
            };
        }

        private static bool MergeEntry(WatchlistEntry target, WatchlistEntry incoming)
        {
            var changed = false;

            if (incoming.AddedAtUtc > target.AddedAtUtc)
            {
                target.AddedAtUtc = incoming.AddedAtUtc;
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.Name)) && !string.IsNullOrWhiteSpace(Clean(incoming.Name)))
            {
                target.Name = Clean(incoming.Name);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.Overview)) && !string.IsNullOrWhiteSpace(Clean(incoming.Overview)))
            {
                target.Overview = Clean(incoming.Overview);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.ItemType)) && !string.IsNullOrWhiteSpace(Clean(incoming.ItemType)))
            {
                target.ItemType = Clean(incoming.ItemType);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.OfficialRating)) && !string.IsNullOrWhiteSpace(Clean(incoming.OfficialRating)))
            {
                target.OfficialRating = Clean(incoming.OfficialRating);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.AlbumArtist)) && !string.IsNullOrWhiteSpace(Clean(incoming.AlbumArtist)))
            {
                target.AlbumArtist = Clean(incoming.AlbumArtist);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.ParentName)) && !string.IsNullOrWhiteSpace(Clean(incoming.ParentName)))
            {
                target.ParentName = Clean(incoming.ParentName);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.OwnerUserName)) && !string.IsNullOrWhiteSpace(Clean(incoming.OwnerUserName)))
            {
                target.OwnerUserName = Clean(incoming.OwnerUserName);
                changed = true;
            }

            if (!target.ProductionYear.HasValue && incoming.ProductionYear.HasValue)
            {
                target.ProductionYear = incoming.ProductionYear;
                changed = true;
            }

            if (!target.RunTimeTicks.HasValue && incoming.RunTimeTicks.HasValue)
            {
                target.RunTimeTicks = incoming.RunTimeTicks;
                changed = true;
            }

            if (!target.CommunityRating.HasValue && incoming.CommunityRating.HasValue)
            {
                target.CommunityRating = incoming.CommunityRating;
                changed = true;
            }

            if (target.Genres.Count == 0 && incoming.Genres.Count > 0)
            {
                target.Genres = incoming.Genres;
                changed = true;
            }

            if (target.Artists.Count == 0 && incoming.Artists.Count > 0)
            {
                target.Artists = incoming.Artists;
                changed = true;
            }

            return changed;
        }

        private static bool EntriesEqual(WatchlistEntry? left, WatchlistEntry? right)
        {
            if (left is null || right is null)
            {
                return left is null && right is null;
            }

            return
                Same(left.Id, right.Id) &&
                Same(left.ItemId, right.ItemId) &&
                Same(left.ItemType, right.ItemType) &&
                Same(left.Name, right.Name) &&
                Same(left.Overview, right.Overview) &&
                left.ProductionYear == right.ProductionYear &&
                left.RunTimeTicks == right.RunTimeTicks &&
                left.CommunityRating == right.CommunityRating &&
                Same(left.OfficialRating, right.OfficialRating) &&
                ListsEqual(left.Genres, right.Genres) &&
                Same(left.AlbumArtist, right.AlbumArtist) &&
                ListsEqual(left.Artists, right.Artists) &&
                Same(left.ParentName, right.ParentName) &&
                left.AddedAtUtc == right.AddedAtUtc &&
                Same(left.OwnerUserId, right.OwnerUserId) &&
                Same(left.OwnerUserName, right.OwnerUserName);
        }

        private static List<string> NormalizeStringList(IEnumerable<string?>? list)
        {
            return (list ?? Array.Empty<string?>())
                .Select(Clean)
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static string NormalizeNote(string? note)
        {
            var clean = Clean(note);
            if (clean.Length <= MaxNoteLength) return clean;
            return clean[..MaxNoteLength];
        }

        private static void TouchRevision(JMSFusionConfiguration cfg)
        {
            cfg.WatchlistRevision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        private UserContext ReadUserContext()
        {
            var userId =
                Request.Headers["X-Emby-UserId"].FirstOrDefault() ??
                Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault() ??
                "";

            var userName =
                Request.Headers["X-JMSFusion-UserName"].FirstOrDefault() ??
                Request.Headers["X-Emby-UserName"].FirstOrDefault() ??
                "";

            return new UserContext
            {
                UserId = Clean(userId),
                UserName = Clean(userName)
            };
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        private static bool ListsEqual(IReadOnlyList<string>? left, IReadOnlyList<string>? right)
        {
            var l = left ?? Array.Empty<string>();
            var r = right ?? Array.Empty<string>();
            if (l.Count != r.Count) return false;
            for (var i = 0; i < l.Count; i++)
            {
                if (!Same(l[i], r[i])) return false;
            }
            return true;
        }

        private static bool Same(string? left, string? right)
        {
            return string.Equals(Clean(left), Clean(right), StringComparison.OrdinalIgnoreCase);
        }

        private static string Clean(string? value)
        {
            return (value ?? "").Trim();
        }

    }
}
