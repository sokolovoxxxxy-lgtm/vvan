<#
  VVAN — локальный dev-сервер + mock API /api/booking
  Запуск:  powershell -ExecutionPolicy Bypass -File .\server.ps1
  Открой:  http://localhost:8080
  Логи:    logs/booking-YYYY-MM-DD.log   (заявки)
           logs/server-console.log       (диагностика сервера)
  Telegram: переменные TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID в файле .env
#>
param([int]$Port = 8080)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------- лог диагностики ----------
# пишем и в файл, и в консоль: при запуске "в detached" консоли нет,
# и падение иначе остаётся без единой строки
$consoleLog = Join-Path (Join-Path $root "logs") "server-console.log"
function Log([string]$m) {
  try {
    $dir = Split-Path -Parent $consoleLog
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Add-Content -Path $consoleLog -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " " + $m) -Encoding UTF8
  } catch {}
  Write-Host $m
}

# ---------- .env ----------
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
      $i = $line.IndexOf("=")
      if ($i -gt 0) {
        $k = $line.Substring(0, $i).Trim()
        $v = $line.Substring($i + 1).Trim()
        if ($k) { Set-Item -Path "env:$k" -Value $v }
      }
    }
  }
}
$token  = $env:TELEGRAM_BOT_TOKEN
$chatId = $env:TELEGRAM_CHAT_ID

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".png"  = "image/png"
  ".webp" = "image/webp"
  ".ico"  = "image/x-icon"
  ".woff2"= "font/woff2"
  ".txt"  = "text/plain; charset=utf-8"
}

function Write-Json($obj, [int]$code) {
  $payload = $obj | ConvertTo-Json -Compress -Depth 6
  return @{ Code = $code; Body = [Text.Encoding]::UTF8.GetBytes($payload); Type = "application/json; charset=utf-8" }
}

function Send-Telegram([string]$text) {
  if (-not $token -or -not $chatId) { return $false }
  try {
    $body = @{ chat_id = $chatId; text = $text } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/sendMessage" `
      -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 15 | Out-Null
    return $true
  } catch {
    Log ("[telegram] " + $_.Exception.Message)
    return $false
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Log "VVAN dev-server: http://localhost:$Port  (стоп — Ctrl+C)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    # HEAD: заголовки отправляем, тело — нет (иначе HttpListener бросает исключение и в журнале появляется [error])
    $isHead = ($req.HttpMethod -eq "HEAD")

    try {
      # ---------- API ----------
      if ($path -eq "/api/booking" -and $req.HttpMethod -eq "POST") {
        $reader = New-Object IO.StreamReader($req.InputStream, $req.ContentEncoding)
        $raw = $reader.ReadToEnd()
        $reader.Close()

        $data = $null
        try { $data = $raw | ConvertFrom-Json } catch { $data = $null }
        if (-not $data) {
          $r = Write-Json @{ ok = $false; error = "Некорректный JSON" } 400
        } else {
          $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
          $line  = "[$stamp] $($data.name) | $($data.phone) | $($data.service) | $($data.master) | $($data.datetimeLabel)"
          $logDir = Join-Path $root "logs"
          if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
          Add-Content -Path (Join-Path $logDir ("booking-" + (Get-Date -Format "yyyy-MM-dd") + ".log")) -Value $line -Encoding UTF8
          Log "[booking] $line"

          $tg = $false
          if ($token -and $chatId) {
            $msg = "Новая запись VVAN`nИмя: $($data.name)`nТелефон: $($data.phone)`nУслуга: $($data.service)`nМастер: $($data.master)`nВремя: $($data.datetimeLabel)"
            $tg = Send-Telegram $msg
          }
          $r = Write-Json @{ ok = $true; saved = $true; telegram = $tg } 200
        }
        $res.StatusCode = $r.Code
        $res.ContentType = $r.Type
        if ($isHead) { $res.ContentLength64 = $r.Body.Length }
        else { $res.OutputStream.Write($r.Body, 0, $r.Body.Length) }
      }
      elseif ($path -eq "/api/booking" -and $req.HttpMethod -ne "POST") {
        $r = Write-Json @{ ok = $false; error = "Только POST" } 405
        $res.StatusCode = $r.Code; $res.ContentType = $r.Type
        if ($isHead) { $res.ContentLength64 = $r.Body.Length }
        else { $res.OutputStream.Write($r.Body, 0, $r.Body.Length) }
      }
      else {
        # ---------- статика ----------
        if ($path -eq "/") { $path = "/index.html" }
        $file = Join-Path $root ($path -replace "/", "\")
        $full = [IO.Path]::GetFullPath($file)
        if (-not $full.StartsWith([IO.Path]::GetFullPath($root))) {
          $res.StatusCode = 403; $res.Close(); continue
        }
        if (Test-Path $full -PathType Leaf) {
          $bytes = [IO.File]::ReadAllBytes($full)
          $ext = [IO.Path]::GetExtension($full).ToLower()
          $res.StatusCode = 200
          $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" })
          $res.ContentLength64 = $bytes.Length
          if (-not $isHead) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
        } else {
          $res.StatusCode = 404
          $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
          $res.ContentType = "text/plain; charset=utf-8"
          $res.ContentLength64 = $msg.Length
          if (-not $isHead) { $res.OutputStream.Write($msg, 0, $msg.Length) }
        }
      }
    } catch {
      Log "[error] $($_.Exception.Message)"
      try { $res.StatusCode = 500 } catch {}
    } finally {
      $res.Close()
    }
  }
} catch {
  # диагностика: без этого блока падение сервера происходило молча (только баннер в журнале)
  Log ("[fatal] " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message)
  try { Log ("[fatal] pos: " + $_.InvocationInfo.PositionMessage) } catch {}
  exit 3
} finally {
  Log ("[server] stopped " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  $listener.Stop()
  $listener.Close()
}
