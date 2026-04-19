using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

public class ConfigUpdateDto
{
    public bool?   AllowScriptExecution    { get; set; }
    public bool?   EnableTrailerDownloader { get; set; }
    public bool?   EnableTrailerUrlNfo     { get; set; }
    public bool?   EnableCastModule { get; set; }
    public bool?   AllowSharedCastViewerForUsers { get; set; }
    public string? JFBase        { get; set; }
    public string? JFApiKey      { get; set; }
    public string? TmdbApiKey    { get; set; }
    public string? PreferredLang { get; set; }
    public string? FallbackLang  { get; set; }
    public int?    TrailerMinResolution { get; set; }
    public int?    TrailerMaxResolution { get; set; }
    public string? OverwritePolicy { get; set; }
    public int?    EnableThemeLink { get; set; }
    public string? ThemeLinkMode   { get; set; }
    public string? IncludeTypes { get; set; }
    public int?    PageSize     { get; set; }
    public double? SleepSecs    { get; set; }
    public int?    MaxConcurrentDownloads { get; set; }
    public string? JFUserId     { get; set; }
    public List<SharedRadioStationEntry>? RadioStations { get; set; }
}

[ApiController]
[Route("JMSFusion/config")]
[Route("Plugins/JMSFusion/config")]
public class ConfigController : ControllerBase
{
    private const int MinTrailerResolution = 640;
    private const int MaxTrailerResolution = 2160;
    private const int MinConcurrentDownloads = 1;
    private const int MaxConcurrentDownloads = 8;

    [HttpGet]
    public IActionResult Get()
    {
        var cfg = JMSFusionPlugin.Instance?.Configuration
                  ?? throw new InvalidOperationException("Config not available.");
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
        return Ok(new { rev = cfg.GlobalUserSettingsRevision, cfg });
    }

    [HttpPost]
    public IActionResult Update([FromBody] ConfigUpdateDto incoming)
    {
        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        if (incoming.AllowScriptExecution.HasValue)    cfg.AllowScriptExecution    = incoming.AllowScriptExecution.Value;
        if (incoming.EnableTrailerDownloader.HasValue) cfg.EnableTrailerDownloader = incoming.EnableTrailerDownloader.Value;
        if (incoming.EnableTrailerUrlNfo.HasValue)     cfg.EnableTrailerUrlNfo     = incoming.EnableTrailerUrlNfo.Value;
        if (incoming.EnableCastModule.HasValue)        cfg.EnableCastModule = incoming.EnableCastModule.Value;
        if (incoming.AllowSharedCastViewerForUsers.HasValue)
            cfg.AllowSharedCastViewerForUsers = incoming.AllowSharedCastViewerForUsers.Value;

        if (!string.IsNullOrWhiteSpace(incoming.JFBase))        cfg.JFBase        = incoming.JFBase!;
        if (!string.IsNullOrWhiteSpace(incoming.JFApiKey))      cfg.JFApiKey      = incoming.JFApiKey!;
        if (!string.IsNullOrWhiteSpace(incoming.TmdbApiKey))    cfg.TmdbApiKey    = incoming.TmdbApiKey!;
        if (!string.IsNullOrWhiteSpace(incoming.PreferredLang)) cfg.PreferredLang = incoming.PreferredLang!;
        if (!string.IsNullOrWhiteSpace(incoming.FallbackLang))  cfg.FallbackLang  = incoming.FallbackLang!;
        if (incoming.TrailerMinResolution.HasValue || incoming.TrailerMaxResolution.HasValue)
        {
            var minResolution = incoming.TrailerMinResolution ?? cfg.TrailerMinResolution;
            var maxResolution = incoming.TrailerMaxResolution ?? cfg.TrailerMaxResolution;
            NormalizeTrailerResolutionRange(ref minResolution, ref maxResolution);
            cfg.TrailerMinResolution = minResolution;
            cfg.TrailerMaxResolution = maxResolution;
        }

        if (!string.IsNullOrWhiteSpace(incoming.OverwritePolicy))
        {
            var overwrite = incoming.OverwritePolicy!
                .Trim()
                .ToLowerInvariant()
                .Replace("-", string.Empty)
                .Replace("_", string.Empty);

            cfg.OverwritePolicy = overwrite switch
            {
                "replace"   => OverwritePolicy.Replace,
                "ifbetter"  => OverwritePolicy.IfBetter,
                _           => OverwritePolicy.Skip
            };
        }

        if (incoming.EnableThemeLink.HasValue) cfg.EnableThemeLink = incoming.EnableThemeLink.Value;
        if (!string.IsNullOrWhiteSpace(incoming.ThemeLinkMode)) cfg.ThemeLinkMode = incoming.ThemeLinkMode!;

        if (!string.IsNullOrWhiteSpace(incoming.IncludeTypes)) cfg.IncludeTypes = incoming.IncludeTypes!;
        if (incoming.PageSize.HasValue)                        cfg.PageSize     = incoming.PageSize.Value;
        if (incoming.SleepSecs.HasValue)                       cfg.SleepSecs    = incoming.SleepSecs.Value;
        if (incoming.MaxConcurrentDownloads.HasValue)          cfg.MaxConcurrentDownloads = ClampConcurrentDownloads(incoming.MaxConcurrentDownloads.Value);
        if (!string.IsNullOrWhiteSpace(incoming.JFUserId))     cfg.JFUserId     = incoming.JFUserId!;
        if (incoming.RadioStations is not null)                cfg.RadioStations = incoming.RadioStations.Take(300).ToList();

        cfg.GlobalUserSettingsRevision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        plugin.UpdateConfiguration(cfg);

        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";

        return Ok(new { ok = true, saved = true, rev = cfg.GlobalUserSettingsRevision, cfg });
    }

    private static void NormalizeTrailerResolutionRange(ref int minResolution, ref int maxResolution)
    {
        minResolution = ClampResolution(minResolution);
        maxResolution = ClampResolution(maxResolution);

        if (minResolution > maxResolution)
        {
            (minResolution, maxResolution) = (maxResolution, minResolution);
        }
    }

    private static int ClampResolution(int value)
        => Math.Clamp(value, MinTrailerResolution, MaxTrailerResolution);

    private static int ClampConcurrentDownloads(int value)
        => Math.Clamp(value, MinConcurrentDownloads, MaxConcurrentDownloads);
}
