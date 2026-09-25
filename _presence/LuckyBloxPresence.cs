// LuckyBlox Discord Presence
//
// A small standalone companion that shows a Discord Rich Presence for LuckyBlox.
// It lives beside the launcher and never modifies or injects into it: it only
// reads the launcher's own Settings files and looks at running processes.
//
// Build (no SDK needed, uses the in-box .NET Framework compiler):
//   csc.exe /target:winexe /out:LuckyBloxPresence.exe /r:DiscordRPC.dll LuckyBloxPresence.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using DiscordRPC;
using DiscordRPC.Logging;

namespace LuckyBloxPresence
{
    /// <summary>Everything the companion needs, loaded from presence.config.json.</summary>
    internal sealed class PresenceConfig
    {
        public string ApplicationId = "1552282667964178472";
        public string DetailsPrefix = "LuckyBlox:";
        public string Details = "LuckyBlox:customblox";
        public bool ShowUsername = true;
        public string StateWhenLauncherOnly = "Browsing the launcher";
        public string LargeImageKey = "luckyblox";
        public string LargeImageText = "LuckyBlox";
        public string SmallImageKey = "";
        public string SmallImageText = "";
        public bool ShowTimer = true;
        public List<string> GameProcesses = new List<string>();
        public List<string> LauncherProcesses = new List<string>();
        public string SettingsRelativePath = "Settings";
        public string UsernameFile = "username.txt";
        public string ClientFile = "SelectedClient.txt";
        public string RpcToggleFile = "DiscordRPC.txt";
        public int PollSeconds = 5;

        // --- Game tracking -------------------------------------------------
        // The launcher writes the map it is running into MapPath.txt, and the
        // game server writes its own limits into gameserverraw.json. Reading
        // those is how we learn which game the user is actually in.
        public string MapPathFile = "MapPath.txt";
        public string GameServerFile = "gameserverraw.json";

        // Live party sizing. The companion asks the launcher's own API for the
        // job it is running so "3 of 30" is real data, not a guess.
        public bool ShowPlayerCount = true;
        public string ApiBaseUrl = "http://127.0.0.1:2005";
        public string JobIdFile = "jobid.txt";
        public bool ShowSlotsLeft = true;

        // The bridge writes its real HTTP base here when a session starts, because
        // its port is not fixed (3001/3002 locally, platform-injected in the
        // cloud). ApiBaseUrl stays the fallback for a launcher-only session.
        public string ApiBaseUrlFile = "apibaseurl.txt";

        // Discord image keys are per-application. A place id maps to an asset
        // key uploaded at 512x512, so the card shows the real game icon.
        //   { "1818": "game_1818_jailbreak" }
        public Dictionary<string, string> GameImageKeys = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public bool FetchLiveIcons = false;
        public string IconCacheRelativePath = "_presence/iconcache";

        private static string Str(IDictionary<string, object> map, string key, string fallback)
        {
            object value;
            if (map != null && map.TryGetValue(key, out value) && value != null)
            {
                string s = value as string;
                if (s != null) return s;
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            }
            return fallback;
        }

        private static bool Bool(IDictionary<string, object> map, string key, bool fallback)
        {
            object value;
            if (map != null && map.TryGetValue(key, out value) && value != null)
            {
                if (value is bool) return (bool)value;
                bool parsed;
                if (bool.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out parsed)) return parsed;
            }
            return fallback;
        }

