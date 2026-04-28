using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

[ApiController]
[Route("JMSFusion/ping")]
[Route("Plugins/JMSFusion/ping")]
public class PingController : ControllerBase
{
    [HttpGet]
    public IActionResult Ping()
    {
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
        Response.Headers["X-JMSFusion-Version"] = AssetVersioning.AssetVersion;
        return NoContent();
    }
}
