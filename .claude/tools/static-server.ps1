<#
  Minimal static file server for local preview of this no-build-step app.
  Exists because this machine has no Python/Node/etc. installed (only the
  Windows Store "python.exe" app-execution-alias stub, which errors out) —
  see .claude/launch.json, which invokes this via powershell.exe instead.
#>
param(
  [int]$Port = 5173,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$mime = @{
  '.html' = 'text/html'; '.htm' = 'text/html'; '.js' = 'application/javascript';
  '.css' = 'text/css'; '.json' = 'application/json'; '.png' = 'image/png';
  '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif';
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.woff' = 'font/woff';
  '.woff2' = 'font/woff2'; '.map' = 'application/json'; '.txt' = 'text/plain';
  '.xml' = 'application/xml'; '.sql' = 'text/plain'; '.md' = 'text/plain'
}
$rootFull = [IO.Path]::GetFullPath($Root)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $rootFull at http://localhost:$Port/"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $urlPath = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($urlPath -eq '/') { $urlPath = '/index.html' }
      $filePath = [IO.Path]::GetFullPath((Join-Path $rootFull ($urlPath.TrimStart('/'))))

      if (-not $filePath.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
      } else {
        if (Test-Path $filePath -PathType Container) { $filePath = Join-Path $filePath 'index.html' }
        if (Test-Path $filePath -PathType Leaf) {
          $ext = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
          $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
          $bytes = [IO.File]::ReadAllBytes($filePath)
          $res.ContentType = $ct
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
          $res.StatusCode = 404
          $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
          $res.OutputStream.Write($msg, 0, $msg.Length)
        }
      }
    } catch {
      try { $res.StatusCode = 500 } catch {}
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
