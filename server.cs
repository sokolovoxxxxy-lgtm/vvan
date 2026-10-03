using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Vvan
{
    /// <summary>
    /// VVAN — нативный dev-сервер (замена server.ps1, см. её же по API и форматам логов).
    /// Причина появления: PowerShell-процессы в этой среде убивают через 2–5 минут,
    /// этот exe убивать не должны (другое имя процесса).
    /// Сборка:  csc /nologo /target:winexe /optimize+ /out:vvan-server.exe /r:System.Web.Extensions.dll server.cs
    /// Запуск:  vvan-server.exe [порт]        (по умолчанию 8080)
    /// Логи:    logs/server-console.log       — диагностика, ошибки, заявки
    ///          logs/server-heartbeat.log     — метка времени каждые 60 с (обрезается при старте)
    ///          logs/booking-YYYY-MM-DD.log   — заявки из формы
    /// </summary>
    internal static class Server
    {
        private static readonly object Lock = new object();
        private static string root = "";
        private static string consoleLog = "";
        private static string hbLog = "";
        private static string tgToken = "";
        private static string tgChat = "";

        private static readonly Dictionary<string, string> Mime =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { ".html",  "text/html; charset=utf-8" },
                { ".css",   "text/css; charset=utf-8" },
                { ".js",    "application/javascript; charset=utf-8" },
                { ".json",  "application/json; charset=utf-8" },
                { ".svg",   "image/svg+xml" },
                { ".jpg",   "image/jpeg" },
                { ".jpeg",  "image/jpeg" },
                { ".png",   "image/png" },
                { ".webp",  "image/webp" },
                { ".ico",   "image/x-icon" },
                { ".woff2", "font/woff2" },
                { ".txt",   "text/plain; charset=utf-8" }
            };

        // ---------- логирование (и в файл, и в консоль: у detached-процесса консоли нет) ----------
        private static void Log(string m)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + m;
            lock (Lock)
            {
                try { File.AppendAllText(consoleLog, line + Environment.NewLine, new UTF8Encoding(false)); }
                catch { }
            }
            try { Console.WriteLine(line); }
            catch { }
        }

        private static void HeartbeatLoop()
        {
            while (true)
            {
                try
                {
                    lock (Lock)
                    {
                        File.AppendAllText(hbLog,
                            DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + Environment.NewLine,
                            new UTF8Encoding(false));
                    }
                }
                catch { }
                Thread.Sleep(60000);
            }
        }

        private static void LoadEnv(string file)
        {
            try
            {
                if (!File.Exists(file)) return;
                string[] lines = File.ReadAllLines(file);
                foreach (string raw in lines)
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    int i = line.IndexOf('=');
                    if (i <= 0) continue;
                    string k = line.Substring(0, i).Trim();
                    string v = line.Substring(i + 1).Trim();
                    if (k == "TELEGRAM_BOT_TOKEN") tgToken = v;
                    else if (k == "TELEGRAM_CHAT_ID") tgChat = v;
                }
            }
            catch (Exception ex) { Log("[error] .env: " + ex.Message); }
        }

        private static string S(Dictionary<string, object> d, string k)
        {
            object v;
            if (!d.TryGetValue(k, out v) || v == null) return "";
            if (v is string) return (string)v;
            return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
        }

        private static void SendJson(HttpListenerResponse res, int code, Dictionary<string, object> obj, bool isHead)
        {
            string json = new JavaScriptSerializer().Serialize(obj);
            byte[] body = Encoding.UTF8.GetBytes(json);
            res.StatusCode = code;
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = body.Length;
            if (!isHead) res.OutputStream.Write(body, 0, body.Length);
        }

        private static bool SendTelegram(string text)
        {
            try
            {
                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["chat_id"] = tgChat;
                payload["text"] = text;
                string json = new JavaScriptSerializer().Serialize(payload);
                byte[] body = Encoding.UTF8.GetBytes(json);

                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(
                    "https://api.telegram.org/bot" + tgToken + "/sendMessage");
                r.Method = "POST";
                r.ContentType = "application/json; charset=utf-8";
                r.Timeout = 15000;
                r.ContentLength = body.Length;
                using (Stream s = r.GetRequestStream()) s.Write(body, 0, body.Length);
                using (HttpWebResponse w = (HttpWebResponse)r.GetResponse()) { }
                return true;
            }
            catch (Exception ex)
            {
                Log("[telegram] " + ex.Message);
                return false;
            }
        }

        // ---------- POST /api/booking ----------
        private static void HandleBooking(HttpListenerRequest req, HttpListenerResponse res, bool isHead)
        {
            string raw;
            using (StreamReader reader = new StreamReader(req.InputStream,
                req.ContentEncoding ?? Encoding.UTF8))
            {
                raw = reader.ReadToEnd();
            }

            object parsed = null;
            try { parsed = new JavaScriptSerializer().DeserializeObject(raw); }
            catch { parsed = null; }

            Dictionary<string, object> data = parsed as Dictionary<string, object>;
            if (data == null)
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "Некорректный JSON";
                SendJson(res, 400, bad, isHead);
                return;
            }

            string stamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            string line = "[" + stamp + "] " + S(data, "name") + " | " + S(data, "phone") +
                          " | " + S(data, "service") + " | " + S(data, "master") +
                          " | " + S(data, "datetimeLabel");

            string logsDir = Path.Combine(root, "logs");
            string logFile = Path.Combine(logsDir, "booking-" + DateTime.Now.ToString("yyyy-MM-dd") + ".log");
            lock (Lock)
            {
                try
                {
                    if (!Directory.Exists(logsDir)) Directory.CreateDirectory(logsDir);
                    File.AppendAllText(logFile, line + Environment.NewLine, new UTF8Encoding(false));
                }
                catch (Exception ex) { Log("[error] запись лога заявки: " + ex.Message); }
            }
            Log("[booking] " + line);

            bool tg = false;
            if (!string.IsNullOrEmpty(tgToken) && !string.IsNullOrEmpty(tgChat))
            {
                string msg = "Новая запись VVAN\nИмя: " + S(data, "name") +
                             "\nТелефон: " + S(data, "phone") +
                             "\nУслуга: " + S(data, "service") +
                             "\nМастер: " + S(data, "master") +
                             "\nВремя: " + S(data, "datetimeLabel");
                tg = SendTelegram(msg);
            }

            Dictionary<string, object> ok = new Dictionary<string, object>();
            ok["ok"] = true;
            ok["saved"] = true;
            ok["telegram"] = tg;
            SendJson(res, 200, ok, isHead);
        }

        // ---------- статика ----------
        private static void HandleStatic(string path, HttpListenerResponse res, bool isHead)
        {
            if (path == "/") path = "/index.html";
            string rel = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(root, rel));

            string rootSep = Path.GetFullPath(root);
            if (!rootSep.EndsWith(Path.DirectorySeparatorChar.ToString()))
                rootSep += Path.DirectorySeparatorChar;

            if (!full.StartsWith(rootSep, StringComparison.OrdinalIgnoreCase))
            {
                res.StatusCode = 403;
                res.ContentLength64 = 0;
                return;
            }

            if (File.Exists(full))
            {
                byte[] bytes = File.ReadAllBytes(full);
                string ext = Path.GetExtension(full).ToLowerInvariant();
                res.StatusCode = 200;
                res.ContentType = Mime.ContainsKey(ext) ? Mime[ext] : "application/octet-stream";
                res.ContentLength64 = bytes.Length;
                if (!isHead) res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            else
            {
                byte[] msg = Encoding.UTF8.GetBytes("404 Not Found");
                res.StatusCode = 404;
                res.ContentType = "text/plain; charset=utf-8";
                res.ContentLength64 = msg.Length;
                if (!isHead) res.OutputStream.Write(msg, 0, msg.Length);
            }
        }

        private static void Handle(HttpListenerContext ctx)
        {
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse res = ctx.Response;
            string path = Uri.UnescapeDataString(req.Url.AbsolutePath);
            // HEAD: заголовки отправляем, тело — нет (HttpListener иначе бросает исключение)
            bool isHead = string.Equals(req.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase);

            try
            {
                if (path == "/api/booking")
                {
                    if (string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                        HandleBooking(req, res, isHead);
                    else
                    {
                        Dictionary<string, object> e = new Dictionary<string, object>();
                        e["ok"] = false;
                        e["error"] = "Только POST";
                        SendJson(res, 405, e, isHead);
                    }
                }
                else
                {
                    HandleStatic(path, res, isHead);
                }
            }
            finally
            {
                try { res.Close(); }
                catch { }
            }
        }

        private static void Main(string[] args)
        {
            int port = 8080;
            if (args.Length > 0)
            {
                int p;
                if (int.TryParse(args[0], out p) && p > 0 && p < 65536) port = p;
            }

            root = AppDomain.CurrentDomain.BaseDirectory;
            string logsDir = Path.Combine(root, "logs");
            try { if (!Directory.Exists(logsDir)) Directory.CreateDirectory(logsDir); }
            catch { }

            consoleLog = Path.Combine(logsDir, "server-console.log");
            hbLog = Path.Combine(logsDir, "server-heartbeat.log");
            try { File.WriteAllText(hbLog, "", new UTF8Encoding(false)); } catch { }

            LoadEnv(Path.Combine(root, ".env"));

            Thread hb = new Thread(HeartbeatLoop);
            hb.IsBackground = true;
            hb.Start();

            HttpListener listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:" + port + "/");
            try { listener.Start(); }
            catch (Exception ex)
            {
                Log("[fatal] слушатель не стартовал: " + ex.GetType().FullName + ": " + ex.Message);
                return;
            }

            int pid = Process.GetCurrentProcess().Id;
            Log("VVAN dev-server (native exe): http://localhost:" + port + "  pid=" + pid);
            try { File.WriteAllText(Path.Combine(logsDir, "server.pid"), pid.ToString(), Encoding.ASCII); }
            catch { }

            try
            {
                while (listener.IsListening)
                {
                    HttpListenerContext ctx;
                    try { ctx = listener.GetContext(); }
                    catch (Exception ex)
                    {
                        if (!listener.IsListening) break;
                        Log("[fatal] обрыв цикла: " + ex.GetType().FullName + ": " + ex.Message);
                        break;
                    }

                    try { Handle(ctx); }
                    catch (Exception ex)
                    {
                        Log("[error] " + ex.GetType().FullName + ": " + ex.Message);
                        try { ctx.Response.StatusCode = 500; }
                        catch { }
                        try { ctx.Response.Close(); }
                        catch { }
                    }
                }
            }
            catch (Exception ex)
            {
                Log("[fatal] " + ex.GetType().FullName + ": " + ex.Message);
            }
            finally
            {
                try { listener.Stop(); listener.Close(); }
                catch { }
                Log("[server] stopped " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            }
        }
    }
}
