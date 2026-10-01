# =========================================================
#  Генератор ч/б заглушек для VVAN
#  Плейсхолдеры той же пропорции, что и реальные фото.
#  Запуск:  powershell -ExecutionPolicy Bypass -File .\tools\make-placeholders.ps1
# =========================================================
param(
  [string]$ImagesDir = (Join-Path $PSScriptRoot "..\public\images")
)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $ImagesDir | Out-Null

function Save-Jpeg([System.Drawing.Bitmap]$bmp, [string]$path, [long]$quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)
  $bmp.Save($path, $codec, $params)
}

function New-Placeholder([string]$name, [int]$w, [int]$h, [string]$tone) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # фон: диагональный градиент от тёмного к чуть светлее (имитация ч/б фото)
  $top    = if ($tone -eq 'light') { 78 }  else { 34 }
  $bottom = if ($tone -eq 'light') { 40 }  else { 14 }
  $rect   = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush  = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, $top, $top, $top),
    [System.Drawing.Color]::FromArgb(255, $bottom, $bottom, $bottom),
    32)
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()

  # большой круг — «свет из-за кадра»
  $d = [int]($h * 1.15)
  $pen1 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(26, 255, 255, 255), [Math]::Max(2, [int]($h / 300)))
  $g.DrawEllipse($pen1, [int]($w * 0.5 - $d * 0.42), [int]($h * 0.08), $d, $d)
  $pen1.Dispose()

  $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(16, 255, 255, 255))
  $g.FillEllipse($fill, [int]($w * 0.5 - $d * 0.42), [int]($h * 0.08), $d, $d)
  $fill.Dispose()

  # диагонали — «штрихи» вместо текста
  $pen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(22, 255, 255, 255), [Math]::Max(2, [int]($h / 400)))
  foreach ($o in @(-0.35, -0.1, 0.15, 0.4)) {
    $x0 = [int]($w * (0.5 + $o)); $y0 = [int]($h * 1.1)
    $x1 = [int]($w * (0.5 + $o) + $h * 0.85); $y1 = [int](-$h * 0.1)
    $g.DrawLine($pen2, $x0, $y0, $x1, $y1)
  }
  $pen2.Dispose()

  # вертикальная сетка — «стыки панелей»
  $pen3 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(14, 255, 255, 255), 1)
  $step = [int]($w / 8)
  for ($x = $step; $x -lt $w; $x += $step) { $g.DrawLine($pen3, $x, 0, $x, $h) }
  $pen3.Dispose()

  $g.Dispose()
  $path = Join-Path $ImagesDir $name
  Save-Jpeg $bmp $path 88
  $bmp.Dispose()
  Write-Output "  $name  ${w}x${h}"
}

Write-Output "Генерация заглушек в $ImagesDir"
for ($i = 1; $i -le 5; $i++) { New-Placeholder "hero-$i.jpg" 1600 734 'dark' }
New-Placeholder 'master-irina.jpg'    1312 1100 'light'
New-Placeholder 'master-ekaterina.jpg' 1312 1100 'light'
New-Placeholder 'tools.jpg'         1000 1050 'dark'
Write-Output "Готово."
