using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace Jellyfin.Plugin.JMSFusion
{
    public static class IndexPatcher
    {
        private const string BeginMark = "<!-- SL-INJECT BEGIN -->";
        private const string EndMark   = "<!-- SL-INJECT END -->";
        private static string BuildBlock(string? pathBase = null)
        {
            var sb = new StringBuilder();
            var ver = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            sb.AppendLine(BeginMark);
            sb.AppendLine($@"<script type=""module"" src=""../Plugins/JMSFusion/runtime/storage-preload.js?v={ver}""></script>");
            sb.AppendLine($@"<script type=""module"" src=""../slider/main.js?v={ver}""></script>");
            sb.AppendLine($@"<script type=""module"" src=""../slider/modules/player/main.js?v={ver}""></script>");
            sb.AppendLine(EndMark);
            return sb.ToString();
        }

        private static (int start, int end) FindInjectRange(string html)
        {
            var begin = html.IndexOf(BeginMark, StringComparison.OrdinalIgnoreCase);
            if (begin < 0) return (-1, -1);
            var end = html.IndexOf(EndMark, begin, StringComparison.OrdinalIgnoreCase);
            if (end < 0) return (-1, -1);
            end += EndMark.Length;
            return (begin, end);
        }

        private static bool IsWritable(string path, ILogger logger)
        {
            try
            {
                using var _ = File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
                return true;
            }
            catch (UnauthorizedAccessException ex)
            {
                logger.LogWarning(ex, "[JMSFusion] No write permission: {Path}", path);
                return false;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[JMSFusion] Write probe failed: {Path}", path);
                return false;
            }
        }

        private static void EnsureBackup(string path, ILogger logger)
        {
            try
            {
                var backupPath = path + ".jmsfusion.bak";
                if (!File.Exists(backupPath))
                {
                    File.Copy(path, backupPath);
                    logger.LogInformation("[JMSFusion] Backup created: {BackupPath}", backupPath);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[JMSFusion] Backup creation failed for: {Path}", path);
            }
        }

        private static void WriteCompressedCopiesIfPresent(ILogger logger, string webRootPath, string html)
        {
            var gz = Path.Combine(webRootPath, "index.html.gz");
            var br = Path.Combine(webRootPath, "index.html.br");

            try
            {
                if (File.Exists(gz) && IsWritable(gz, logger))
                {
                    EnsureBackup(gz, logger);
                    using var ms = new MemoryStream(Encoding.UTF8.GetBytes(html));
                    using var outMs = new MemoryStream();
                    using (var gzStream = new GZipStream(outMs, CompressionLevel.Fastest, leaveOpen: true))
                    {
                        ms.CopyTo(gzStream);
                    }
                    File.WriteAllBytes(gz, outMs.ToArray());
                    logger.LogInformation("[JMSFusion] index.html.gz updated");
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[JMSFusion] Failed updating index.html.gz");
            }

            try
            {
                if (File.Exists(br) && IsWritable(br, logger))
                {
                    EnsureBackup(br, logger);
                    using var ms = new MemoryStream(Encoding.UTF8.GetBytes(html));
                    using var outMs = new MemoryStream();
                    using (var brStream = new BrotliStream(outMs, CompressionLevel.Fastest, leaveOpen: true))
                    {
                        ms.CopyTo(brStream);
                    }
                    File.WriteAllBytes(br, outMs.ToArray());
                    logger.LogInformation("[JMSFusion] index.html.br updated");
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[JMSFusion] Failed updating index.html.br");
            }
        }

        public static bool EnsurePatched(ILogger logger, string webRootPath, string? pathBase = null)
        {
            try
            {
                logger.LogInformation("[JMSFusion] Checking web root: {WebRoot}", webRootPath);

                var indexPath = Path.Combine(webRootPath, "index.html");
                logger.LogInformation("[JMSFusion] Index path: {IndexPath}", indexPath);

                if (!File.Exists(indexPath))
                {
                    logger.LogWarning("[JMSFusion] index.html not found at: {Path}", indexPath);
                    return false;
                }

                if (!IsWritable(indexPath, logger))
                    return false;

                var html = File.ReadAllText(indexPath, Encoding.UTF8);

                if (html.Contains(BeginMark, StringComparison.OrdinalIgnoreCase) &&
                    html.Contains(EndMark, StringComparison.OrdinalIgnoreCase))
                {
                    logger.LogInformation("[JMSFusion] index.html is already patched");
                    return true;
                }

                var block = BuildBlock(pathBase);
                var headEndPos = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);

                if (headEndPos >= 0)
                {
                    html = html.Insert(headEndPos, Environment.NewLine + block + Environment.NewLine);
                    logger.LogInformation("[JMSFusion] Found </head> tag at position: {Position}", headEndPos);
                }
                else
                {
                    var bodyEndPos = html.IndexOf("</body>", StringComparison.OrdinalIgnoreCase);
                    if (bodyEndPos >= 0)
                    {
                        html = html.Insert(bodyEndPos, Environment.NewLine + block + Environment.NewLine);
                        logger.LogInformation("[JMSFusion] Found </body> tag at position: {Position}", bodyEndPos);
                    }
                    else
                    {
                        html += Environment.NewLine + block + Environment.NewLine;
                        logger.LogWarning("[JMSFusion] Neither </head> nor </body> tag found, appended to end");
                    }
                }

                EnsureBackup(indexPath, logger);
                File.WriteAllText(indexPath, html, Encoding.UTF8);
                logger.LogInformation("[JMSFusion] index.html updated successfully");
                var verify = File.ReadAllText(indexPath, Encoding.UTF8);
                if (verify.Contains(BeginMark, StringComparison.OrdinalIgnoreCase) &&
                    verify.Contains(EndMark, StringComparison.OrdinalIgnoreCase))
                {
                    logger.LogInformation("[JMSFusion] Patch verification successful");
                    WriteCompressedCopiesIfPresent(logger, webRootPath, verify);
                    return true;
                }

                logger.LogError("[JMSFusion] Patch verification FAILED");
                return false;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[JMSFusion] Failed to patch index.html");
                return false;
            }
        }

        public static bool EnsureUnpatched(ILogger logger, string webRootPath)
        {
            try
            {
                var indexPath = Path.Combine(webRootPath, "index.html");
                if (!File.Exists(indexPath))
                {
                    logger.LogWarning("[JMSFusion] Unpatch: index.html not found: {Path}", indexPath);
                    return false;
                }

                if (!IsWritable(indexPath, logger))
                    return false;

                var backupPath = indexPath + ".jmsfusion.bak";
                if (File.Exists(backupPath))
                {
                    try
                    {
                        File.Copy(backupPath, indexPath, overwrite: true);
                        logger.LogInformation("[JMSFusion] Unpatch: restored from backup: {BackupPath}", backupPath);
                        var restored = File.ReadAllText(indexPath, Encoding.UTF8);
                        WriteCompressedCopiesIfPresent(logger, webRootPath, restored);
                        return true;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "[JMSFusion] Unpatch: failed to restore backup, falling back to inline removal");
                    }
                }

                var html = File.ReadAllText(indexPath, Encoding.UTF8);
                var (s, e) = FindInjectRange(html);
                if (s < 0 || e < 0)
                {
                    logger.LogInformation("[JMSFusion] Unpatch: inject block not found (already clean)");
                    WriteCompressedCopiesIfPresent(logger, webRootPath, html);
                    return true;
                }

                html = html.Remove(s, e - s);
                EnsureBackup(indexPath, logger);
                File.WriteAllText(indexPath, html, Encoding.UTF8);
                logger.LogInformation("[JMSFusion] Unpatch: inject block removed");
                WriteCompressedCopiesIfPresent(logger, webRootPath, html);
                return true;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[JMSFusion] EnsureUnpatched failed");
                return false;
            }
        }
    }
}
