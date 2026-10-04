// LuckyBlox Client Installer
//
// A real, self-contained Windows installer for the LuckyBlox content client.
// It installs the PLAYER and (optionally) STUDIO, and - importantly - it UPDATES:
// a client that is already installed can be brought up to date without a
// reinstall, which is how the Roblox bootstrapper behaved.
//
// ---------------------------------------------------------------------------
// How it works (Roblox's model, reproduced)
// ---------------------------------------------------------------------------
//   1. READ THE MANIFEST. It fetches <base>/api/client/update-manifest and reads
//      the published buildId + version + download path for the channel.
//   2. COMPARE. It finds the newest build already under
//      <root>\Luckyblox\Versions\ and compares build ids.
//        - equal          -> "Up to date", nothing to do
//        - remote differs -> download and ADD the new version (never in place)
//   3. DOWNLOAD TO A TEMP FILE. Writes to Versions\<v>\.tmp and verifies, so a
//      dropped connection cannot leave a half-written executable.
//   4. PROMOTE. Only after the file is complete does it move into place and write
//      the version pointer. The previous version directory is left alone, so a
//      bad build can be rolled back by flipping the pointer back.
//
// That last point is the whole reason this is a real installer rather than a
// "copy this exe" script: nothing is ever written over a working build.
//
// ---------------------------------------------------------------------------
// Build (no SDK needed - uses the in-box .NET Framework compiler)
// ---------------------------------------------------------------------------
//   csc.exe /target:winexe /out:LuckybloxInstaller.exe ^
//           /r:System.Windows.Forms.dll /r:System.Drawing.dll LuckybloxInstaller.cs
//
// Or run build-installer.bat, which finds csc and does it for you.
//
// NOTE: Microsoft.CSharp is deliberately NOT referenced. The source avoids the
// `dynamic` keyword everywhere (see CreateShortcut, which uses late-bound
// reflection instead), because `dynamic` would require that reference and the
// build command above would stop working on a clean machine.
//
// The installer is a single .exe with no external dependencies. It can be run:
//   - normally (a small window with Install / Update / Launch)
//   - silently:  LuckybloxInstaller.exe /S /root "C:\path"
//   - update only, no UI:  LuckybloxInstaller.exe /Update /S
//   - state check:  LuckybloxInstaller.exe /S /check
//
// Exit codes (so a script or the launcher can branch on the result):
//   0  success, or already up to date
//   1  failed (network, download, or a busy binary)
//
// The uninstall entry Windows writes points at a COPY of this exe kept inside
// the install folder, so "Uninstall" in Apps & features keeps working after the
// original download is deleted.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LuckyBlox.Installer
{
    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    /// <summary>
    /// Where the installer points. The shipped default is overridden at runtime
    /// by /base "https://host", or baked in at build time with the
    /// LUCKYBLOX_INSTALLER_BASE environment variable, so one build can serve any
    /// deployment.
    /// </summary>
    internal static class InstallerConfig
    {
        // The LuckyBlox install folder name. Part of the contract with the
        // server (see server/clientLauncher.js) and never derived from the
        // product's display spelling.
        public const string InstallFolderName = "Luckyblox";
        public const string VersionsDir = "Versions";
        public const string VersionPointerFile = "version.txt";
        public const string PlayerBinary = "RobloxPlayerBeta.exe";
        public const string StudioBinary = "RobloxStudioBeta.exe";

        // Filled in by Program.Main from the command line / env / default.
        public static string BaseUrl = DefaultBaseUrl();

        public static string DefaultBaseUrl()
        {
            // A value baked in at compile time wins, so a release can ship an
            // installer pre-pointed at its own server.
            string baked = Environment.GetEnvironmentVariable("LUCKYBLOX_INSTALLER_BASE");
            if (!string.IsNullOrWhiteSpace(baked)) return baked.TrimEnd('/');

            string beside = ReadConfigFile();
            if (!string.IsNullOrWhiteSpace(beside)) return beside;

            // Finally, the launcher's OWN config. A user who already runs the
            // desktop launcher has a working base URL recorded in
            // Settings/baseurl.txt; reading it means the installer points at the
            // same deployment instead of silently defaulting to localhost and
            // installing a client that connects nowhere.
            string fromLauncher = ReadLauncherBaseUrl();
            if (!string.IsNullOrWhiteSpace(fromLauncher)) return fromLauncher;

            // A public download is normally run outside the release folder; a
            // loopback default would point that user's client at their own PC.
            return "https://luckyblox-server.onrender.com";
        }

        public static string NormalizeBaseUrl(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
                || !string.IsNullOrEmpty(uri.UserInfo)
                || !string.IsNullOrEmpty(uri.Query)
                || !string.IsNullOrEmpty(uri.Fragment))
            {
                throw new ArgumentException("Server URL must be an http(s) URL without credentials, query, or fragment.");
            }

            return uri.GetLeftPart(UriPartial.Path).TrimEnd('/');
        }

        /// <summary>installer.config.txt next to the exe, if present.</summary>
        private static string ReadConfigFile()
        {
            try
            {
                var dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".";
                var cfg = Path.Combine(dir, "installer.config.txt");
                if (!File.Exists(cfg)) return "";
                return FirstMeaningfulLine(File.ReadAllText(cfg, Encoding.UTF8));
            }
            catch { return ""; }
        }

        /// <summary>
        /// The launcher's Settings/baseurl.txt. Probes the usual locations,
        /// because the installer is often run from a temp folder far away from
        /// the release tree it is installing.
        /// </summary>
        private static string ReadLauncherBaseUrl()
        {
            var exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".";
            var candidates = new[]
            {
                Path.Combine(exeDir, "Settings", "baseurl.txt"),
                Path.Combine(exeDir, "..", "Settings", "baseurl.txt"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Luckyblox", "Settings", "baseurl.txt"),
            };

            foreach (var candidate in candidates)
            {
                try
                {
                    if (!File.Exists(candidate)) continue;
                    string value = FirstMeaningfulLine(File.ReadAllText(candidate, Encoding.UTF8));
                    if (!string.IsNullOrWhiteSpace(value)) return value;
                }
                catch { }
            }
            return "";
        }

        /// <summary>
        /// The first line that is neither blank nor a comment, BOM stripped.
        /// These config files are hand-edited, so both are common.
        /// </summary>
        private static string FirstMeaningfulLine(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            foreach (var raw in text.Replace("\uFEFF", "").Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith("#") || line.StartsWith("//")) continue;
                return line.TrimEnd('/');
            }
            return "";
        }

        /// <summary>The default per-user install root: %LOCALAPPDATA%\Luckyblox.</summary>
        public static string DefaultRoot()
        {
            var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (string.IsNullOrWhiteSpace(local))
            {
                local = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "AppData", "Local");
            }
            return local;
        }

        public static string InstallDir(string root)
        {
            return Path.Combine(root, InstallFolderName);
        }
    }

    // -----------------------------------------------------------------------
    // Manifest
    // -----------------------------------------------------------------------

    internal sealed class BuildInfo
    {
        public string BuildId = "";
        public string Version = "";
        public string Channel = "production";
        public string DownloadUrl = "";
        public string BinaryName = InstallerConfig.PlayerBinary;
        public long Size = 0;

        public bool IsValid { get { return !string.IsNullOrEmpty(DownloadUrl); } }
    }

    /// <summary>
    /// Talks to the LuckyBlox server's build endpoints.
    ///
    /// Uses HttpWebRequest rather than WebClient because the installer needs a
    /// progress callback and a timeout, and WebClient offers neither cleanly.
    /// </summary>
    internal sealed class ManifestClient
    {
        private readonly string _baseUrl;
        public ManifestClient(string baseUrl) { _baseUrl = baseUrl.TrimEnd('/'); }

        /// <summary>Fetch the update manifest and pull the current build out of it.</summary>
        public BuildInfo Fetch()
        {
            var info = new BuildInfo();

            // The channel-specific endpoint first (it is what a Roblox-style
            // bootstrapper asks for), then the plain manifest as a fallback.
            string[] urls = new[]
            {
                _baseUrl + "/api/client/update-manifest",
                _baseUrl + "/v1/client/version/production",
                _baseUrl + "/api/client/build-info",
            };

            string json = null;
            foreach (var url in urls)
            {
                try
                {
                    json = GetString(url);
                    if (!string.IsNullOrWhiteSpace(json)) break;
                }
                catch (WebException)
                {
                    // Try the next shape; only the last failure is reported.
                }
            }

            if (string.IsNullOrWhiteSpace(json)) throw new Exception("Could not reach the LuckyBlox server at " + _baseUrl);

            info.BuildId = JsonString(json, "buildId");
            info.Version = JsonString(json, "version");
            info.Channel = JsonString(json, "channel");
            info.Size = JsonInt64(json, "size");
            if (string.IsNullOrEmpty(info.Channel)) info.Channel = "production";

            // Prefer the explicit downloadUrl from the build entry.
            info.DownloadUrl = JsonString(json, "downloadUrl");
            if (string.IsNullOrEmpty(info.DownloadUrl))
            {
                info.DownloadUrl = _baseUrl + "/download/client/binary";
            }
            else if (info.DownloadUrl.StartsWith("/"))
            {
                // A relative URL is resolved against the base.
                info.DownloadUrl = _baseUrl + info.DownloadUrl;
            }

            // If the manifest says nothing is published, that is a real answer,
            // not an error: there is simply no build to install.
            string available = JsonRaw(json, "available");
            if (available == "false")
            {
                return new BuildInfo { BuildId = info.BuildId, Version = info.Version, Channel = info.Channel };
            }

            string binaryName = JsonString(json, "binaryName");
            if (!string.IsNullOrWhiteSpace(binaryName)) info.BinaryName = binaryName;

            return info;
        }

        /// <summary>A plain GET, with a timeout so a dead host cannot hang the UI.</summary>
        public static string GetString(string url)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = 15000;
            request.ReadWriteTimeout = 15000;
            request.UserAgent = "LuckyBloxInstaller/2.0";
            request.Accept = "application/json";
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        /* --- A deliberately small JSON reader: this keeps the installer a
               single .exe with no Newtonsoft dependency. --------------------- */

        public static string JsonString(string json, string key)
        {
            var match = Regex.Match(json,
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
            return match.Success ? Unescape(match.Groups[1].Value) : "";
        }

        public static string JsonRaw(string json, string key)
        {
            var match = Regex.Match(json,
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*(true|false|null|-?\\d+(?:\\.\\d+)?)");
            return match.Success ? match.Groups[1].Value : "";
        }

        public static long JsonInt64(string json, string key)
        {
            var raw = JsonRaw(json, key);
            long value;
            return long.TryParse(raw, out value) ? value : 0;
        }

        public static string Unescape(string value)
        {
            return value.Replace("\\\"", "\"").Replace("\\\\", "\\").Replace("\\/", "/")
                        .Replace("\\n", "\n").Replace("\\t", "\t").Replace("\\r", "\r");
        }
    }

    // -----------------------------------------------------------------------
    // Install state
    // -----------------------------------------------------------------------

    /// <summary>What is currently installed, read from disk.</summary>
    internal sealed class InstallState
    {
        public string InstallDir;
        public string VersionsDir;
        public string CurrentVersion = "";     // from version.txt
        public string NewestVersion = "";      // newest directory under Versions
        public bool PlayerInstalled;
        public bool StudioInstalled;

        public bool AnyInstalled { get { return PlayerInstalled || StudioInstalled; } }

        /// <summary>Read the on-disk state for a root.</summary>
        public static InstallState Read(string root)
        {
            var state = new InstallState();
            state.InstallDir = InstallerConfig.InstallDir(root);
            state.VersionsDir = Path.Combine(state.InstallDir, InstallerConfig.VersionsDir);

            // The pointer file and the newest directory are read independently:
            // a version can exist on disk even if the pointer write failed.
            try
            {
                var pointer = Path.Combine(state.InstallDir, InstallerConfig.VersionPointerFile);
                if (File.Exists(pointer))
                {
                    state.CurrentVersion = File.ReadAllText(pointer, Encoding.UTF8).Replace("\uFEFF", "").Trim();
                }
            }
            catch { }

            try
            {
                if (Directory.Exists(state.VersionsDir))
                {
                    var versions = Directory.GetDirectories(state.VersionsDir)
                        .Select(Path.GetFileName)
                        .Where(n => !string.IsNullOrWhiteSpace(n) && !n.StartsWith("."))
                        .ToList();
                    var playerVersions = new List<string>();
                    foreach (var version in versions)
                    {
                        var dir = Path.Combine(state.VersionsDir, version);
                        if (File.Exists(Path.Combine(dir, InstallerConfig.PlayerBinary)))
                        {
                            playerVersions.Add(version);
                            state.PlayerInstalled = true;
                        }
                        if (File.Exists(Path.Combine(dir, InstallerConfig.StudioBinary))) state.StudioInstalled = true;
                    }

                    if (playerVersions.Count > 0)
                    {
                        playerVersions.Sort(CompareVersions);
                        state.NewestVersion = playerVersions[playerVersions.Count - 1];
                    }

                    string selectedPlayer = Path.Combine(
                        state.VersionsDir,
                        state.CurrentVersion ?? "",
                        InstallerConfig.PlayerBinary);
                    if (string.IsNullOrEmpty(state.CurrentVersion) || !File.Exists(selectedPlayer))
                        state.CurrentVersion = state.NewestVersion;
                }

                // The bundled (unversioned) layout also counts.
                if (File.Exists(Path.Combine(state.InstallDir, InstallerConfig.PlayerBinary))) state.PlayerInstalled = true;
                if (File.Exists(Path.Combine(state.InstallDir, InstallerConfig.StudioBinary))) state.StudioInstalled = true;
            }
            catch { }

            return state;
        }

        /// <summary>
        /// Version ordering by numeric parts, so 2021.2 sorts above 2021.10 - a
        /// plain string sort gets that backwards, which would make the installer
        /// silently choose an older build.
        /// </summary>
        public static int CompareVersions(string a, string b)
        {
            var pa = Regex.Split(a ?? "", @"[.\-_]").Select(s => { int n; return int.TryParse(s, out n) ? n : 0; }).ToArray();
            var pb = Regex.Split(b ?? "", @"[.\-_]").Select(s => { int n; return int.TryParse(s, out n) ? n : 0; }).ToArray();
            int len = Math.Max(pa.Length, pb.Length);
            for (int i = 0; i < len; i++)
            {
                int va = i < pa.Length ? pa[i] : 0;
                int vb = i < pb.Length ? pb[i] : 0;
                if (va != vb) return va < vb ? -1 : 1;
            }
            // Equal numerically: fall back to a string compare so the order is
            // still deterministic.
            return string.CompareOrdinal(a ?? "", b ?? "");
        }
    }

    // -----------------------------------------------------------------------
    // Installer logic
    // -----------------------------------------------------------------------

    internal sealed class InstallResult
    {
        public bool Ok;
        public bool UpToDate;
        public bool Updated;
        public string Version = "";
        public string Message = "";
        public Exception Error;
    }

    /// <summary>
    /// The install/update operation. Deliberately free of UI so the same code
    /// path serves the windowed installer and the silent /S mode.
    /// </summary>
    internal sealed class Installer
    {
        private readonly string _root;
        private readonly string _baseUrl;
        private readonly Action<string> _log;
        private readonly Action<int, long, long> _progress;

        public Installer(string root, string baseUrl, Action<string> log, Action<int, long, long> progress)
        {
            _root = root;
            _baseUrl = baseUrl;
            _log = log ?? (s => { });
            _progress = progress ?? ((p, a, b) => { });
        }

        /// <summary>
        /// Install or update the client.
        ///
        /// Never overwrites a working build: the new version is downloaded to a
        /// temp file inside its OWN version directory, verified, and only then
        /// promoted.
        /// </summary>
        public InstallResult Run(bool forceReinstall)
        {
            var result = new InstallResult();
            try
            {
                _log("Server: " + _baseUrl);

                var client = new ManifestClient(_baseUrl);
                var build = client.Fetch();

                if (!build.IsValid)
                {
                    result.Message = "No client build is published on this server yet.";
                    return result;
                }

                _log("Published build: " + (string.IsNullOrEmpty(build.Version) ? build.BuildId : build.Version));

                var state = InstallState.Read(_root);
                result.Version = build.Version;
                string versionFolder = SafeFolderName(
                    string.IsNullOrEmpty(build.Version) ? build.BuildId : build.Version);

                EnsurePlatformContent();

                // --- The update decision ---------------------------------------
                // Up to date means: a player is installed AND the version we have
                // matches the version the server publishes.
                bool sameVersion = !string.IsNullOrEmpty(build.Version)
                    && string.Equals(state.CurrentVersion, versionFolder, StringComparison.OrdinalIgnoreCase);

                if (state.PlayerInstalled && sameVersion && !forceReinstall)
                {
                    var installedVersionDir = Path.Combine(
                        state.VersionsDir,
                        state.CurrentVersion);
                    UpdateLocalAppSettings(installedVersionDir);
                    RegisterPlayerProtocol(
                        Path.Combine(installedVersionDir, InstallerConfig.PlayerBinary),
                        InstallerConfig.InstallDir(_root));
                    result.Ok = true;
                    result.UpToDate = true;
                    result.Message = "LuckyBlox Player " + state.CurrentVersion + " is already installed and up to date.";
                    _log(result.Message);
                    return result;
                }

                if (state.PlayerInstalled && !sameVersion)
                {
                    _log("Installed version " + (string.IsNullOrEmpty(state.CurrentVersion) ? "(unknown)" : state.CurrentVersion)
                        + " -> updating to " + build.Version);
                }
                else
                {
                    _log("Installing LuckyBlox Player" + (string.IsNullOrEmpty(build.Version) ? "" : " " + build.Version));
                }

                // --- Download ---------------------------------------------------
                var versionDir = Path.Combine(
                    InstallerConfig.InstallDir(_root),
                    InstallerConfig.VersionsDir,
                    versionFolder);

                Directory.CreateDirectory(versionDir);

                var target = Path.Combine(versionDir, InstallerConfig.PlayerBinary);
                var temp = target + ".tmp";

                // Remove a stale temp from an interrupted earlier run.
                SafeDelete(temp);

                _progress(0, 0, build.Size);
                Download(build.DownloadUrl, temp, build.Size);
                _progress(100, build.Size, build.Size);

                // --- Verify ----------------------------------------------------
                VerifyWindowsExecutable(temp, build.Size, "Player");

                // --- Promote ---------------------------------------------------
                PromoteFile(temp, target);

                // Publish the studio binary if the server has one, so a single
                // install covers both surfaces.
                TryInstallStudio(versionDir, build);

                UpdateLocalAppSettings(versionDir);

                state.CurrentVersion = versionFolder;
                state.NewestVersion = versionFolder;
                WritePointer(state);
                RegisterPlayerProtocol(target, InstallerConfig.InstallDir(_root));

                result.Ok = true;
                result.Updated = state.PlayerInstalled;
                result.Message = result.Updated
                    ? "Updated LuckyBlox to " + build.Version + "."
                    : "Installed LuckyBlox " + build.Version + ".";
                _log(result.Message);

                CreateShortcuts(target);
                RegisterUninstall(_root);

                return result;
            }
            catch (WebException web)
            {
                result.Message = "Could not download the client: " + web.Message;
                result.Error = web;
                _log(result.Message);
                return result;
            }
            catch (Exception ex)
            {
                result.Message = "Install failed: " + ex.Message;
                result.Error = ex;
                _log(result.Message);
                return result;
            }
        }

        private void EnsurePlatformContent()
        {
            var installDir = InstallerConfig.InstallDir(_root);
            var sharedDir = Path.Combine(installDir, "shared");
            var contentDir = Path.Combine(sharedDir, "Content");
            var platformContentDir = Path.Combine(contentDir, "PlatformContent");
            Directory.CreateDirectory(contentDir);
            Directory.CreateDirectory(platformContentDir);

            string manifestUrl = _baseUrl + "/api/client/platform-content-manifest";
            string manifest = ManifestClient.GetString(manifestUrl);
            if (ManifestClient.JsonRaw(manifest, "available") != "true")
                throw new InvalidDataException("The server has no client platform-content files to install.");

            var entries = Regex.Matches(
                manifest,
                "\\{\\s*\"path\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"size\"\\s*:\\s*(\\d+)\\s*\\}");
            if (entries.Count == 0)
                throw new InvalidDataException("The server platform-content manifest is empty or invalid.");

            long totalBytes = 0;
            foreach (Match entry in entries)
            {
                long size;
                if (!long.TryParse(entry.Groups[2].Value, out size) || size < 0)
                    throw new InvalidDataException("The server platform-content manifest contains an invalid file size.");
                totalBytes += size;
            }

            _log("Checking " + entries.Count + " platform-content files ("
                + totalBytes.ToString(CultureInfo.InvariantCulture) + " bytes).");
            string platformRoot = Path.GetFullPath(platformContentDir) + Path.DirectorySeparatorChar;
            foreach (Match entry in entries)
            {
                string relativePath = ManifestClient.Unescape(entry.Groups[1].Value);
                string[] segments = relativePath.Split(new[] { '/', '\\' }, StringSplitOptions.None);
                if (segments.Length == 0 || segments.Any(segment =>
                    string.IsNullOrWhiteSpace(segment) || segment == "." || segment == ".."))
                    throw new InvalidDataException("The server platform-content manifest contains an unsafe path.");

                long expectedSize = long.Parse(entry.Groups[2].Value, CultureInfo.InvariantCulture);
                string destination = Path.GetFullPath(Path.Combine(platformContentDir, Path.Combine(segments)));
                if (!destination.StartsWith(platformRoot, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The server platform-content manifest contains a path outside its install folder.");

                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                if (File.Exists(destination) && new FileInfo(destination).Length == expectedSize)
                {
                    continue;
                }

                string escapedPath = string.Join("/", segments.Select(Uri.EscapeDataString));
                string temporary = destination + ".tmp";
                SafeDelete(temporary);
                Download(_baseUrl + "/PlatformContent/" + escapedPath, temporary, expectedSize);

                long actualSize = new FileInfo(temporary).Length;
                if (actualSize != expectedSize)
                {
                    SafeDelete(temporary);
                    throw new InvalidDataException(
                        "Platform-content download was incomplete for " + relativePath
                        + " (expected " + expectedSize + " bytes, received " + actualSize + ").");
                }
                PromoteFile(temporary, destination);
            }

            _log("Client platform content is ready: " + platformContentDir);
        }

        /// <summary>
        /// Pull the Studio build down too, when the server publishes one.
        ///
        /// Failure here is not fatal: a player-only install is still a valid
        /// install, so the error is logged and the install continues.
        ///
        /// This DOWNLOADS Studio over HTTP. It used to read `executablePath` from
        /// /api/studio/build-info and File.Copy() from it - but that path is a
        /// location on the SERVER's own disk, so on any machine other than the
        /// one running the server the Copy threw and Studio was silently never
        /// installed, while the log still claimed the install succeeded.
        /// </summary>
        private void TryInstallStudio(string versionDir, BuildInfo playerBuild)
        {
            try
            {
                string json = ManifestClient.GetString(_baseUrl + "/api/studio/build-info");

                // 'available' is the server's honest answer about whether a build
                // exists; a null downloadUrl means do not even try.
                string available = ManifestClient.JsonRaw(json, "available");
                string downloadUrl = ManifestClient.JsonString(json, "downloadUrl");
                string studioName = ManifestClient.JsonString(json, "binaryName");
                if (string.IsNullOrWhiteSpace(studioName)) studioName = InstallerConfig.StudioBinary;

                if (available == "false" || string.IsNullOrWhiteSpace(downloadUrl))
                {
                    _log("No Studio build is published; installing the Player only.");
                    return;
                }

                if (downloadUrl.StartsWith("/")) downloadUrl = _baseUrl + downloadUrl;

                long studioSize = ManifestClient.JsonInt64(json, "binarySize");
                var dest = Path.Combine(versionDir, studioName);
                var temp = dest + ".tmp";
                SafeDelete(temp);

                _log("Downloading Studio...");
                // Share the progress bar with the player download: the studio
                // fetch is a second, smaller transfer in the same operation.
                Download(downloadUrl, temp, studioSize);

                VerifyWindowsExecutable(temp, studioSize, "Studio");
                PromoteFile(temp, dest);
                _log("Studio installed alongside the Player.");
            }
            catch (Exception ex)
            {
                // Studio is optional. A missing Studio build does not invalidate
                // a successful Player install.
                _log("Studio was not installed: " + ex.Message);
            }
        }

        /// <summary>
        /// Write the client's AppSettings.xml pointing at THIS server, so the
        /// installed client talks to LuckyBlox rather than roblox.com.
        ///
        /// The client reads its content folder and base URL from here, so getting
        /// this wrong is what makes an otherwise good install connect to the
        /// wrong place.
        /// </summary>
        private void UpdateLocalAppSettings(string versionDir)
        {
            var path = Path.Combine(versionDir, "AppSettings.xml");
            var xml = new StringBuilder();
            xml.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
            xml.AppendLine("<Settings>");
            xml.AppendLine("  <ContentFolder>../../shared/Content</ContentFolder>");
            xml.AppendLine("  <BaseUrl>" + SecurityElement.Escape(_baseUrl + "/LuckBlox.site.tk/home/") + "</BaseUrl>");
            xml.AppendLine("</Settings>");
            WriteAtomicText(path, xml.ToString());
            _log("Wrote AppSettings.xml -> " + _baseUrl + "/LuckBlox.site.tk/home/");
        }

        /// <summary>Point version.txt at the build that is now current.</summary>
        private void WritePointer(InstallState state)
        {
            Directory.CreateDirectory(state.InstallDir);
            var folder = string.IsNullOrEmpty(state.NewestVersion) ? state.CurrentVersion : state.NewestVersion;
            if (string.IsNullOrWhiteSpace(folder))
                throw new InvalidOperationException("The installed client version could not be determined.");
            WriteAtomicText(
                Path.Combine(state.InstallDir, InstallerConfig.VersionPointerFile),
                folder);
        }

        private static void VerifyWindowsExecutable(string path, long expectedSize, string product)
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length < 64)
                throw new InvalidDataException("The " + product + " download is empty or incomplete.");
            if (expectedSize > 0 && info.Length != expectedSize)
                throw new InvalidDataException("The " + product + " download size did not match the published build (expected "
                    + expectedSize + " bytes, received " + info.Length + ").");

            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var reader = new BinaryReader(stream))
            {
                if (reader.ReadUInt16() != 0x5A4D)
                    throw new InvalidDataException("The " + product + " download is not a Windows executable.");
                stream.Position = 0x3C;
                int peOffset = reader.ReadInt32();
                if (peOffset < 64 || peOffset > stream.Length - 4)
                    throw new InvalidDataException("The " + product + " executable header is invalid.");
                stream.Position = peOffset;
                if (reader.ReadUInt32() != 0x00004550)
                    throw new InvalidDataException("The " + product + " executable header is invalid.");
            }
        }

        private static void PromoteFile(string temporary, string target)
        {
            string backup = target + ".previous";
            if (!File.Exists(target) && File.Exists(backup))
            {
                File.Move(backup, target);
            }
            else
            {
                SafeDelete(backup);
            }

            if (!File.Exists(target))
            {
                File.Move(temporary, target);
                return;
            }

            try
            {
                File.Replace(temporary, target, backup);
                SafeDelete(backup);
            }
            catch (IOException replaceError)
            {
                try
                {
                    File.Move(target, backup);
                }
                catch (IOException lockedError)
                {
                    throw new IOException("The existing client appears to be running. Close it and try again.", lockedError);
                }

                try
                {
                    File.Move(temporary, target);
                    SafeDelete(backup);
                }
                catch
                {
                    if (!File.Exists(target) && File.Exists(backup)) File.Move(backup, target);
                    throw new IOException("Could not safely replace the existing client: " + replaceError.Message);
                }
            }
        }

        private static void WriteAtomicText(string path, string contents)
        {
            string temporary = path + ".tmp";
            string backup = path + ".previous";
            SafeDelete(temporary);
            SafeDelete(backup);
            File.WriteAllText(temporary, contents, new UTF8Encoding(false));

            if (!File.Exists(path))
            {
                File.Move(temporary, path);
                return;
            }

            File.Replace(temporary, path, backup);
            SafeDelete(backup);
        }

        /// <summary>Stream a URL to a file, reporting progress.</summary>
        private void Download(string url, string destination, long expectedSize)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = 30000;
            request.ReadWriteTimeout = 60000;
            request.UserAgent = "LuckyBloxInstaller/2.0";

            using (var response = (HttpWebResponse)request.GetResponse())
            {
                long total = response.ContentLength > 0 ? response.ContentLength : expectedSize;

                using (var input = response.GetResponseStream())
                using (var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    var buffer = new byte[81920];
                    long received = 0;
                    int read;
                    int lastPercent = -1;

                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, read);
                        received += read;

                        if (total > 0)
                        {
                            int percent = (int)((received * 100) / total);
                            if (percent != lastPercent)
                            {
                                lastPercent = percent;
                                _progress(percent, received, total);
                            }
                        }
                    }

                    output.Flush();
                    // Flush to disk before the move, so a power loss cannot leave
                    // a file that looks complete but is not.
                    output.Close();
                }
            }
        }

        /* --- Small filesystem helpers ------------------------------------- */

        public static string SafeFolderName(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "unknown";
            var invalid = Path.GetInvalidFileNameChars();
            var chars = value.Trim().Select(c => invalid.Contains(c) ? '_' : c).ToArray();
            var safe = new string(chars).Trim().TrimEnd('.');
            return safe.Length == 0 || safe == "." || safe == ".." ? "unknown" : safe;
        }

        private static void SafeDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }

        /// <summary>
        /// Desktop + Start Menu shortcuts. A shortcut write can fail on a locked
        /// down machine, which is not a reason to fail the install.
        /// </summary>
        private void CreateShortcuts(string exePath)
        {
            try
            {
                var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                CreateShortcut(Path.Combine(desktop, "LuckyBlox.lnk"), exePath);

                var startMenu = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs), "LuckyBlox");
                Directory.CreateDirectory(startMenu);
                CreateShortcut(Path.Combine(startMenu, "LuckyBlox.lnk"), exePath);
            }
            catch (Exception ex)
            {
                _log("Shortcuts could not be created: " + ex.Message);
            }
        }

        /// <summary>
        /// Creates a .lnk through the Windows Script Host, the only shortcut API
        /// available from plain .NET Framework without shipping an interop DLL.
        ///
        /// Uses late-bound reflection rather than the `dynamic` keyword. `dynamic`
        /// requires a reference to Microsoft.CSharp, which the documented
        /// no-SDK build command (csc + System.Windows.Forms + System.Drawing) does
        /// not pass - so a `dynamic` version of this method fails to compile with
        /// the exact command in this file's header. Reflection needs no reference
        /// beyond what is already there.
        /// </summary>
        private static void CreateShortcut(string linkPath, string targetPath)
        {
            try
            {
                var shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;

                object shell = Activator.CreateInstance(shellType);
                object link = shellType.InvokeMember(
                    "CreateShortcut",
                    BindingFlags.InvokeMethod,
                    null, shell, new object[] { linkPath });
                if (link == null) return;

                var linkType = link.GetType();
                linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { targetPath });
                linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Path.GetDirectoryName(targetPath) });
                linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Play on LuckyBlox" });
                linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            }
            catch { }
        }

        /// <summary>
        /// Register an uninstall entry so LuckyBlox appears in Apps &amp; features
        /// and can be removed the normal Windows way.
        ///
        /// The UninstallString points at a COPY of the installer kept inside the
        /// install folder, not at the path the installer was run from. That is
        /// the difference between a working uninstall and a dead button:
        ///
        ///   - a downloaded installer usually runs from a temporary folder that
        ///     the browser or the user deletes afterwards, so a registry entry
        ///     naming that path stops resolving almost immediately;
        ///   - Windows launches the UninstallString later, as a separate process,
        ///     long after the installer that wrote it has exited.
        ///
        /// Keeping the copy in the install dir means it lives exactly as long as
        /// the thing it removes, and is deleted with it.
        /// </summary>
        private void RegisterUninstall(string root)
        {
            try
            {
                var installDir = InstallerConfig.InstallDir(root);
                Directory.CreateDirectory(installDir);

                string uninstallerPath = PrepareUninstallerCopy(installDir);

                var keyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\LuckyBlox";
                using (var key = Registry.CurrentUser.CreateSubKey(keyPath))
                {
                    if (key == null) return;
                    key.SetValue("DisplayName", "LuckyBlox");
                    key.SetValue("Publisher", "LuckyBlox");
                    key.SetValue("InstallLocation", installDir);
                    key.SetValue("DisplayVersion", InstallState.Read(_root).CurrentVersion ?? "");
                    key.SetValue("UninstallString", "\"" + uninstallerPath + "\" /Uninstall /S");
                    key.SetValue("QuietUninstallString", "\"" + uninstallerPath + "\" /Uninstall /S");
                    key.SetValue("NoModify", 1);
                    key.SetValue("NoRepair", 1);
                }
            }
            catch { }
        }

        private static void RegisterPlayerProtocol(string playerPath, string installDir)
        {
            if (!File.Exists(playerPath))
                throw new FileNotFoundException("Cannot register the LuckyBlox launch protocol without the Player executable.", playerPath);

            string handlerPath = Path.Combine(installDir, "LuckybloxInstaller.exe");
            string runningInstaller = Assembly.GetExecutingAssembly().Location;
            Directory.CreateDirectory(installDir);
            if (!string.Equals(Path.GetFullPath(runningInstaller), Path.GetFullPath(handlerPath), StringComparison.OrdinalIgnoreCase))
                File.Copy(runningInstaller, handlerPath, true);
            if (!File.Exists(handlerPath))
                throw new FileNotFoundException("Could not prepare the LuckyBlox protocol handler.", handlerPath);

            const string protocolKey = @"Software\Classes\luckyblox-player";
            using (var key = Registry.CurrentUser.CreateSubKey(protocolKey))
            {
                if (key == null)
                    throw new InvalidOperationException("Could not register the LuckyBlox player launch protocol.");
                key.SetValue("", "URL:LuckyBlox Player Protocol");
                key.SetValue("URL Protocol", "");
            }

            using (var icon = Registry.CurrentUser.CreateSubKey(protocolKey + @"\DefaultIcon"))
            {
                if (icon == null)
                    throw new InvalidOperationException("Could not register the LuckyBlox player protocol icon.");
                icon.SetValue("", "\"" + playerPath + "\",0");
            }

            using (var command = Registry.CurrentUser.CreateSubKey(protocolKey + @"\shell\open\command"))
            {
                if (command == null)
                    throw new InvalidOperationException("Could not register the LuckyBlox player protocol command.");
                command.SetValue("", "\"" + handlerPath + "\" /Launch \"%1\"");
            }
        }

        /// <summary>
        /// Copy the running installer into the install folder so the uninstall
        /// entry has a stable target that lives as long as the install does.
        ///
        /// Returns the path to run for an uninstall. If the copy cannot be made
        /// (a locked-down machine, or the installer is already there) the current
        /// executable path is returned so the entry is still usable right now
        /// rather than pointing at nothing.
        /// </summary>
        private static string PrepareUninstallerCopy(string installDir)
        {
            try
            {
                // Assembly.Location is the real on-disk path of the running exe.
                // (Application.ExecutablePath is equivalent for an exe, but this
                // avoids depending on System.Windows.Forms in this path.)
                string self = Assembly.GetExecutingAssembly().Location;
                if (string.IsNullOrEmpty(self) || !File.Exists(self)) return self ?? "";

                string target = Path.Combine(installDir, "LuckybloxInstaller.exe");

                // Do not copy a file onto itself.
                if (string.Equals(Path.GetFullPath(self), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
                {
                    return target;
                }

                File.Copy(self, target, true);
                return target;
            }
            catch
            {
                try { return Assembly.GetExecutingAssembly().Location ?? ""; }
                catch { return ""; }
            }
        }

        /// <summary>Remove the install tree and the uninstall registration.</summary>
        public static void Uninstall(string root)
        {
            try
            {
                var dir = InstallerConfig.InstallDir(root);
                if (Directory.Exists(dir))
                {
                    // A running client holds its own exe open, which makes the
                    // delete fail with a clear message rather than a partial wipe.
                    Directory.Delete(dir, true);
                }
            }
            catch (Exception ex)
            {
                throw new Exception("Could not remove " + InstallerConfig.InstallDir(root) + ": " + ex.Message);
            }

            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\LuckyBlox", false);
            }
            catch { }
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\luckyblox-player", false);
            }
            catch { }
        }
    }

    // -----------------------------------------------------------------------
    // UI
    // -----------------------------------------------------------------------

    /// <summary>
    /// The installer window: what is installed, the published version, and one
    /// action button that says the right thing for the current state.
    /// </summary>
    internal sealed class InstallerForm : Form
    {
        private readonly string _root;
        private readonly string _baseUrl;

        private Label _statusLabel;
        private Label _versionLabel;
        private Label _detailLabel;
        private ProgressBar _progress;
        private Button _actionButton;
        private Button _launchButton;
        private TextBox _logBox;

        private InstallState _state;
        private BuildInfo _build;
        private bool _busy;

        public InstallerForm(string root, string baseUrl)
        {
            _root = root;
            _baseUrl = baseUrl;

            Text = "LuckyBlox Installer";
            ClientSize = new Size(680, 500);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            Font = new Font("Segoe UI", 9f);
            BackColor = Color.FromArgb(242, 244, 247);

            BuildUi();
            Shown += (s, e) => RefreshState();
        }

        private void BuildUi()
        {
            var title = new Label
            {
                Text = "LuckyBlox",
                Font = new Font("Segoe UI", 18f, FontStyle.Bold),
                ForeColor = Color.FromArgb(25, 27, 31),
                AutoSize = true,
                Location = new Point(20, 18),
            };
            Controls.Add(title);

            var subtitle = new Label
            {
                Text = "Install, update, and launch the classic client.",
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(109, 114, 120),
                AutoSize = true,
                Location = new Point(22, 54),
            };
            Controls.Add(subtitle);

            _statusLabel = new Label
            {
                Text = "Checking for the latest version\u2026",
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                ForeColor = Color.FromArgb(25, 27, 31),
                AutoSize = false,
                Size = new Size(636, 26),
                Location = new Point(22, 92),
            };
            Controls.Add(_statusLabel);

            _versionLabel = new Label
            {
                Text = "",
                ForeColor = Color.FromArgb(109, 114, 120),
                AutoSize = false,
                Size = new Size(636, 28),
                Location = new Point(22, 122),
            };
            Controls.Add(_versionLabel);

            _progress = new ProgressBar
            {
                Location = new Point(22, 158),
                Size = new Size(636, 8),
                Style = ProgressBarStyle.Continuous,
                MarqueeAnimationSpeed = 30,
            };
            Controls.Add(_progress);

            _detailLabel = new Label
            {
                Text = "",
                ForeColor = Color.FromArgb(109, 114, 120),
                AutoSize = false,
                Size = new Size(636, 28),
                Location = new Point(22, 174),
                TextAlign = ContentAlignment.MiddleLeft,
            };
            Controls.Add(_detailLabel);

            _actionButton = new Button
            {
                Text = "Install",
                Size = new Size(176, 42),
                Location = new Point(482, 222),
                BackColor = Color.FromArgb(0, 162, 255),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                UseVisualStyleBackColor = false,
            };
            _actionButton.FlatAppearance.BorderSize = 0;
            _actionButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(0, 140, 224);
            _actionButton.FlatAppearance.MouseDownBackColor = Color.FromArgb(0, 118, 195);
            _actionButton.Click += (s, e) => RunAction();
            Controls.Add(_actionButton);

            _launchButton = new Button
            {
                Text = "Open LuckyBlox",
                Size = new Size(156, 42),
                Location = new Point(314, 222),
                BackColor = Color.White,
                ForeColor = Color.FromArgb(25, 27, 31),
                FlatStyle = FlatStyle.Flat,
                UseVisualStyleBackColor = false,
                Enabled = false,
                Visible = false,
            };
            _launchButton.FlatAppearance.BorderColor = Color.FromArgb(210, 216, 222);
            _launchButton.FlatAppearance.BorderSize = 1;
            _launchButton.Click += (s, e) => LaunchClient();
            Controls.Add(_launchButton);

            var changeFolder = new Button
            {
                Text = "Change install folder\u2026",
                Size = new Size(220, 42),
                Location = new Point(22, 222),
                BackColor = Color.White,
                ForeColor = Color.FromArgb(25, 27, 31),
                FlatStyle = FlatStyle.Flat,
                UseVisualStyleBackColor = false,
            };
            changeFolder.FlatAppearance.BorderColor = Color.FromArgb(210, 216, 222);
            changeFolder.FlatAppearance.BorderSize = 1;
            changeFolder.Click += (s, e) => ChooseFolder();
            Controls.Add(changeFolder);

            _logBox = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                Location = new Point(22, 282),
                Size = new Size(636, 192),
                BackColor = Color.FromArgb(25, 27, 31),
                ForeColor = Color.FromArgb(229, 231, 235),
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", 8.25f),
            };
            Controls.Add(_logBox);
        }

        private void Log(string message)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(Log), message);
                return;
            }
            _logBox.AppendText(message + Environment.NewLine);
        }

        /// <summary>Read both the local state and the server's published build.</summary>
        /// <remarks>
        /// Named RefreshState, not Refresh: Control already has a Refresh() that
        /// repaints the control, and hiding it (which the compiler warns about)
        /// means a caller written against the base class silently gets the wrong
        /// one. The name makes the intent explicit.
        /// </remarks>
        private void RefreshState()
        {
            _state = InstallState.Read(_root);
            _versionLabel.Text = "Install folder: " + InstallerConfig.InstallDir(_root)
                + (_state.PlayerInstalled
                    ? "   \u2022   Installed: " + (string.IsNullOrEmpty(_state.CurrentVersion) ? "unknown" : _state.CurrentVersion)
                    : "   \u2022   Not installed");

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    _build = new ManifestClient(_baseUrl).Fetch();
                }
                catch (Exception ex)
                {
                    BeginInvoke(new Action(() =>
                    {
                        _build = null;
                        _statusLabel.Text = "Could not reach the LuckyBlox server.";
                        _detailLabel.Text = ex.Message;
                        _actionButton.Text = "Retry";
                        _actionButton.Enabled = true;
                    }));
                    return;
                }

                BeginInvoke(new Action(() => ApplyState()));
            });
        }

        /// <summary>
        /// Choose the action for the current state. This is the heart of the
        /// "update, don't reinstall" behaviour: the same button installs, updates
        /// or launches depending on what is actually on disk.
        /// </summary>
        private void ApplyState()
        {
            if (_build == null || !_build.IsValid)
            {
                _statusLabel.Text = "No client build is published yet.";
                _detailLabel.Text = "The server has no client to offer. Try again once a build is uploaded.";
                _actionButton.Text = "Retry";
                _actionButton.Enabled = true;
                _launchButton.Visible = false;
                return;
            }

            bool installed = _state != null && _state.PlayerInstalled;
            bool sameVersion = installed
                && !string.IsNullOrEmpty(_build.Version)
                && string.Equals(_state.CurrentVersion, Installer.SafeFolderName(_build.Version), StringComparison.OrdinalIgnoreCase);

            _versionLabel.Text = "Install folder: " + InstallerConfig.InstallDir(_root)
                + (installed
                    ? "   \u2022   Installed: " + (string.IsNullOrEmpty(_state.CurrentVersion) ? "unknown" : _state.CurrentVersion)
                    : "   \u2022   Not installed");

            if (installed && sameVersion)
            {
                _statusLabel.Text = "LuckyBlox " + _state.CurrentVersion + " is up to date.";
                _detailLabel.Text = "Server build: " + _build.Version;
                _actionButton.Text = "Reinstall";
                _launchButton.Visible = true;
                _launchButton.Enabled = true;
            }
            else if (installed)
            {
                _statusLabel.Text = "An update is available.";
                _detailLabel.Text = "Installed: " + (string.IsNullOrEmpty(_state.CurrentVersion) ? "unknown" : _state.CurrentVersion)
                    + "   \u2192   Latest: " + _build.Version;
                _actionButton.Text = "Update";
                _launchButton.Visible = true;
                _launchButton.Enabled = true;
            }
            else
            {
                _statusLabel.Text = "LuckyBlox " + _build.Version + " is ready to install.";
                _detailLabel.Text = "It will be installed to " + InstallerConfig.InstallDir(_root);
                _actionButton.Text = "Install";
                _launchButton.Visible = false;
            }

            if (_build.Size > 0)
            {
                _detailLabel.Text += "   (" + FormatSize(_build.Size) + ")";
            }

            _actionButton.Enabled = true;
        }

        /// <summary>
        /// Run the install/update on a worker thread so the window keeps
        /// repainting and the progress bar is honest.
        /// </summary>
        private void RunAction()
        {
            if (_busy) return;
            _busy = true;
            _actionButton.Enabled = false;
            _launchButton.Enabled = false;

            // Reinstall is forced when the user explicitly clicks on an
            // already-current install; otherwise the installer decides.
            bool force = _actionButton.Text == "Reinstall";

            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = 0;
            Log("");

            ThreadPool.QueueUserWorkItem(_ =>
            {
                var installer = new Installer(
                    _root,
                    _baseUrl,
                    message => Log(message),
                    (percent, received, total) =>
                    {
                        BeginInvoke(new Action(() =>
                        {
                            _progress.Style = ProgressBarStyle.Continuous;
                            _progress.Value = Math.Max(0, Math.Min(100, percent));
                            if (total > 0)
                            {
                                _detailLabel.Text = "Downloading\u2026 " + FormatSize(received) + " of " + FormatSize(total);
                            }
                        }));
                    });

                var result = installer.Run(force);

                BeginInvoke(new Action(() =>
                {
                    _busy = false;
                    _progress.Value = result.Ok ? 100 : 0;
                    _statusLabel.Text = result.Message;
                    _actionButton.Enabled = true;
                    if (result.Ok)
                    {
                        _launchButton.Visible = true;
                        _launchButton.Enabled = true;
                    }
                    RefreshState();
                }));
            });
        }

        private void LaunchClient()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = _baseUrl,
                    UseShellExecute = true,
                });
                Log("Opened LuckyBlox in your browser. Choose a game on the site to join.");
            }
            catch (Exception ex)
            {
                Log("Could not open LuckyBlox: " + ex.Message);
            }
        }

        private void ChooseFolder()
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "Choose where LuckyBlox is installed";
                dialog.SelectedPath = _root;
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    // The chosen folder becomes the ROOT; "Luckyblox" is appended,
                    // so the user cannot accidentally install loose files into a
                    // folder they picked for something else.
                    var chosen = dialog.SelectedPath;
                    Log("Install root set to " + chosen + " (a \"" + InstallerConfig.InstallFolderName + "\" folder is created inside it)");

                    var form = new InstallerForm(chosen, _baseUrl);
                    form.Show();
                    Close();
                }
            }
        }

        private static string FormatSize(long bytes)
        {
            if (bytes <= 0) return "0 B";
            string[] units = { "B", "KB", "MB", "GB" };
            double value = bytes;
            int unit = 0;
            while (value >= 1024 && unit < units.Length - 1)
            {
                value /= 1024;
                unit++;
            }
            return string.Format(CultureInfo.InvariantCulture, "{0:0.#} {1}", value, units[unit]);
        }
    }

    // -----------------------------------------------------------------------
    // Entry point
    // -----------------------------------------------------------------------

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            // A silent run must not be disturbed by a missing WinForms
            // dependency, and must exit with a code a script can branch on.
            var options = CommandLine.Parse(args);

            try
            {
                InstallerConfig.BaseUrl = InstallerConfig.NormalizeBaseUrl(
                    string.IsNullOrWhiteSpace(options.BaseUrl) ? InstallerConfig.BaseUrl : options.BaseUrl);
            }
            catch (Exception ex)
            {
                if (options.Silent)
                {
                    AttachParentConsole();
                    Console.Error.WriteLine("Invalid LuckyBlox server URL: " + ex.Message);
                }
                else
                {
                    MessageBox.Show(ex.Message, "LuckyBlox Installer", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return 1;
            }

            // Older .NET Framework installations otherwise negotiate a TLS
            // version rejected by current public hosts.
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;

            string root = options.Root ?? InstallerConfig.DefaultRoot();

            if (!string.IsNullOrWhiteSpace(options.LaunchUri))
            {
                return LaunchClientFromProtocolUri(options.LaunchUri, root);
            }

            // --- State check ---------------------------------------------------
            // Reports what is installed and what the server publishes, changing
            // nothing. This is what the launcher calls to decide whether to show
            // "Play" or "Update" without ever triggering an install.
            // Exit 0 = installed and current, 1 = not installed or unreachable,
            // 2 = installed but an update is available.
            if (options.Check)
            {
                AttachParentConsole();

                var state = InstallState.Read(root);
                Console.WriteLine("install dir : " + InstallerConfig.InstallDir(root));
                Console.WriteLine("installed   : " + (state.PlayerInstalled
                    ? (string.IsNullOrEmpty(state.CurrentVersion) ? "unknown version" : state.CurrentVersion)
                    : "no"));

                try
                {
                    var build = new ManifestClient(InstallerConfig.BaseUrl).Fetch();
                    Console.WriteLine("published   : " + (build.IsValid ? build.Version : "(no build published)"));

                    if (!build.IsValid) return 2;
                    if (!state.PlayerInstalled) return 1;

                    bool same = !string.IsNullOrEmpty(build.Version)
                        && string.Equals(state.CurrentVersion, Installer.SafeFolderName(build.Version), StringComparison.OrdinalIgnoreCase);
                    return same ? 0 : 2;
                }
                catch (Exception ex)
                {
                    Console.WriteLine("published   : unreachable (" + ex.Message + ")");
                    return state.PlayerInstalled ? 0 : 1;
                }
            }

            // --- Uninstall -----------------------------------------------------
            if (options.Uninstall)
            {
                try
                {
                    Installer.Uninstall(root);
                    if (!options.Silent) MessageBox.Show("LuckyBlox was removed.", "LuckyBlox Installer",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
                catch (Exception ex)
                {
                    if (!options.Silent) MessageBox.Show(ex.Message, "LuckyBlox Installer",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Console.Error.WriteLine(ex.Message);
                    return 1;
                }
            }

            // --- Silent install / update ---------------------------------------
            // Prints progress to stdout and returns 0/1, so a script or the
            // launcher can drive it without a UI.
            if (options.Silent)
            {
                // This is a /target:winexe binary, so it has NO console of its
                // own: without this the whole progress log below is written to a
                // null handle and a caller invoking `/S` from a script sees
                // nothing at all. Attaching to the parent's console is what makes
                // the output visible when one is inherited (cmd, the launcher
                // using a pipe) while staying invisible on a double-click.
                AttachParentConsole();

                var installer = new Installer(
                    root,
                    InstallerConfig.BaseUrl,
                    message => Console.WriteLine(message),
                    (percent, received, total) =>
                    {
                        if (total > 0) Console.Write("\r{0}% ", percent);
                    });

                var result = installer.Run(options.Force);
                Console.WriteLine();

                // Report the failure through a dialog only when there is no
                // console to read: in a script the exit code is the contract,
                // and a modal box would hang the automation.
                if (!result.Ok && !HasConsole())
                {
                    MessageBox.Show(
                        result.Message,
                        "LuckyBlox Installer",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }

                return result.Ok ? 0 : 1;
            }

            // --- Normal windowed run -------------------------------------------
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm(root, InstallerConfig.BaseUrl));
            return 0;
        }

        private static int LaunchClientFromProtocolUri(string launchUri, string root)
        {
            try
            {
                var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (Match match in Regex.Matches(launchUri, @"(?:^|\+)([A-Za-z][A-Za-z0-9_-]*):([^+]*)"))
                {
                    values[match.Groups[1].Value] = Uri.UnescapeDataString(match.Groups[2].Value);
                }

                string ticket;
                string placeText;
                string userText;
                string portText;
                string jobId;
                string requestedBaseUrl;
                if (!values.TryGetValue("gameinfo", out ticket)
                    || !values.TryGetValue("placeId", out placeText)
                    || !values.TryGetValue("serverPort", out portText)
                    || !values.TryGetValue("jobId", out jobId))
                    throw new FormatException("The LuckyBlox game link is missing launch information.");
                values.TryGetValue("userId", out userText);
                values.TryGetValue("baseUrl", out requestedBaseUrl);

                long placeId;
                long userId = 0;
                int port;
                if (string.IsNullOrWhiteSpace(ticket)
                    || !long.TryParse(placeText, NumberStyles.None, CultureInfo.InvariantCulture, out placeId)
                    || placeId <= 0
                    || (!string.IsNullOrWhiteSpace(userText)
                        && (!long.TryParse(userText, NumberStyles.None, CultureInfo.InvariantCulture, out userId)
                            || userId <= 0))
                    || !int.TryParse(portText, NumberStyles.None, CultureInfo.InvariantCulture, out port)
                    || port <= 0
                    || port > 65535
                    || string.IsNullOrWhiteSpace(jobId))
                    throw new FormatException("The LuckyBlox game link contains invalid launch information.");

                var state = InstallState.Read(root);
                string versionDir = Path.Combine(state.VersionsDir, state.CurrentVersion ?? "");
                string playerPath = Path.Combine(versionDir, InstallerConfig.PlayerBinary);
                if (!File.Exists(playerPath))
                    playerPath = Path.Combine(InstallerConfig.InstallDir(root), InstallerConfig.PlayerBinary);
                if (!File.Exists(playerPath))
                    throw new FileNotFoundException("The LuckyBlox Player is not installed. Run the installer and try again.", playerPath);

                string baseUrl = InstallerConfig.NormalizeBaseUrl(
                    string.IsNullOrWhiteSpace(requestedBaseUrl) ? InstallerConfig.BaseUrl : requestedBaseUrl).TrimEnd('/');
                string authUrl = baseUrl + "/v1/authentication-tickets?";
                if (userId > 0) authUrl += "userId=" + userId.ToString(CultureInfo.InvariantCulture) + "&";
                authUrl += "placeId=" + placeId.ToString(CultureInfo.InvariantCulture);
                string joinUrl = baseUrl + "/game/join?placeId="
                    + placeId.ToString(CultureInfo.InvariantCulture)
                    + (userId > 0 ? "&userId=" + userId.ToString(CultureInfo.InvariantCulture) : "")
                    + "&ticket=" + Uri.EscapeDataString(ticket)
                    + "&serverPort=" + port.ToString(CultureInfo.InvariantCulture)
                    + "&jobId=" + Uri.EscapeDataString(jobId);

                WriteLaunchLog(root, "Starting Player for place " + placeId + ", job " + jobId + ".");
                var child = Process.Start(new ProcessStartInfo
                {
                    FileName = playerPath,
                    WorkingDirectory = Path.GetDirectoryName(playerPath),
                    Arguments = "-a " + QuoteArgument(authUrl)
                        + " -t " + QuoteArgument(ticket)
                        + " -j " + QuoteArgument(joinUrl),
                    UseShellExecute = true,
                });
                if (child == null)
                    throw new InvalidOperationException("Windows did not start the LuckyBlox Player.");
                int childPid = child.Id;
                child.EnableRaisingEvents = true;
                child.Exited += (sender, eventArgs) =>
                {
                    WriteLaunchLog(root, "Player process " + childPid + " exited with code " + child.ExitCode + ".");
                };
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "LuckyBlox could not start this game.\n\n" + ex.Message,
                    "LuckyBlox Player",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }
        }

        private static string QuoteArgument(string value)
        {
            return "\"" + (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        private static void WriteLaunchLog(string root, string message)
        {
            try
            {
                string logDir = Path.Combine(InstallerConfig.InstallDir(root), "Logs");
                Directory.CreateDirectory(logDir);
                File.AppendAllText(
                    Path.Combine(logDir, "client-launch.log"),
                    DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch (IOException error)
            {
                Console.Error.WriteLine("Could not write LuckyBlox launch log: " + error.Message);
            }
            catch (UnauthorizedAccessException error)
            {
                Console.Error.WriteLine("Could not write LuckyBlox launch log: " + error.Message);
            }
        }

        [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int processId);

        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        private static extern IntPtr GetConsoleWindow();

        private const int ATTACH_PARENT_PROCESS = -1;

        /// <summary>
        /// Attach to the console we were launched from, if any.
        ///
        /// A winexe has no console; AttachConsole hands us the parent's so
        /// Console.WriteLine actually lands somewhere. It fails harmlessly (the
        /// return value is false) when there is no parent console - i.e. a
        /// double-click - which is exactly when we want no output anyway.
        /// </summary>
        private static void AttachParentConsole()
        {
            try { AttachConsole(ATTACH_PARENT_PROCESS); }
            catch { }
        }

        /// <summary>True when this process can actually write to a console.</summary>
        private static bool HasConsole()
        {
            try { return GetConsoleWindow() != IntPtr.Zero; }
            catch { return false; }
        }
    }

    /// <summary>
    /// Command-line parsing for the switches the installer accepts.
    ///
    ///   /S  or  /silent      no UI, exit code says whether it worked
    ///   /Update              force an update check even when it looks current
    ///   /Force               reinstall over the current version
    ///   /Uninstall           remove the install
    ///   /Check               report install/update state and exit (no changes)
    ///   /root "C:\path"      install root (the "Luckyblox" folder is created in it)
    ///   /base "https://..."  point at a specific LuckyBlox server
    /// </summary>
    internal sealed class CommandLine
    {
        public bool Silent;
        public bool Force;
        public bool Uninstall;
        public bool Check;
        public string Root;
        public string BaseUrl;
        public string LaunchUri;

        public static CommandLine Parse(string[] args)
        {
            var options = new CommandLine();
            if (args == null) return options;

            for (int i = 0; i < args.Length; i++)
            {
                var arg = (args[i] ?? "").Trim();
                var lower = arg.ToLowerInvariant();

                switch (lower)
                {
                    case "/s":
                    case "/silent":
                    case "--silent":
                        options.Silent = true;
                        break;
                    case "/update":
                    case "--update":
                        // An update run is a normal run that never reports
                        // "already up to date" without re-checking the server.
                        options.Force = false;
                        break;
                    case "/force":
                    case "--force":
                        options.Force = true;
                        break;
                    case "/uninstall":
                    case "--uninstall":
                        options.Uninstall = true;
                        break;
                    case "/check":
                    case "--check":
                        options.Check = true;
                        break;
                    case "/root":
                    case "--root":
                        if (i + 1 < args.Length) options.Root = args[++i];
                        break;
                    case "/base":
                    case "--base":
                    case "/url":
                        if (i + 1 < args.Length) options.BaseUrl = args[++i];
                        break;
                    case "/launch":
                    case "--launch":
                        if (i + 1 < args.Length) options.LaunchUri = args[++i];
                        break;
                }
            }

            return options;
        }
    }
}