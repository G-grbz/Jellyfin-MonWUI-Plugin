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

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        [HttpGet("UiJs")]
        public IActionResult GetUiJs()
        {
            try
            {
                var asm = typeof(JMSFusionPlugin).Assembly;
                var ns = typeof(JMSFusionPlugin).Namespace;
                var resName = $"{ns}.Web.ui.js";

                using var stream = asm.GetManifestResourceStream(resName);
                if (stream == null) return NotFound();

                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                NoCache();
                return File(ms.ToArray(), "application/javascript; charset=utf-8");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "UiJs error");
                return StatusCode(500, "Internal server error");
            }
        }
    }
}
