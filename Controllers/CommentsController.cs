using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/comments")]
    [Route("Plugins/JMSFusion/comments")]
    public class CommentsController : ControllerBase
    {
        private static readonly object SyncRoot = new();
        private const int MaxCommentLength = 2000;
        private const int MaxCommentsPerItem = 200;
        private const int MaxCommentsTotal = 4000;

        public sealed class UpsertCommentRequest
        {
            public string? Content { get; set; }
        }

        private sealed class UserContext
        {
            public string UserId { get; init; } = "";
            public string UserName { get; init; } = "";
        }

        [HttpGet("items/{itemId}")]
        public IActionResult GetItemComments(string itemId)
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

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                var comments = cfg.ItemComments
                    .Where(comment => Same(comment.ItemId, cleanItemId))
                    .OrderByDescending(CommentSortTimestamp)
                    .ThenByDescending(comment => comment.CreatedAtUtc)
                    .ToList();

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.ItemCommentsRevision,
                    itemId = cleanItemId,
                    comments
                });
            }
        }

        [HttpPost("items/{itemId}")]
        public IActionResult UpsertItemComment(string itemId, [FromBody] UpsertCommentRequest req)
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

            var content = NormalizeContent(req?.Content);
            if (string.IsNullOrWhiteSpace(content))
            {
                return BadRequest(new { ok = false, error = "content gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                var comment = cfg.ItemComments.FirstOrDefault(entry =>
                    Same(entry.ItemId, cleanItemId) &&
                    Same(entry.OwnerUserId, user.UserId));

                if (comment is null)
                {
                    comment = new ItemCommentEntry
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        ItemId = cleanItemId,
                        Content = content,
                        OwnerUserId = user.UserId,
                        OwnerUserName = user.UserName,
                        CreatedAtUtc = now,
                        UpdatedAtUtc = now
                    };
                    cfg.ItemComments.Add(comment);
                    changed = true;
                }
                else
                {
                    if (!Same(comment.Content, content))
                    {
                        comment.Content = content;
                        comment.UpdatedAtUtc = now;
                        changed = true;
                    }

                    if (comment.CreatedAtUtc <= 0)
                    {
                        comment.CreatedAtUtc = now;
                        changed = true;
                    }

                    if (comment.UpdatedAtUtc <= 0)
                    {
                        comment.UpdatedAtUtc = now;
                        changed = true;
                    }

                    if (!string.IsNullOrWhiteSpace(user.UserName) && !Same(comment.OwnerUserName, user.UserName))
                    {
                        comment.OwnerUserName = user.UserName;
                        changed = true;
                    }
                }

                changed |= TrimCommentsForItem(cfg, cleanItemId);
                changed |= TrimTotalComments(cfg);

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.ItemCommentsRevision,
                    comment
                });
            }
        }

        [HttpDelete("{commentId}")]
        public IActionResult DeleteComment(string commentId)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var cleanCommentId = Clean(commentId);
            if (string.IsNullOrWhiteSpace(cleanCommentId))
            {
                return BadRequest(new { ok = false, error = "commentId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);

                var comment = cfg.ItemComments.FirstOrDefault(entry => Same(entry.Id, cleanCommentId));
                if (comment is null)
                {
                    return NotFound(new { ok = false, error = "yorum bulunamadı" });
                }

                if (!Same(comment.OwnerUserId, user.UserId))
                {
                    return Forbid();
                }

                changed |= cfg.ItemComments.RemoveAll(entry => Same(entry.Id, cleanCommentId)) > 0;

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    deleted = true,
                    revision = cfg.ItemCommentsRevision
                });
            }
        }

        private static bool NormalizeConfig(JMSFusionConfiguration cfg)
        {
            var changed = false;

            cfg.ItemComments ??= new List<ItemCommentEntry>();

            var deduped = new Dictionary<string, ItemCommentEntry>(StringComparer.OrdinalIgnoreCase);

            foreach (var raw in cfg.ItemComments)
            {
                if (raw is null)
                {
                    changed = true;
                    continue;
                }

                var comment = NormalizeComment(raw);
                if (string.IsNullOrWhiteSpace(comment.Id) ||
                    string.IsNullOrWhiteSpace(comment.ItemId) ||
                    string.IsNullOrWhiteSpace(comment.OwnerUserId) ||
                    string.IsNullOrWhiteSpace(comment.Content))
                {
                    changed = true;
                    continue;
                }

                var dedupeKey = $"{comment.OwnerUserId}::{comment.ItemId}";
                if (deduped.TryGetValue(dedupeKey, out var existing))
                {
                    if (CommentSortTimestamp(comment) >= CommentSortTimestamp(existing))
                    {
                        deduped[dedupeKey] = comment;
                    }

                    changed = true;
                    continue;
                }

                deduped[dedupeKey] = comment;
                if (!ReferenceEquals(raw, comment)) changed = true;
            }

            var normalized = deduped.Values
                .OrderByDescending(CommentSortTimestamp)
                .ThenByDescending(comment => comment.CreatedAtUtc)
                .ToList();

            if (cfg.ItemComments.Count != normalized.Count)
            {
                changed = true;
            }

            cfg.ItemComments = normalized;
            return changed;
        }

        private static ItemCommentEntry NormalizeComment(ItemCommentEntry source)
        {
            source.Id = Clean(source.Id);
            if (string.IsNullOrWhiteSpace(source.Id))
            {
                source.Id = Guid.NewGuid().ToString("N");
            }

            source.ItemId = Clean(source.ItemId);
            source.Content = NormalizeContent(source.Content);
            source.OwnerUserId = Clean(source.OwnerUserId);
            source.OwnerUserName = Clean(source.OwnerUserName);

            if (source.CreatedAtUtc <= 0)
            {
                source.CreatedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            }

            if (source.UpdatedAtUtc <= 0)
            {
                source.UpdatedAtUtc = source.CreatedAtUtc;
            }

            return source;
        }

        private static bool TrimCommentsForItem(JMSFusionConfiguration cfg, string itemId)
        {
            var comments = cfg.ItemComments
                .Where(comment => Same(comment.ItemId, itemId))
                .OrderByDescending(CommentSortTimestamp)
                .ThenByDescending(comment => comment.CreatedAtUtc)
                .ToList();

            if (comments.Count <= MaxCommentsPerItem) return false;

            var removeIds = comments
                .Skip(MaxCommentsPerItem)
                .Select(comment => Clean(comment.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            return cfg.ItemComments.RemoveAll(comment =>
                Same(comment.ItemId, itemId) &&
                removeIds.Contains(Clean(comment.Id))) > 0;
        }

        private static bool TrimTotalComments(JMSFusionConfiguration cfg)
        {
            var comments = cfg.ItemComments
                .OrderByDescending(CommentSortTimestamp)
                .ThenByDescending(comment => comment.CreatedAtUtc)
                .ToList();

            if (comments.Count <= MaxCommentsTotal) return false;

            var removeIds = comments
                .Skip(MaxCommentsTotal)
                .Select(comment => Clean(comment.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            return cfg.ItemComments.RemoveAll(comment => removeIds.Contains(Clean(comment.Id))) > 0;
        }

        private static long CommentSortTimestamp(ItemCommentEntry comment)
        {
            return Math.Max(comment?.UpdatedAtUtc ?? 0, comment?.CreatedAtUtc ?? 0);
        }

        private static void TouchRevision(JMSFusionConfiguration cfg)
        {
            cfg.ItemCommentsRevision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
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

        private static bool Same(string? left, string? right)
        {
            return string.Equals(Clean(left), Clean(right), StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeContent(string? value)
        {
            var clean = (value ?? string.Empty)
                .Replace("\r\n", "\n")
                .Replace('\r', '\n')
                .Trim();

            if (clean.Length <= MaxCommentLength) return clean;
            return clean[..MaxCommentLength].Trim();
        }

        private static string Clean(string? value)
        {
            return (value ?? string.Empty).Trim();
        }
    }
}
