# Staff: matches --background #f0f4f8 (globals.css). User: white #ffffff (light theme icon tile).
Add-Type -AssemblyName System.Drawing
$staff = [System.Drawing.Color]::FromArgb(255, 240, 244, 248)
$user = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$staffItems = @(
  @{ Size = 192; Path = "$PSScriptRoot/../frontend-staff/public/icon-192.png" },
  @{ Size = 512; Path = "$PSScriptRoot/../frontend-staff/public/icon-512.png" }
)
$userItems = @(
  @{ Size = 192; Path = "$PSScriptRoot/../frontend-user/public/icon-192.png" },
  @{ Size = 512; Path = "$PSScriptRoot/../frontend-user/public/icon-512.png" }
)
function Write-IconPng($size, $path, [System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear($color)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "OK $path"
}
foreach ($item in $staffItems) {
  Write-IconPng $item.Size $item.Path $staff
}
foreach ($item in $userItems) {
  Write-IconPng $item.Size $item.Path $user
}
