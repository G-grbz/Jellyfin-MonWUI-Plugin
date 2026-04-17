using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using IOFile = System.IO.File;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("Plugins/JMSFusion/assets")]
    public class JMSFusionAssetsController : ControllerBase
    {
        private readonly ILogger<JMSFusionAssetsController> _logger;
        public JMSFusionAssetsController(ILogger<JMSFusionAssetsController> logger) => _logger = logger;

        [HttpGet("UiJs")]
        public IActionResult GetUiJs() => ServeEmbeddedJavascript("assets:ui-js", "ui.js", "UiJs error");

        [HttpGet("WebSettingsJs")]
        public IActionResult GetWebSettingsJs() => ServeEmbeddedJavascript("assets:web-settings-js", "settings.js", "WebSettingsJs error");

        private IActionResult ServeEmbeddedJavascript(string cacheKey, string fileName, string errorLogMessage)
        {
            try
            {
                if (AssetVersioning.TryHandleConditionalGet(HttpContext, cacheKey))
                {
                    return StatusCode(304);
                }

                var asm = typeof(JMSFusionPlugin).Assembly;
                var ns = typeof(JMSFusionPlugin).Namespace;
                var resName = $"{ns}.Web.{fileName}";

                using var stream = asm.GetManifestResourceStream(resName);
                if (stream == null) return NotFound();

                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                return File(ms.ToArray(), "application/javascript; charset=utf-8");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, errorLogMessage);
                return StatusCode(500, "Internal server error");
            }
        }
    }
}