        private static int Int(IDictionary<string, object> map, string key, int fallback)
        {
            object value;
            if (map != null && map.TryGetValue(key, out value) && value != null)
            {
                int parsed;
                if (int.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out parsed)) return parsed;
            }
            return fallback;
        }

        private static List<string> List(IDictionary<string, object> map, string key)
        {
            var result = new List<string>();
            object value;
            if (map == null || !map.TryGetValue(key, out value) || value == null) return result;
            var arr = value as System.Collections.IEnumerable;
            if (arr == null || value is string) return result;
            foreach (object item in arr)
            {
                string s = Convert.ToString(item, CultureInfo.InvariantCulture);
                if (!string.IsNullOrWhiteSpace(s)) result.Add(s.Trim());
            }
            return result;
        }

        public static PresenceConfig Load(string path)
        {
            var config = new PresenceConfig();
            if (!File.Exists(path)) return config;

            // A deliberately small JSON reader: the config file is flat and this
            // keeps the companion dependency-free (no Newtonsoft, no SDK).
            string text;
            try { text = File.ReadAllText(path, Encoding.UTF8).Replace("\uFEFF", ""); }
            catch { return config; }

            var map = MiniJson.ParseObject(text);
            if (map == null) return config;

            config.ApplicationId = Str(map, "applicationId", config.ApplicationId);
            config.DetailsPrefix = Str(map, "detailsPrefix", config.DetailsPrefix);
            config.Details = Str(map, "details", config.Details);
            config.ShowUsername = Bool(map, "showUsername", config.ShowUsername);
            config.StateWhenLauncherOnly = Str(map, "stateWhenLauncherOnly", config.StateWhenLauncherOnly);
            config.LargeImageKey = Str(map, "largeImageKey", config.LargeImageKey);
            config.LargeImageText = Str(map, "largeImageText", config.LargeImageText);
            config.SmallImageKey = Str(map, "smallImageKey", config.SmallImageKey);
            config.SmallImageText = Str(map, "smallImageText", config.SmallImageText);
            config.ShowTimer = Bool(map, "showTimer", config.ShowTimer);
            config.SettingsRelativePath = Str(map, "settingsRelativePath", config.SettingsRelativePath);
            config.UsernameFile = Str(map, "usernameFile", config.UsernameFile);
            config.ClientFile = Str(map, "clientFile", config.ClientFile);
            config.RpcToggleFile = Str(map, "rpcToggleFile", config.RpcToggleFile);
            config.PollSeconds = Math.Max(2, Int(map, "pollSeconds", config.PollSeconds));

            config.MapPathFile = Str(map, "mapPathFile", config.MapPathFile);
            config.GameServerFile = Str(map, "gameServerFile", config.GameServerFile);
            config.ShowPlayerCount = Bool(map, "showPlayerCount", config.ShowPlayerCount);
            config.ApiBaseUrl = Str(map, "apiBaseUrl", config.ApiBaseUrl);
            config.ApiBaseUrlFile = Str(map, "apiBaseUrlFile", config.ApiBaseUrlFile);
            config.JobIdFile = Str(map, "jobIdFile", config.JobIdFile);
            config.ShowSlotsLeft = Bool(map, "showSlotsLeft", config.ShowSlotsLeft);
            config.FetchLiveIcons = Bool(map, "fetchLiveIcons", config.FetchLiveIcons);
            config.IconCacheRelativePath = Str(map, "iconCacheRelativePath", config.IconCacheRelativePath);
            config.GameImageKeys = LoadStringMap(map, "gameImageKeys");

            var games = List(map, "gameProcesses");
            config.GameProcesses = games.Count > 0
                ? games
                : new List<string> { "RobloxPlayerBeta", "RobloxStudioBeta", "RobloxStudio" };

            var launchers = List(map, "launcherProcesses");
            config.LauncherProcesses = launchers.Count > 0
                ? launchers
                : new List<string> { "LuckyBlox Launcher" };

            if (string.IsNullOrWhiteSpace(config.ApplicationId)) config.ApplicationId = "1552282667964178472";
            if (string.IsNullOrWhiteSpace(config.Details)) config.Details = "LuckyBlox:customblox";
            if (string.IsNullOrWhiteSpace(config.DetailsPrefix)) config.DetailsPrefix = "LuckyBlox:";
            return config;
        }

        /// <summary>Reads a {"key":"value"} block - used for gameImageKeys.</summary>
        private static Dictionary<string, string> LoadStringMap(IDictionary<string, object> map, string key)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            object value;
            if (map == null || !map.TryGetValue(key, out value) || value == null) return result;

            var nested = value as IDictionary<string, object>;
            if (nested == null) return result;

            foreach (var pair in nested)
            {
                string s = Convert.ToString(pair.Value, CultureInfo.InvariantCulture);
                if (!string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrWhiteSpace(s))
                {
                    result[pair.Key.Trim()] = s.Trim();
                }
            }
            return result;
        }
    }

    /// <summary>Minimal flat-JSON reader - enough for presence.config.json.</summary>
    internal static class MiniJson
    {
        public static IDictionary<string, object> ParseObject(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            int i = 0;
            return ParseObjectAt(text, ref i);
        }

        private static IDictionary<string, object> ParseObjectAt(string s, ref int i)
        {
            var map = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            SkipWhitespace(s, ref i);
            if (i >= s.Length || s[i] != '{') return null;
            i++;

            while (true)
            {
                SkipWhitespace(s, ref i);
                if (i >= s.Length) break;
                if (s[i] == '}') { i++; break; }
                if (s[i] == ',') { i++; continue; }

                string key = ParseString(s, ref i);
                if (key == null) break;
                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == ':') i++;
                SkipWhitespace(s, ref i);

                object value = ParseValue(s, ref i);
                map[key] = value;

                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == ',') i++;
            }
            return map;
        }

        private static object ParseValue(string s, ref int i)
        {
            SkipWhitespace(s, ref i);
            if (i >= s.Length) return null;
            char c = s[i];

            if (c == '{') return ParseObjectAt(s, ref i);
            if (c == '[') return ParseArray(s, ref i);
            if (c == '"') return ParseString(s, ref i);
            if (c == 't' && i + 4 <= s.Length && s.Substring(i, 4) == "true") { i += 4; return true; }
            if (c == 'f' && i + 5 <= s.Length && s.Substring(i, 5) == "false") { i += 5; return false; }
            if (c == 'n' && i + 4 <= s.Length && s.Substring(i, 4) == "null") { i += 4; return null; }
            return ParseNumber(s, ref i);
        }

        private static List<object> ParseArray(string s, ref int i)
        {
            var list = new List<object>();
            i++; // [
            while (true)
            {
                SkipWhitespace(s, ref i);
                if (i >= s.Length) break;
                if (s[i] == ']') { i++; break; }
                if (s[i] == ',') { i++; continue; }
                list.Add(ParseValue(s, ref i));
                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == ',') i++;
            }
            return list;
        }

        private static string ParseString(string s, ref int i)
        {
            SkipWhitespace(s, ref i);
            if (i >= s.Length || s[i] != '"') return null;
            i++;
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') break;
                if (c == '\\' && i < s.Length)
                {
                    char e = s[i++];
                    switch (e)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 't': sb.Append('\t'); break;
                        case 'r': sb.Append('\r'); break;
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'u':
                            if (i + 4 <= s.Length)
                            {
                                int code;
                                if (int.TryParse(s.Substring(i, 4), NumberStyles.HexNumber,
                                        CultureInfo.InvariantCulture, out code))
                                {
                                    sb.Append((char)code);
                                    i += 4;
                                }
                            }
                            break;
                        default: sb.Append(e); break;
                    }
                    continue;
                }
                sb.Append(c);
            }
            return sb.ToString();
        }

        private static object ParseNumber(string s, ref int i)
        {
            int start = i;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' ||
                                     s[i] == 'e' || s[i] == 'E')) i++;
            string text = s.Substring(start, i - start);
            double d;
            if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            return text;
        }

        private static void SkipWhitespace(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }
    }

    /// <summary>
    /// What the user is playing right now, assembled from the launcher's own
    /// runtime files rather than guessed from a process name.
    /// </summary>
    internal sealed class GameContext
    {
        public string Title = "";          // "Jailbreak"
        public int PlaceId = 0;             // 1818
        public int MaxPlayers = 0;          // server slot size
        public int PlayerCount = -1;        // -1 = unknown
        public string IconKey = "";         // Discord asset key for 512x512 icon
        public string JobId = "";

        public bool Known { get { return !string.IsNullOrEmpty(Title) || PlaceId > 0; } }

        /// "3/30 (27 slots left)" style summary, or "" when we have nothing.
        public string SlotSummary()
        {
            if (MaxPlayers <= 0) return "";
            if (PlayerCount < 0) return "0 of " + MaxPlayers + " players";
            string text = PlayerCount + " of " + MaxPlayers + " players";
            int left = MaxPlayers - PlayerCount;
            if (left < 0) left = 0;
            text += left == 1 ? " - 1 slot left" : " - " + left + " slots left";
            return text;
        }
    }

    /// <summary>
    /// Turns the launcher's on-disk state into a GameContext. Reads the map the
    /// client actually loaded and the limits the game server declared.
    /// </summary>
    internal static class GameWatcher
    {
        /// <summary>Quotation mark as a string, without fighting C# escaping.</summary>
        internal static string Quote()
        {
            return ((char)34).ToString();
        }

        /// <summary>
        /// "2017 - Jailbreak.rbxl" -> "Jailbreak", and pulls the leading year
        /// off as the place id the same way the web bridge does.
        /// </summary>
        public static void ParseMapName(string mapPath, GameContext ctx)
        {
            if (string.IsNullOrWhiteSpace(mapPath)) return;

            string file = mapPath.Trim().Trim('"');
            try { file = Path.GetFileName(file); } catch { return; }
            if (string.IsNullOrEmpty(file)) return;

            string name = Path.GetFileNameWithoutExtension(file);
            if (string.IsNullOrEmpty(name)) return;

            // Split into year + title, then soften filename separators so the
            // card reads like a game title rather than a file name.
            var match = System.Text.RegularExpressions.Regex.Match(name, @"^\s*(\d{4})\s*[-_:]\s*(.+)$");
            if (match.Success)
            {
                int year;
                if (int.TryParse(match.Groups[1].Value, out year))
                {
                    ctx.PlaceId = year;
                }
                name = match.Groups[2].Value;
            }

            char space = (char)32;
            name = name.Replace('_', space).Replace('-', space);
            name = System.Text.RegularExpressions.Regex.Replace(name, @"\s+", space.ToString()).Trim();
            if (!string.IsNullOrEmpty(name)) ctx.Title = name;
        }

        /// <summary>
        /// gameserverraw.json carries the authoritative slot size. The file is
        /// formatted by hand so we scan for the keys instead of parsing it.
        /// </summary>
        public static void ParseServerFile(string json, GameContext ctx)
        {
            if (string.IsNullOrWhiteSpace(json)) return;

            int maxPlayers = ExtractInt(json, "MaxPlayers");
            if (maxPlayers <= 0) maxPlayers = ExtractInt(json, "PreferredPlayerCapacity");
            if (maxPlayers > 0) ctx.MaxPlayers = maxPlayers;

            int placeId = ExtractInt(json, "PlaceId");
            if (placeId > 0 && ctx.PlaceId <= 0) ctx.PlaceId = placeId;

            // A literal "%port%" is a template, not a real value - ignore it.
            string machine = ExtractString(json, "MachineAddress");
            if (!string.IsNullOrWhiteSpace(machine)) ctx.JobId = ctx.JobId ?? "";
        }

        private static int ExtractInt(string json, string key)
        {
            var match = System.Text.RegularExpressions.Regex.Match(
                json, Quote() + System.Text.RegularExpressions.Regex.Escape(key) + Quote() + "\\s*:\\s*(\\d+)");
            if (!match.Success) return 0;
            int value;
            return int.TryParse(match.Groups[1].Value, out value) ? value : 0;
        }

        private static string ExtractString(string json, string key)
        {
            var match = System.Text.RegularExpressions.Regex.Match(
                json, Quote() + System.Text.RegularExpressions.Regex.Escape(key) + Quote() + "\\s*:\\s*" + Quote() + "([^" + Quote() + "]*)" + Quote());
            return match.Success ? match.Groups[1].Value : "";
        }
    }

    internal static class Program
    {
        /// <summary>Quotation mark as a string, without fighting C# escaping.</summary>
        private static string Quote()
        {
            return ((char)34).ToString();
        }

        private static string _baseDir;
        private static DateTime _startedAt;
        private static DiscordRpcClient _client;
        private static string _lastFingerprint = "";

        [STAThread]
        private static void Main(string[] args)
        {
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            _startedAt = DateTime.UtcNow;

            // Only touch the console encoding when we actually own a console.
            // Setting it while stdout is redirected throws IOException, which
            // would kill the process before it ever reaches Discord.
            try { Console.OutputEncoding = Encoding.UTF8; }
            catch (IOException) { }

            var configPath = Path.Combine(_baseDir, "presence.config.json");
            var config = PresenceConfig.Load(configPath);

            Log("LuckyBlox Discord Presence");
            Log("  config      : " + (File.Exists(configPath) ? configPath : "(missing - using defaults)"));
            Log("  application : " + config.ApplicationId);
            Log("  details     : " + config.Details);

            _client = new DiscordRpcClient(config.ApplicationId);
            _client.Logger = new ConsoleLogger { Level = LogLevel.Warning };

            bool connected = false;
            try
            {
                connected = _client.Initialize();
            }
            catch (Exception ex)
            {
                Log("  ERROR initialising Discord: " + ex.Message);
            }

            if (!connected)
            {
                Log("");
                Log("Discord is not running, or the application id was rejected.");
                Log("Start Discord and run this again.");
            }
            else
            {
                Log("  connected to Discord.");
            }

            if (args.Any(a => string.Equals(a, "--once", StringComparison.OrdinalIgnoreCase)))
            {
                ApplyPresence(config, true);
                Thread.Sleep(1500);
                if (_client != null) _client.Dispose();
                return;
            }

            Log("");
            Log("Watching for the launcher and client. Close this window to stop.");
            Log("");

            while (true)
            {
                try
                {
                    if (!_client.IsInitialized) { Thread.Sleep(3000); continue; }
                    ApplyPresence(config, false);
                }
                catch (Exception ex)
                {
                    Log("loop error: " + ex.Message);
                }
                Thread.Sleep(config.PollSeconds * 1000);
            }
        }

        private static bool IsRunning(string processName)
        {
            try
            {
                var procs = Process.GetProcessesByName(processName);
                bool any = procs.Length > 0;
                foreach (var p in procs) p.Dispose();
                return any;
            }
            catch { return false; }
        }

        private static string ReadSetting(PresenceConfig config, string fileName)
        {
            try
            {
                var path = Path.Combine(_baseDir, config.SettingsRelativePath, fileName);
                if (!File.Exists(path)) return "";
                return File.ReadAllText(path, Encoding.UTF8).Replace("\uFEFF", "").Trim();
            }
            catch { return ""; }
        }

        /// <summary>
        /// Builds the picture of what the user is playing from the launcher's
        /// own runtime files, then enriches it with live slot data from the
        /// local API when that is reachable.
        /// </summary>
        private static GameContext ReadGameContext(PresenceConfig config)
        {
            var ctx = new GameContext();

            // Which map the client actually loaded.
            GameWatcher.ParseMapName(ReadSetting(config, config.MapPathFile), ctx);

            // The slot size the game server declared for itself.
            try
            {
                var serverPath = Path.Combine(_baseDir, config.SettingsRelativePath, config.GameServerFile);
                if (File.Exists(serverPath))
                {
                    GameWatcher.ParseServerFile(File.ReadAllText(serverPath, Encoding.UTF8), ctx);
                }
            }
            catch { }

            // Live occupancy, if the launcher's API is up. Failure is normal and
            // simply leaves PlayerCount at -1 so we fall back to a max-only line.
            if (config.ShowPlayerCount)
            {
                string jobId = ReadSetting(config, config.JobIdFile);
                if (!string.IsNullOrEmpty(jobId))
                {
                    ctx.JobId = jobId;
                    TryFillLiveSlots(config, ctx);
                }
            }

            // Per-game 512x512 icon, keyed by place id.
            string key;
            if (ctx.PlaceId > 0 && config.GameImageKeys.TryGetValue(ctx.PlaceId.ToString(), out key))
            {
                ctx.IconKey = key;
            }

            return ctx;
        }

        /// <summary>
        /// Asks the launcher's job endpoint for real player counts. Uses the
        /// in-box WebClient so the companion still needs no NuGet packages.
        ///
        /// The endpoint also reports the experience's own name (placeName), which
        /// is authoritative: it comes from the server's games.json. That matters
        /// because MapPath.txt is written by the desktop launcher and does not
        /// exist when the client is driven straight from the website, so without
        /// this the card would show the slot counts but no game name.
        /// </summary>
        private static void TryFillLiveSlots(PresenceConfig config, GameContext ctx)
        {
            // Prefer the base the bridge published for THIS session; fall back to
            // the configured one for a launcher-only run.
            string baseUrl = ReadSetting(config, config.ApiBaseUrlFile);
            if (string.IsNullOrWhiteSpace(baseUrl)) baseUrl = config.ApiBaseUrl;

            var url = baseUrl.TrimEnd('/') + "/api/jobs/" + Uri.EscapeDataString(ctx.JobId);

            try
            {
                using (var wc = new System.Net.WebClient())
                {
                    wc.Encoding = Encoding.UTF8;
                    wc.Headers.Add("User-Agent", "LuckyBloxPresence/1.0");

                    string json = null;
                    var task = System.Threading.Tasks.Task.Run(() => json = wc.DownloadString(url));
                    if (!task.Wait(TimeSpan.FromSeconds(2))) return;
                    if (string.IsNullOrWhiteSpace(json)) return;

                    int live = ExtractJsonInt(json, "playerCount");
                    if (live >= 0) ctx.PlayerCount = live;

                    int max = ExtractJsonInt(json, "maxPlayers");
                    if (max > 0) ctx.MaxPlayers = max;

                    // Prefer the server's name, but never overwrite a title we
                    // already resolved locally with an empty value.
                    string name = ExtractJsonString(json, "placeName");
                    if (!string.IsNullOrWhiteSpace(name)) ctx.Title = name;

                    int placeId = ExtractJsonInt(json, "placeId");
                    if (ctx.PlaceId <= 0 && placeId > 0) ctx.PlaceId = placeId;
                }
            }
            catch { }
        }

        private static int ExtractJsonInt(string json, string key)
        {
            var match = System.Text.RegularExpressions.Regex.Match(
                json, Quote() + System.Text.RegularExpressions.Regex.Escape(key) + Quote() + "\\s*:\\s*(-?\\d+)");
            if (!match.Success) return -1;
            int value;
            return int.TryParse(match.Groups[1].Value, out value) ? value : -1;
        }

        /// <summary>Reads a JSON string value, tolerating a null (returns "").</summary>
        private static string ExtractJsonString(string json, string key)
        {
            var match = System.Text.RegularExpressions.Regex.Match(
                json,
                Quote() + System.Text.RegularExpressions.Regex.Escape(key) + Quote() + "\\s*:\\s*" + Quote() + "([^" + Quote() + "]*)" + Quote());
            return match.Success ? match.Groups[1].Value : "";
        }

        /// Reads the launcher's own DiscordRPC.txt toggle so this companion
        /// respects the same on/off switch the launcher already exposes.
        private static bool RpcEnabledByLauncher(PresenceConfig config)
        {
            string value = ReadSetting(config, config.RpcToggleFile);
            if (string.IsNullOrEmpty(value)) return true;
            string v = value.ToLowerInvariant();
            if (v.Contains("disabled") || v.Contains("off") || v.Contains("false") || v.StartsWith("0")) return false;
            return true;
        }

        private static void ApplyPresence(PresenceConfig config, bool verbose)
        {
            if (!RpcEnabledByLauncher(config))
            {
                if (_lastFingerprint != "disabled")
                {
                    Log("Discord RPC disabled by " + config.RpcToggleFile);
                    _lastFingerprint = "disabled";
                }
                _client.ClearPresence();
                return;
            }

            string username = config.ShowUsername ? ReadSetting(config, config.UsernameFile) : "";
            string client = ReadSetting(config, config.ClientFile);

            bool inGame = config.GameProcesses.Any(IsRunning);
            bool launcherUp = config.LauncherProcesses.Any(IsRunning);

            if (!inGame && !launcherUp)
            {
                if (_lastFingerprint != "idle")
                {
                    Log("Nothing running - clearing presence.");
                    _lastFingerprint = "idle";
                }
                _client.ClearPresence();
                return;
            }

            // "LuckyBlox:<game>" - the specific game when we know it, and the
            // configured generic line when we are only sitting in the launcher.
            string details = config.Details;
            string largeImageKey = config.LargeImageKey;
            string largeImageText = config.LargeImageText;
            string slotLine = "";
            string gameTitle = "";

            if (inGame)
            {
                var game = ReadGameContext(config);
                if (game.Known && !string.IsNullOrEmpty(game.Title))
                {
                    gameTitle = game.Title;
                    details = config.DetailsPrefix + game.Title;

                    // A 512x512 per-game asset beats the generic logo.
                    if (!string.IsNullOrEmpty(game.IconKey))
                    {
                        largeImageKey = game.IconKey;
                        largeImageText = game.Title;
                    }
                }

                slotLine = game.SlotSummary();
            }

            string state = inGame
                ? (string.IsNullOrEmpty(client) ? "In game" : "Playing on " + client)
                : config.StateWhenLauncherOnly;

            if (config.ShowPlayerCount && !string.IsNullOrEmpty(slotLine))
            {
                state = slotLine;
            }

            if (config.ShowUsername && !string.IsNullOrEmpty(username))
            {
                state = state + " - " + username;
            }

            var presence = new RichPresence
            {
                Details = details,
                State = state,
                Assets = new Assets
                {
                    LargeImageKey = largeImageKey,
                    LargeImageText = largeImageText,
                },
            };

            if (!string.IsNullOrEmpty(config.SmallImageKey))
            {
                presence.Assets.SmallImageKey = config.SmallImageKey;
                presence.Assets.SmallImageText = config.SmallImageText;
            }

            if (config.ShowTimer)
            {
                presence.Timestamps = new Timestamps(_startedAt);
            }

            string fingerprint = details + "|" + state + "|" + largeImageKey + "|" + _startedAt.Ticks;
            if (fingerprint == _lastFingerprint && !verbose) return;

            _client.SetPresence(presence);
            _lastFingerprint = fingerprint;
            Log("presence -> " + details + " | " + state);
        }

        private static void Log(string message)
        {
            Console.WriteLine(message);
        }
    }
}
