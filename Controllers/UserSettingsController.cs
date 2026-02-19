using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System;

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

        [HttpGet]
        public IActionResult Get()
        {
            var cfg = JMSFusionPlugin.Instance.Configuration;

            object globalObj;
            try
            {
                globalObj = JsonSerializer.Deserialize<object>(
                    cfg.GlobalUserSettingsJson ?? "{}"
                ) ?? new();
            }
            catch
            {
                globalObj = new();
            }

            NoCache();
            return Ok(new
            {
                rev = cfg.GlobalUserSettingsRevision,
                forceGlobal = cfg.ForceGlobalUserSettings,
                global = globalObj
            });
        }

        public sealed class PublishReq
        {
            public object? Global { get; set; }
        }

        [HttpPost("Publish")]
        public IActionResult Publish([FromBody] PublishReq req)
        {
            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;

            cfg.GlobalUserSettingsJson =
                JsonSerializer.Serialize(req.Global ?? new());

            cfg.GlobalUserSettingsRevision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new { ok = true });
        }
    }
}
