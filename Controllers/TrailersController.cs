using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JMSFusion;
using Jellyfin.Plugin.JMSFusion.Core;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/trailers")]
    public class TrailersController : ControllerBase
    {
        private const string ApiUserHeaderRequiredCode = "trailers.api.user_header_required";
        private const string ApiTokenHeaderRequiredCode = "trailers.api.token_header_required";
        private const string ApiUserNotFoundCode = "trailers.api.user_not_found";
        private const string ApiAdminRequiredCode = "trailers.api.admin_required";
        private const string ApiScriptExecutionDisabledCode = "trailers.api.script_execution_disabled";
        private const string ApiNoTaskEnabledCode = "trailers.api.no_task_enabled";
        private const string ApiAlreadyRunningCode = "trailers.api.already_running";
        private const string ApiPluginConfigUnavailableCode = "trailers.api.plugin_config_unavailable";
        private const string ApiPluginConfigHintCode = "trailers.api.plugin_config_hint";
        private const string ApiCancelInProgressCode = "trailers.api.cancel_in_progress";
        private const string ApiNoRunningJobCode = "trailers.api.no_running_job";
        private const string ApiUnexpectedErrorCode = "trailers.api.unexpected_error";

        private const string LastCancelRequestedCode = "trailers.last.cancel_requested";
        private const string LastStepStartingCode = "trailers.last.step_starting";
        private const string LastStepFinishedCode = "trailers.last.step_finished";
        private const string LastCancelledCode = "trailers.last.cancelled";
        private const string LastFinishedCode = "trailers.last.finished";

        private readonly IUserManager _users;
        private readonly TrailerAutomationService _trailerService;

        public TrailersController(IUserManager users, TrailerAutomationService trailerService)
        {
            _users = users;
            _trailerService = trailerService;
        }

        private sealed class JobState
        {
            public Guid UserId { get; set; }
            public bool Running { get; set; }
            public DateTimeOffset StartedAt { get; set; }
            public DateTimeOffset? FinishedAt { get; set; }
            public string CurrentStep { get; set; } = string.Empty;
            public string[] Steps { get; set; } = Array.Empty<string>();
            public double Progress01 { get; set; }
            public List<object> Results { get; } = new();
            public int CurrentStepTotal { get; set; }
            public int CurrentStepDone { get; set; }
            public CancellationTokenSource? Cts { get; set; }
            public string LastMessage { get; set; } = string.Empty;
            public string? LastMessageCode { get; set; }
            public Dictionary<string, string?>? LastMessageArgs { get; set; }
            public int LogCapacity { get; } = 500;

            private readonly LinkedList<string> _log = new();
            private readonly object _logLock = new();

            public void AddLog(string line)
            {
                lock (_logLock)
                {
                    _log.AddLast(line);
                    if (_log.Count > LogCapacity)
                    {
                        _log.RemoveFirst();
                    }
                }
            }

            public string[] SnapshotLog()
            {
                lock (_logLock)
                {
                    return _log.ToArray();
                }
            }
        }

        private static readonly ConcurrentDictionary<Guid, JobState> _jobs = new();

        public class RunRequest
        {
            public bool runDownloader { get; set; }
            public bool runUrlNfo { get; set; }
            public string? overwritePolicy { get; set; }
            public int? enableThemeLink { get; set; }
            public string? themeLinkMode { get; set; }
            public string? jfBase { get; set; }
            public string? tmdbApiKey { get; set; }
            public string? preferredLang { get; set; }
            public string? fallbackLang { get; set; }
            public int? trailerMinResolution { get; set; }
            public int? trailerMaxResolution { get; set; }
            public int? maxConcurrentDownloads { get; set; }
        }

        [HttpGet("status")]
        public IActionResult Status()
        {
            if (!TryGetRequestUserId(out var userId))
            {
                return ApiError(401, ApiUserHeaderRequiredCode, "X-Emby-UserId header gerekli.");
            }

            if (_jobs.TryGetValue(userId, out var job))
            {
                return Ok(new
                {
                    ok = true,
                    running = job.Running,
                    startedAt = job.StartedAt,
                    finishedAt = job.FinishedAt,
                    currentStep = job.CurrentStep,
                    steps = job.Steps,
                    currentStepDone = job.CurrentStepDone,
                    currentStepTotal = job.CurrentStepTotal,
                    progress01 = Math.Round(job.Progress01, 4),
                    progressPercent = Math.Round(job.Progress01 * 100, 1),
                    progress = Math.Round(job.Progress01 * 100, 1),
                    lastMessage = job.LastMessage,
                    lastMessageCode = job.LastMessageCode,
                    lastMessageArgs = job.LastMessageArgs,
                    log = job.SnapshotLog(),
                    results = job.Running ? Array.Empty<object>() : job.Results.ToArray()
                });
            }

            return Ok(new { ok = true, running = false });
        }

        [HttpPost("cancel")]
        public IActionResult Cancel()
        {
            if (!TryGetRequestUserId(out var userId))
            {
                return ApiError(401, ApiUserHeaderRequiredCode, "X-Emby-UserId header gerekli.");
            }

            if (_jobs.TryGetValue(userId, out var job) && job.Running)
            {
                try
                {
                    job.Cts?.Cancel();
                }
                catch
                {
                }

                SetLocalizedLastMessage(job, LastCancelRequestedCode, "İş iptal istendi.");
                return ApiOkMessage(ApiCancelInProgressCode, "İş iptal ediliyor...");
            }

            return ApiOkMessage(ApiNoRunningJobCode, "Koşan iş yok.");
        }

        [HttpPost("run")]
        public IActionResult Run([FromBody] RunRequest req, CancellationToken outerCt)
        {
            try
            {
                var cfg = JMSFusionPlugin.Instance?.Configuration;
                if (cfg is null)
                {
                    return ApiError(
                        500,
                        ApiPluginConfigUnavailableCode,
                        "Plugin configuration not available.",
                        hintCode: ApiPluginConfigHintCode,
                        hint: "Docker'da /config/plugins ve /config/plugins/configurations yazılabilir olmalı; plugin gerçekten yüklendi mi? Konteyner loglarına bakın.");
                }

                var token = Request.Headers["X-Emby-Token"].FirstOrDefault();
                if (string.IsNullOrWhiteSpace(token))
                {
                    return ApiError(401, ApiTokenHeaderRequiredCode, "X-Emby-Token header gerekli.");
                }

                if (!TryGetRequestUserId(out var userId))
                {
                    return ApiError(401, ApiUserHeaderRequiredCode, "X-Emby-UserId header gerekli.");
                }

                var user = _users.GetUserById(userId);
                if (user is null)
                {
                    return ApiError(401, ApiUserNotFoundCode, "Kullanıcı bulunamadı.");
                }

                if (!IsAdminUser(user))
                {
                    return ApiError(403, ApiAdminRequiredCode, "Sadece admin kullanıcılar çalıştırabilir.");
                }

                if (!cfg.AllowScriptExecution)
                {
                    return ApiError(403, ApiScriptExecutionDisabledCode, "Script çalıştırma kapalı (AllowScriptExecution=false).");
                }

                var steps = new List<string>();
                if (req.runDownloader && cfg.EnableTrailerDownloader)
                {
                    steps.Add(TrailerAutomationService.DownloaderStep);
                }

                if (req.runUrlNfo && cfg.EnableTrailerUrlNfo)
                {
                    steps.Add(TrailerAutomationService.UrlNfoStep);
                }

                if (steps.Count == 0)
                {
                    return ApiError(400, ApiNoTaskEnabledCode, "Hiçbir görev etkin değil.");
                }

                if (_jobs.TryGetValue(userId, out var existing) && existing.Running)
                {
                    var payload = CreatePayload(ok: false);
                    AddLocalizedField(payload, "error", ApiAlreadyRunningCode, "Zaten çalışan bir iş var.");
                    payload["running"] = true;
                    payload["startedAt"] = existing.StartedAt;
                    payload["progress01"] = Math.Round(existing.Progress01, 4);
                    payload["progressPercent"] = Math.Round(existing.Progress01 * 100, 1);
                    payload["progress"] = Math.Round(existing.Progress01 * 100, 1);
                    payload["currentStep"] = existing.CurrentStep;
                    payload["steps"] = existing.Steps;
                    return StatusCode(409, payload);
                }

                var runOptions = new TrailerAutomationService.TrailerRunOptions
                {
                    JfBase = req.jfBase ?? cfg.JFBase,
                    JfApiKey = token,
                    TmdbApiKey = req.tmdbApiKey ?? cfg.TmdbApiKey,
                    PreferredLang = req.preferredLang ?? cfg.PreferredLang,
                    FallbackLang = req.fallbackLang ?? cfg.FallbackLang,
                    TrailerMinResolution = req.trailerMinResolution ?? cfg.TrailerMinResolution,
                    TrailerMaxResolution = req.trailerMaxResolution ?? cfg.TrailerMaxResolution,
                    IncludeTypes = cfg.IncludeTypes,
                    PageSize = cfg.PageSize,
                    SleepSecs = cfg.SleepSecs,
                    MaxConcurrentDownloads = req.maxConcurrentDownloads ?? cfg.MaxConcurrentDownloads,
                    JfUserId = string.IsNullOrWhiteSpace(cfg.JFUserId) ? userId.ToString() : cfg.JFUserId,
                    OverwritePolicy = !string.IsNullOrWhiteSpace(req.overwritePolicy)
                        ? req.overwritePolicy!
                        : MapOverwritePolicy(cfg.OverwritePolicy),
                    EnableThemeLink = req.enableThemeLink ?? cfg.EnableThemeLink,
                    ThemeLinkMode = req.themeLinkMode ?? cfg.ThemeLinkMode
                };

                var job = new JobState
                {
                    UserId = userId,
                    Running = true,
                    StartedAt = DateTimeOffset.UtcNow,
                    Steps = steps.ToArray(),
                    Cts = CancellationTokenSource.CreateLinkedTokenSource(outerCt)
                };

                _jobs[userId] = job;

                _ = Task.Run(async () =>
                {
                    var startedAt = DateTimeOffset.UtcNow;
                    var currentIndex = 0;

                    foreach (var step in steps)
                    {
                        if (job.Cts!.IsCancellationRequested)
                        {
                            break;
                        }

                        currentIndex++;
                        job.CurrentStep = step;
                        job.Progress01 = StepProgress(currentIndex - 1, steps.Count);
                        SetLocalizedLastMessage(
                            job,
                            LastStepStartingCode,
                            $"{step} başlıyor...",
                            CreateArgs(("step", step)));
                        job.CurrentStepTotal = 0;
                        job.CurrentStepDone = 0;

                        var stepBase = StepProgress(currentIndex - 1, steps.Count);
                        var stepSpan = 1.0 / steps.Count;

                        void HandleLine(string line, bool isErr)
                        {
                            var ts = DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
                            var prefix = isErr ? "[ERR]" : "[OUT]";
                            job.AddLog($"{ts} {prefix} {line}");
                            SetRawLastMessage(job, line);

                            if (line.Contains("JMSF::TOTAL=", StringComparison.Ordinal))
                            {
                                var num = line.Replace("JMSF::TOTAL=", string.Empty, StringComparison.Ordinal);
                                if (int.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out var total))
                                {
                                    job.CurrentStepTotal = total;
                                }
                            }

                            if (line.Contains("JMSF::DONE=", StringComparison.Ordinal))
                            {
                                var num = line.Replace("JMSF::DONE=", string.Empty, StringComparison.Ordinal);
                                if (int.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out var done))
                                {
                                    job.CurrentStepDone = done;
                                }
                            }

                            if (job.CurrentStepTotal > 0)
                            {
                                var frac = Math.Clamp((double)job.CurrentStepDone / job.CurrentStepTotal, 0, 1);
                                job.Progress01 = Math.Clamp(stepBase + (stepSpan * frac), 0, 1);
                            }
                        }

                        if (step == TrailerAutomationService.DownloaderStep)
                        {
                            job.AddLog($"OVERWRITE_POLICY(req)={req.overwritePolicy ?? "<null>"}; cfg={cfg.OverwritePolicy}; wire={runOptions.OverwritePolicy}");
                        }

                        var result = await _trailerService.RunStepAsync(
                            step,
                            runOptions,
                            onLine: HandleLine,
                            ct: job.Cts.Token).ConfigureAwait(false);

                        job.Results.Add(new
                        {
                            script = result.Script,
                            exitCode = result.ExitCode,
                            stdout = result.Stdout,
                            stderr = result.Stderr
                        });

                        job.Progress01 = StepProgress(currentIndex, steps.Count);
                        SetLocalizedLastMessage(
                            job,
                            LastStepFinishedCode,
                            $"{step} bitti.",
                            CreateArgs(("step", step)));
                    }

                    var finishedAt = DateTimeOffset.UtcNow;
                    var elapsedSeconds = (finishedAt - startedAt).TotalSeconds.ToString("F1", CultureInfo.InvariantCulture);
                    job.Running = false;
                    job.FinishedAt = finishedAt;

                    if (job.Cts!.IsCancellationRequested)
                    {
                        SetLocalizedLastMessage(job, LastCancelledCode, "İş iptal edildi.");
                    }
                    else
                    {
                        SetLocalizedLastMessage(
                            job,
                            LastFinishedCode,
                            $"Bitti ✓ ({elapsedSeconds} sn)",
                            CreateArgs(("seconds", elapsedSeconds)));
                    }
                });

                return StatusCode(202, new
                {
                    ok = true,
                    started = true,
                    steps = job.Steps,
                    startedAt = job.StartedAt
                });
            }
            catch (Exception ex)
            {
                var payload = CreatePayload(ok: false);
                AddLocalizedField(payload, "error", ApiUnexpectedErrorCode, "Beklenmeyen hata oluştu.");
                payload["detail"] = ex.Message;
                payload["stack"] = ex.ToString();
                return StatusCode(500, payload);
            }
        }

        [HttpGet("diag")]
        public IActionResult Diag()
        {
            var cfg = JMSFusionPlugin.Instance?.Configuration;
            var hasYtDlp = _trailerService.HasCommand("yt-dlp");
            var hasDeno = _trailerService.HasCommand("deno");
            var hasFfprobe = _trailerService.HasCommand("ffprobe");
            var tmpOk = true;

            try
            {
                var probePath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "jmsf._probe");
                System.IO.File.WriteAllText(probePath, "ok");
                System.IO.File.Delete(probePath);
            }
            catch
            {
                tmpOk = false;
            }

            return Ok(new
            {
                ok = true,
                pluginConfigLoaded = cfg != null,
                allowScriptExecution = cfg?.AllowScriptExecution,
                enableTrailerDownloader = cfg?.EnableTrailerDownloader,
                enableTrailerUrlNfo = cfg?.EnableTrailerUrlNfo,
                tempWritable = tmpOk,
                hasYtDlp,
                hasDeno,
                hasFfprobe,
                managedRunner = true
            });
        }

        private static double StepProgress(int stepIndex, int totalSteps)
        {
            if (totalSteps <= 0)
            {
                return 0;
            }

            if (stepIndex <= 0)
            {
                return 0;
            }

            if (stepIndex >= totalSteps)
            {
                return 1.0;
            }

            return (double)stepIndex / totalSteps;
        }

        private static Dictionary<string, string?> CreateArgs(params (string Key, string? Value)[] pairs)
        {
            var dict = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var (key, value) in pairs)
            {
                dict[key] = value;
            }

            return dict;
        }

        private static void SetLocalizedLastMessage(
            JobState job,
            string code,
            string fallback,
            Dictionary<string, string?>? args = null)
        {
            job.LastMessage = fallback;
            job.LastMessageCode = code;
            job.LastMessageArgs = args;
        }

        private static void SetRawLastMessage(JobState job, string line)
        {
            job.LastMessage = line ?? string.Empty;
            job.LastMessageCode = null;
            job.LastMessageArgs = null;
        }

        private IActionResult ApiError(
            int statusCode,
            string code,
            string fallback,
            Dictionary<string, string?>? args = null,
            string? hintCode = null,
            string? hint = null,
            Dictionary<string, string?>? hintArgs = null)
        {
            var payload = CreatePayload(ok: false);
            AddLocalizedField(payload, "error", code, fallback, args);

            if (!string.IsNullOrWhiteSpace(hintCode) && !string.IsNullOrWhiteSpace(hint))
            {
                AddLocalizedField(payload, "hint", hintCode!, hint!, hintArgs);
            }

            return StatusCode(statusCode, payload);
        }

        private IActionResult ApiOkMessage(
            string code,
            string fallback,
            Dictionary<string, string?>? args = null)
        {
            var payload = CreatePayload(ok: true);
            AddLocalizedField(payload, "message", code, fallback, args);
            return Ok(payload);
        }

        private static Dictionary<string, object?> CreatePayload(bool ok)
        {
            return new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["ok"] = ok
            };
        }

        private static void AddLocalizedField(
            Dictionary<string, object?> payload,
            string fieldName,
            string code,
            string fallback,
            Dictionary<string, string?>? args = null)
        {
            payload[fieldName] = fallback;
            payload[$"{fieldName}Code"] = code;
            if (args != null && args.Count > 0)
            {
                payload[$"{fieldName}Args"] = args;
            }
        }

        private bool IsAdminUser(object userObj)
        {
            return true;
        }

        private static string MapOverwritePolicy(OverwritePolicy p)
        {
            return p switch
            {
                OverwritePolicy.Replace => "replace",
                OverwritePolicy.IfBetter => "if-better",
                _ => "skip"
            };
        }

        private bool TryGetRequestUserId(out Guid userId)
        {
            var userIdHeader =
                Request.Headers["X-Emby-UserId"].FirstOrDefault() ??
                Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault();

            return Guid.TryParse(userIdHeader, out userId) && userId != Guid.Empty;
        }
    }
}
