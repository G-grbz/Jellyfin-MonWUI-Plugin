using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using IOFile = System.IO.File;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("slider")]
    public class SliderAssetsController : ControllerBase
    {
        private readonly ILogger<SliderAssetsController> _logger;
        public SliderAssetsController(ILogger<SliderAssetsController> logger) => _logger = logger;

        [HttpGet("{*path}")]
        public IActionResult GetAsset(string path)
        {
            try
            {
                path = (path ?? "").Replace('\\', '/').TrimStart('/');
                if (string.IsNullOrWhiteSpace(path)) path = "index.js";
                var cfg = JMSFusionPlugin.Instance.Configuration;
                if (!string.IsNullOrWhiteSpace(cfg.ScriptDirectory) && Directory.Exists(cfg.ScriptDirectory))
                {
                    var full = Path.GetFullPath(Path.Combine(cfg.ScriptDirectory, path));
                    var root = Path.GetFullPath(cfg.ScriptDirectory);
                    if (!full.StartsWith(root, StringComparison.Ordinal)) return BadRequest("Invalid path.");
                    if (IOFile.Exists(full))
                    {
                        if (AssetVersioning.TryHandleConditionalGet(HttpContext, $"slider:{path}"))
                        {
                            return StatusCode(304);
                        }

                        return File(IOFile.ReadAllBytes(full), Mime(full));
                    }
                }

                var resourceName = $"Resources.slider.{path.Replace('/', '.')}";
                var bytes = EmbeddedAssetHelper.TryRead(resourceName);
                if (bytes != null)
                {
                    if (AssetVersioning.TryHandleConditionalGet(HttpContext, $"slider:{path}"))
                    {
                        return StatusCode(304);
                    }

                    return File(bytes, Mime(path));
                }

                return NotFound();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Slider asset error: {Path}", path);
                return StatusCode(500, "Internal server error");
            }
        }

        private static string Mime(string p)
        {
            var ext = Path.GetExtension(p).ToLowerInvariant();
            return ext switch
            {
                ".css"  => "text/css; charset=utf-8",
                ".mjs"  => "application/javascript; charset=utf-8",
                ".js"   => "application/javascript; charset=utf-8",
                ".ts"   => "application/typescript",
                ".map"  => "application/json",
                ".json" => "application/json",
                ".html" => "text/html; charset=utf-8",
                ".svg"  => "image/svg+xml",
                _       => "application/octet-stream"
            };
        }
    }
}
