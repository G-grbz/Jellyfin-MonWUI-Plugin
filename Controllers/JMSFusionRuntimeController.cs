using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.IO;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/runtime")]
    [Route("Plugins/JMSFusion/runtime")]
    public class JMSFusionRuntimeController : ControllerBase
    {
        private static readonly IReadOnlyDictionary<string, string> ScriptResourceMap =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["auth"] = "RuntimeModules.auth.js",
                ["api"] = "RuntimeModules.api.js",
                ["storage-preload"] = "RuntimeModules.storagePreload.js"
            };

        private readonly ILogger<JMSFusionRuntimeController> _logger;

        public JMSFusionRuntimeController(ILogger<JMSFusionRuntimeController> logger)
        {
            _logger = logger;
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        [HttpGet("{name}.js")]
        public IActionResult GetScript(string name)
        {
            if (!ScriptResourceMap.TryGetValue(name, out var resourceSuffix))
            {
                return NotFound();
            }

            try
            {
                var asm = typeof(JMSFusionPlugin).Assembly;
                var ns = typeof(JMSFusionPlugin).Namespace;
                var resourceName = $"{ns}.{resourceSuffix}";

                using var stream = asm.GetManifestResourceStream(resourceName);
                if (stream == null)
                {
                    _logger.LogWarning("Runtime script resource not found: {ResourceName}", resourceName);
                    return NotFound();
                }

                using var ms = new MemoryStream();
                stream.CopyTo(ms);

                NoCache();
                return File(ms.ToArray(), "application/javascript; charset=utf-8");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to serve runtime script: {ScriptName}", name);
                return StatusCode(500, "Internal server error");
            }
        }
    }
}
