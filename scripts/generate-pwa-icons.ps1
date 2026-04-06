Add-Type -AssemblyName System.Drawing
$items = @(
  @{ Size = 192; Path = "$PSScriptRoot/../frontend-staff/public/icon-192.png" },
  @{ Size = 512; Path = "$PSScriptRoot/../frontend-staff/public/icon-512.png" },
  @{ Size = 192; Path = "$PSScriptRoot/../frontend-user/public/icon-192.png" },
  @{ Size = 512; Path = "$PSScriptRoot/../frontend-user/public/icon-512.png" }
)
foreach ($item in $items) {
  $bmp = New-Object System.Drawing.Bitmap $item.Size, $item.Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255, 13, 148, 136))
  $bmp.Save($item.Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "OK $($item.Path)"
}
