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
        private static string GetBackupPath(string path) => path + ".jmsfusion.bak";

        private static string BuildBlock(string? pathBase = null)
        {
            var sb = new StringBuilder();
            sb.AppendLine(BeginMark);
            sb.AppendLine(AssetVersioning.BuildBootstrapScript());
            sb.AppendLine($@"<script type=""module"" src=""{AssetVersioning.AppendVersionQuery("../Plugins/JMSFusion/runtime/storage-preload.js")}""></script>");
            sb.AppendLine($@"<script type=""module"" src=""{AssetVersioning.AppendVersionQuery("../slider/main.js")}""></script>");
            sb.AppendLine($@"<script type=""module"" src=""{AssetVersioning.AppendVersionQuery("../slider/modules/player/main.js")}""></script>");
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

        private static bool HasInjectBlock(string html)
        {
            var (start, end) = FindInjectRange(html);
            return start >= 0 && end >= 0;
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
                var backupPath = GetBackupPath(path);
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

        private static void DeleteBackupIfPresent(string path, ILogger logger)
        {
            try
            {
                var backupPath = GetBackupPath(path);
                if (!File.Exists(backupPath))
                {
                    return;
                }

                File.Delete(backupPath);
                logger.LogInformation("[JMSFusion] Removed backup: {BackupPath}", backupPath);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[JMSFusion] Failed removing backup for: {Path}", path);
            }
        }

        private static void DeleteBackupsIfPresent(ILogger logger, string webRootPath)
        {
            DeleteBackupIfPresent(Path.Combine(webRootPath, "index.html"), logger);
            DeleteBackupIfPresent(Path.Combine(webRootPath, "index.html.gz"), logger);
            DeleteBackupIfPresent(Path.Combine(webRootPath, "index.html.br"), logger);
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

                var block = BuildBlock(pathBase);
                var (start, end) = FindInjectRange(html);
                if (start >= 0 && end >= 0)
                {
                    var currentBlock = html.Substring(start, end - start).Trim();
                    var desiredBlock = block.Trim();
                    if (string.Equals(currentBlock, desiredBlock, StringComparison.Ordinal))
                    {
                        logger.LogInformation("[JMSFusion] index.html patch is already up to date");
                        return true;
                    }

                    html = html.Remove(start, end - start).Insert(start, block);
                    logger.LogInformation("[JMSFusion] Existing inject block refreshed");
                }
                else
                {
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

                var html = File.ReadAllText(indexPath, Encoding.UTF8);
                var hasInjectBlock = HasInjectBlock(html);
                var backupPath = GetBackupPath(indexPath);
                var hasBackup = File.Exists(backupPath);

                if (!hasInjectBlock)
                {
                    logger.LogInformation("[JMSFusion] Unpatch: inject block not found (already clean)");
                    if (hasBackup)
                    {
                        if (IsWritable(indexPath, logger))
                        {
                            WriteCompressedCopiesIfPresent(logger, webRootPath, html);
                            DeleteBackupsIfPresent(logger, webRootPath);
                        }
                    }
                    return true;
                }

                if (!IsWritable(indexPath, logger))
                    return false;

                if (hasBackup)
                {
                    try
                    {
                        File.Copy(backupPath, indexPath, overwrite: true);
                        logger.LogInformation("[JMSFusion] Unpatch: restored from backup: {BackupPath}", backupPath);
                        var restored = File.ReadAllText(indexPath, Encoding.UTF8);
                        WriteCompressedCopiesIfPresent(logger, webRootPath, restored);
                        DeleteBackupsIfPresent(logger, webRootPath);
                        return true;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "[JMSFusion] Unpatch: failed to restore backup, falling back to inline removal");
                    }
                }

                var (s, e) = FindInjectRange(html);
                if (s < 0 || e < 0)
                {
                    logger.LogInformation("[JMSFusion] Unpatch: inject block not found (already clean)");
                    DeleteBackupsIfPresent(logger, webRootPath);
                    return true;
                }

                html = html.Remove(s, e - s);
                File.WriteAllText(indexPath, html, Encoding.UTF8);
                logger.LogInformation("[JMSFusion] Unpatch: inject block removed");
                WriteCompressedCopiesIfPresent(logger, webRootPath, html);
                DeleteBackupsIfPresent(logger, webRootPath);
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
