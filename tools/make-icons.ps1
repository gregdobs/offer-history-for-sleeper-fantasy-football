# Generates the extension icons (a "rewind clock" on a dark tile) with System.Drawing.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'extension\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root 'docs') | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-MasterIcon([int]$S) {
  $bmp = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)

  # tile
  $tile = New-RoundedRect 0 0 $S $S ($S * 0.22)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.PointF]::new(0, 0)), ([System.Drawing.PointF]::new($S, $S)), ([System.Drawing.ColorTranslator]::FromHtml('#1b3a55')), ([System.Drawing.ColorTranslator]::FromHtml('#0b1826'))
  $g.FillPath($grad, $tile)

  $teal = [System.Drawing.ColorTranslator]::FromHtml('#00ceb8')
  $white = [System.Drawing.ColorTranslator]::FromHtml('#f2f7fb')
  $c = $S / 2.0
  $r = $S * 0.30
  $w = $S * 0.085

  # ring (open at the top-left) with a rewind arrow head at the start
  $pen = New-Object System.Drawing.Pen $teal, $w
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $start = 255.0; $sweep = 295.0
  $g.DrawArc($pen, ($c - $r), ($c - $r), (2 * $r), (2 * $r), $start, $sweep)

  $rad = $start * [Math]::PI / 180.0
  $px = $c + $r * [Math]::Cos($rad); $py = $c + $r * [Math]::Sin($rad)
  $bx = [Math]::Sin($rad); $by = -[Math]::Cos($rad)      # direction of decreasing angle (towards the gap)
  $nx = [Math]::Cos($rad); $ny = [Math]::Sin($rad)       # outward normal
  $L = $S * 0.16; $W = $S * 0.115
  $tip = [System.Drawing.PointF]::new([float]($px + $bx * $L), [float]($py + $by * $L))
  $p1 = [System.Drawing.PointF]::new([float]($px + $nx * $W), [float]($py + $ny * $W))
  $p2 = [System.Drawing.PointF]::new([float]($px - $nx * $W), [float]($py - $ny * $W))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush $teal), [System.Drawing.PointF[]]@($tip, $p1, $p2))

  # clock hands
  $hp = New-Object System.Drawing.Pen $white, ($S * 0.075)
  $hp.StartCap = 'Round'; $hp.EndCap = 'Round'; $hp.LineJoin = 'Round'
  $g.DrawLines($hp, [System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new([float]$c, [float]($c - $r * 0.58)),
      [System.Drawing.PointF]::new([float]$c, [float]$c),
      [System.Drawing.PointF]::new([float]($c + $r * 0.42), [float]($c + $r * 0.30))))

  $g.Dispose()
  return $bmp
}

function Save-Scaled($src, [int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.CompositingQuality = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$master = New-MasterIcon 1024
foreach ($s in 16, 32, 48, 128) { Save-Scaled $master $s (Join-Path $outDir "icon-$s.png") }
$master.Save((Join-Path $root 'docs\icon-1024.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$master.Dispose()
Get-ChildItem $outDir | Select-Object Name, Length
