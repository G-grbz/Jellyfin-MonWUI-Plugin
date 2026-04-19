using System.Collections.Generic;
using System.Text.Json.Serialization;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.JMSFusion
{
    [JsonSourceGenerationOptions(WriteIndented = true)]
    public class JMSFusionConfiguration : BasePluginConfiguration
    {
        [JsonPropertyName("scriptDirectory")]
        public string ScriptDirectory { get; set; } = string.Empty;

        [JsonPropertyName("forceGlobalUserSettings")]
        public bool ForceGlobalUserSettings { get; set; } = false;

        [JsonPropertyName("globalUserSettingsJsonDesktop")]
        public string GlobalUserSettingsJsonDesktop { get; set; } = "{}";

        [JsonPropertyName("globalUserSettingsJsonMobile")]
        public string GlobalUserSettingsJsonMobile { get; set; } = "{}";

        [JsonPropertyName("globalUserSettingsRevisionDesktop")]
        public long GlobalUserSettingsRevisionDesktop { get; set; } = 0;

        [JsonPropertyName("globalUserSettingsRevisionMobile")]
        public long GlobalUserSettingsRevisionMobile { get; set; } = 0;

        [JsonPropertyName("globalUserSettingsJson")]
        public string GlobalUserSettingsJson { get; set; } = "{}";

        [JsonPropertyName("globalUserSettingsRevision")]
        public long GlobalUserSettingsRevision { get; set; } = 0;

        [JsonPropertyName("allowScriptExecution")]
        public bool AllowScriptExecution { get; set; } = true;

        [JsonPropertyName("playerSubdir")]
        public string PlayerSubdir { get; set; } = "modules/player";

        [JsonPropertyName("enableTransformEngine")]
        public bool EnableTransformEngine { get; set; } = true;

        [JsonPropertyName("enableTrailerDownloader")]
        public bool EnableTrailerDownloader { get; set; } = false;

        [JsonPropertyName("enableTrailerUrlNfo")]
        public bool EnableTrailerUrlNfo { get; set; } = false;

        [JsonPropertyName("jfBase")]
        public string JFBase { get; set; } = "http://localhost:8096";

        [JsonPropertyName("jfApiKey")]
        public string JFApiKey { get; set; } = "CHANGE_ME";

        [JsonPropertyName("tmdbApiKey")]
        public string TmdbApiKey { get; set; } = "CHANGE_ME";

        [JsonPropertyName("preferredLang")]
        public string PreferredLang { get; set; } = "tr-TR";

        [JsonPropertyName("fallbackLang")]
        public string FallbackLang { get; set; } = "en-US";

        [JsonPropertyName("trailerMinResolution")]
        public int TrailerMinResolution { get; set; } = 720;

        [JsonPropertyName("trailerMaxResolution")]
        public int TrailerMaxResolution { get; set; } = 1080;

        [JsonPropertyName("overwritePolicy")]
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public OverwritePolicy OverwritePolicy { get; set; } = OverwritePolicy.Skip;

        [JsonPropertyName("enableThemeLink")]
        public int EnableThemeLink { get; set; } = 0;

        [JsonPropertyName("themeLinkMode")]
        public string ThemeLinkMode { get; set; } = "symlink";

        [JsonPropertyName("includeTypes")]
        public string IncludeTypes { get; set; } = "Movie,Series,Season,Episode";

        [JsonPropertyName("pageSize")]
        public int PageSize { get; set; } = 200;

        [JsonPropertyName("sleepSecs")]
        public double SleepSecs { get; set; } = 1.0;

        [JsonPropertyName("maxConcurrentDownloads")]
        public int MaxConcurrentDownloads { get; set; } = 1;

        [JsonPropertyName("jfUserId")]
        public string? JFUserId { get; set; } = null;

        [JsonPropertyName("radioStations")]
        public List<SharedRadioStationEntry> RadioStations { get; set; } = new();

        [JsonPropertyName("watchlistEntries")]
        public List<WatchlistEntry> WatchlistEntries { get; set; } = new();

        [JsonPropertyName("watchlistShares")]
        public List<WatchlistShareEntry> WatchlistShares { get; set; } = new();

        [JsonPropertyName("watchlistRevision")]
        public long WatchlistRevision { get; set; } = 0;

        [JsonPropertyName("itemComments")]
        public List<ItemCommentEntry> ItemComments { get; set; } = new();

        [JsonPropertyName("itemCommentsRevision")]
        public long ItemCommentsRevision { get; set; } = 0;

        [JsonPropertyName("studioHubVideoEntries")]
        public List<StudioHubVideoEntry> StudioHubVideoEntries { get; set; } = new();

        [JsonPropertyName("studioHubManualEntries")]
        public List<StudioHubManualEntry> StudioHubManualEntries { get; set; } = new();

        [JsonPropertyName("studioHubVisibilityEntries")]
        public List<StudioHubVisibilityEntry> StudioHubVisibilityEntries { get; set; } = new();

        [JsonPropertyName("parentalPinRules")]
        public List<ParentalPinRuleEntry> ParentalPinRules { get; set; } = new();

        [JsonPropertyName("parentalPinHash")]
        public string? ParentalPinHash { get; set; }

        [JsonPropertyName("parentalPinSalt")]
        public string? ParentalPinSalt { get; set; }

        [JsonPropertyName("parentalPinRevision")]
        public long ParentalPinRevision { get; set; } = 0;

        [JsonPropertyName("parentalPinMaxAttempts")]
        public int ParentalPinMaxAttempts { get; set; } = 5;

        [JsonPropertyName("parentalPinLockoutMinutes")]
        public int ParentalPinLockoutMinutes { get; set; } = 15;

        [JsonPropertyName("parentalPinTrustMinutes")]
        public int ParentalPinTrustMinutes { get; set; } = 60;

        [JsonPropertyName("enableCastModule")]
        public bool EnableCastModule { get; set; } = true;

        [JsonPropertyName("allowSharedCastViewerForUsers")]
        public bool AllowSharedCastViewerForUsers { get; set; } = false;
    }

    public class SharedRadioStationEntry
    {
        public string? Id { get; set; }
        public string? StationUuid { get; set; }
        public string? Name { get; set; }
        public string? Url { get; set; }
        public string? UrlResolved { get; set; }
        public string? Homepage { get; set; }
        public string? Logo { get; set; }
        public string? LogoUrl { get; set; }
        public string? ImageUrl { get; set; }
        public string? Favicon { get; set; }
        public string? Country { get; set; }
        public string? CountryCode { get; set; }
        public string? State { get; set; }
        public string? Language { get; set; }
        public string? Tags { get; set; }
        public string? Codec { get; set; }
        public int Bitrate { get; set; }
        public int ClickCount { get; set; }
        public int Votes { get; set; }
        public bool Hls { get; set; }
        public string? Source { get; set; }
        public string? CreatedAt { get; set; }
        public string? AddedBy { get; set; }
        public string? AddedByUserId { get; set; }
    }

    public class WatchlistEntry
    {
        public string? Id { get; set; }
        public string? ItemId { get; set; }
        public string? ItemType { get; set; }
        public string? Name { get; set; }
        public string? Overview { get; set; }
        public int? ProductionYear { get; set; }
        public long? RunTimeTicks { get; set; }
        public double? CommunityRating { get; set; }
        public string? OfficialRating { get; set; }
        public List<string> Genres { get; set; } = new();
        public string? AlbumArtist { get; set; }
        public List<string> Artists { get; set; } = new();
        public string? ParentName { get; set; }
        public long AddedAtUtc { get; set; }
        public string? OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
    }

    public class WatchlistShareEntry
    {
        public string? Id { get; set; }
        public string? WatchlistEntryId { get; set; }
        public string? ItemId { get; set; }
        public string? OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
        public string? TargetUserId { get; set; }
        public string? TargetUserName { get; set; }
        public string? Note { get; set; }
        public long SharedAtUtc { get; set; }
    }

    public class ItemCommentEntry
    {
        public string? Id { get; set; }
        public string? ItemId { get; set; }
        public string? Content { get; set; }
        public string? OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
        public long CreatedAtUtc { get; set; }
        public long UpdatedAtUtc { get; set; }
    }

    public class StudioHubVideoEntry
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("fileName")]
        public string FileName { get; set; } = string.Empty;

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;

        [JsonPropertyName("updatedBy")]
        public string? UpdatedBy { get; set; }

        [JsonPropertyName("updatedByUserId")]
        public string? UpdatedByUserId { get; set; }
    }

    public class StudioHubManualEntry
    {
        [JsonPropertyName("studioId")]
        public string StudioId { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("logoFileName")]
        public string? LogoFileName { get; set; }

        [JsonPropertyName("addedAtUtc")]
        public long AddedAtUtc { get; set; } = 0;

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;

        [JsonPropertyName("addedBy")]
        public string? AddedBy { get; set; }

        [JsonPropertyName("addedByUserId")]
        public string? AddedByUserId { get; set; }
    }

    public class StudioHubVisibilityEntry
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("userName")]
        public string? UserName { get; set; }

        [JsonPropertyName("profile")]
        public string Profile { get; set; } = "desktop";

        [JsonPropertyName("hiddenNames")]
        public List<string> HiddenNames { get; set; } = new();

        [JsonPropertyName("orderNames")]
        public List<string> OrderNames { get; set; } = new();

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;
    }

    public class ParentalPinRuleEntry
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("userName")]
        public string? UserName { get; set; }

        [JsonPropertyName("ratingThreshold")]
        public int RatingThreshold { get; set; } = 0;

        [JsonPropertyName("requireUnratedPin")]
        public bool RequireUnratedPin { get; set; } = false;

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;
    }

    public enum OverwritePolicy
    {
        Skip,
        Replace,
        IfBetter
    }
}
