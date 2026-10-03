<#
  VVAN — локальный dev-сервер + mock API /api/booking
  Запуск:  powershell -ExecutionPolicy Bypass -File .\server.ps1
  Открой:  http://localhost:8080
  Логи:    logs/booking-YYYY-MM-DD.log
  Telegram: переменные TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID в файле .env
#>
param([int]$Port = 8080)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

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
    Write-Host "[telegram] ошибка: $($_.Exception.Message)"
    return $false
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "VVAN dev-server: http://localhost:$Port  (стоп — Ctrl+C)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

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
          Write-Host "[booking] $line"

          $tg = $false
          if ($token -and $chatId) {
            $msg = "Новая запись VVAN`nИмя: $($data.name)`nТелефон: $($data.phone)`nУслуга: $($data.service)`nМастер: $($data.master)`nВремя: $($data.datetimeLabel)"
            $tg = Send-Telegram $msg
          }
          $r = Write-Json @{ ok = $true; saved = $true; telegram = $tg } 200
        }
        $res.StatusCode = $r.Code
        $res.ContentType = $r.Type
        $res.OutputStream.Write($r.Body, 0, $r.Body.Length)
      }
      elseif ($path -eq "/api/booking" -and $req.HttpMethod -ne "POST") {
        $r = Write-Json @{ ok = $false; error = "Только POST" } 405
        $res.StatusCode = $r.Code; $res.ContentType = $r.Type
        $res.OutputStream.Write($r.Body, 0, $r.Body.Length)
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
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
          $res.StatusCode = 404
          $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
          $res.ContentType = "text/plain; charset=utf-8"
          $res.OutputStream.Write($msg, 0, $msg.Length)
        }
      }
    } catch {
      Write-Host "[error] $($_.Exception.Message)"
      try { $res.StatusCode = 500 } catch {}
    } finally {
      $res.Close()
    }
  }
} catch {
  # диагностика: без этого блока падение сервера происходило молча (только баннер в журнале)
  Write-Host ("[fatal] " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message)
  try { Write-Host ("[fatal] pos: " + $_.InvocationInfo.PositionMessage) } catch {}
  exit 3
} finally {
  Write-Host ("[server] stopped " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  $listener.Stop()
  $listener.Close()
}
