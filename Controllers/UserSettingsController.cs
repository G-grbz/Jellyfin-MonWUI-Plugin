using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("Plugins/JMSFusion/UserSettings")]
    public class UserSettingsController : ControllerBase
    {
        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        private static string NormalizeProfile(string? p)
        {
            p = (p ?? "").Trim().ToLowerInvariant();
            return (p == "mobile" || p == "m") ? "mobile" : "desktop";
        }

        private static void EnsureMigrated(JMSFusionConfiguration cfg, JMSFusionPlugin plugin)
        {
            var legacy = cfg.GlobalUserSettingsJson;
            var legacyHas = !string.IsNullOrWhiteSpace(legacy) && legacy != "{}";

            var desktopEmpty = string.IsNullOrWhiteSpace(cfg.GlobalUserSettingsJsonDesktop) || cfg.GlobalUserSettingsJsonDesktop == "{}";
            var mobileEmpty  = string.IsNullOrWhiteSpace(cfg.GlobalUserSettingsJsonMobile)  || cfg.GlobalUserSettingsJsonMobile  == "{}";

            if (!legacyHas) return;
            if (!(desktopEmpty && mobileEmpty)) return;

            cfg.GlobalUserSettingsJsonDesktop = legacy!;
            cfg.GlobalUserSettingsJsonMobile  = legacy!;

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            cfg.GlobalUserSettingsRevisionDesktop = now;
            cfg.GlobalUserSettingsRevisionMobile  = now;

            plugin.UpdateConfiguration(cfg);
        }

        [HttpGet]
        public IActionResult Get([FromQuery] string? profile = null)
        {
            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;

            EnsureMigrated(cfg, plugin);

            var prof = NormalizeProfile(profile);
            var json = prof == "mobile"
                ? (cfg.GlobalUserSettingsJsonMobile ?? "{}")
                : (cfg.GlobalUserSettingsJsonDesktop ?? "{}");
            var rev = prof == "mobile"
                ? cfg.GlobalUserSettingsRevisionMobile
                : cfg.GlobalUserSettingsRevisionDesktop;

            object globalObj;
            try
            {
                globalObj = JsonSerializer.Deserialize<object>(json) ?? new();
            }
            catch
            {
                globalObj = new();
            }

            NoCache();
            return Ok(new
            {
                profile = prof,
                rev,
                forceGlobal = cfg.ForceGlobalUserSettings,
                global = globalObj
            });
        }

        public sealed class PublishReq
        {
            public object? Global { get; set; }
            public string? Profile { get; set; }
        }

        [HttpPost("Publish")]
        public IActionResult Publish([FromBody] PublishReq req, [FromQuery] string? profile = null)
        {
            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;

            EnsureMigrated(cfg, plugin);

            var prof = NormalizeProfile(req.Profile ?? profile);
            var json = JsonSerializer.Serialize(req.Global ?? new());
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            if (prof == "mobile")
            {
                cfg.GlobalUserSettingsJsonMobile = json;
                cfg.GlobalUserSettingsRevisionMobile = now;
            }
            else
            {
                cfg.GlobalUserSettingsJsonDesktop = json;
                cfg.GlobalUserSettingsRevisionDesktop = now;
            }

            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new { ok = true, profile = prof, rev = now });
        }
    }
}
