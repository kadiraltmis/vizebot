# Visa Monitor — Tam Otomatik Başlatıcı
# Chrome'u CDP moduyla açar, hazır olunca monitörü başlatır.

$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$UserDataDir = "C:\chrome-debug"
$CdpUrl = "http://localhost:9222/json/version"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== Visa Monitor Baslatici ===" -ForegroundColor Cyan

# ── 1. CDP zaten açık mı? ─────────────────────────────────────────────────────
function Test-Cdp {
    try {
        $r = Invoke-WebRequest -Uri $CdpUrl -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-Cdp) {
    Write-Host "[OK] Chrome CDP zaten aktif." -ForegroundColor Green
} else {
    # ── 2. Eski Chrome'u kapat (CDP'siz açıksa çakışır) ──────────────────────
    $existing = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[..] Mevcut Chrome kapatiliyor..." -ForegroundColor Yellow
        Stop-Process -Name "chrome" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    # ── 3. Chrome'u CDP moduyla başlat ───────────────────────────────────────
    Write-Host "[..] Chrome baslatiliyor (CDP port 9222)..." -ForegroundColor Yellow
    Start-Process $ChromePath -ArgumentList `
        "--remote-debugging-port=9222",
        "--user-data-dir=$UserDataDir",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized"

    # ── 4. Chrome hazır olana kadar bekle (max 30s) ───────────────────────────
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Cdp) {
            $ready = $true
            break
        }
        Write-Host "   Bekleniyor... ($i/30)" -ForegroundColor Gray
    }

    if (-not $ready) {
        Write-Host "[HATA] Chrome 30 saniyede hazir olmadi. Cikiliyor." -ForegroundColor Red
        exit 1
    }

    Write-Host "[OK] Chrome hazir." -ForegroundColor Green
}

# ── 5. Monitörü başlat ────────────────────────────────────────────────────────
Write-Host "[..] Visa Monitor baslatiliyor..." -ForegroundColor Yellow
Set-Location $ScriptDir
npm start
