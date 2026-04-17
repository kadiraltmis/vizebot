$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Visa Monitor.lnk'

# Eski kisayolu sil
if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force }

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = 'D:\cloudecode\visa-monitor\start.bat'
$Shortcut.WorkingDirectory = 'D:\cloudecode\visa-monitor'
$Shortcut.Description = 'Visa Monitor Baslat'
$Shortcut.IconLocation = 'C:\Program Files\Google\Chrome\Application\chrome.exe,0'
$Shortcut.Save()

Write-Host "Kisayol olusturuldu: $shortcutPath"
Write-Host "Hedef: $($Shortcut.TargetPath)"
