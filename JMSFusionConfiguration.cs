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

        [JsonPropertyName("jfUserId")]
        public string? JFUserId { get; set; } = null;
    }

    public enum OverwritePolicy
    {
        Skip,
        Replace,
        IfBetter
    }
}
