# Makes the app's Google Play UPLOAD KEY on YOUR computer (Windows PowerShell), and copies what GitHub needs.
# Run it in a folder OUTSIDE the project (for example Documents\mawah-keys):  powershell -ExecutionPolicy Bypass -File make-upload-key.ps1
# It never sends anything anywhere. Keep mawah-upload.jks and the password safe (two offline copies); never put them in the repository or a chat.
$ErrorActionPreference = "Stop"
$keytool = @(
  (Get-Command keytool -ErrorAction SilentlyContinue).Source,
  "$env:JAVA_HOME\bin\keytool.exe",
  "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe",
  "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\keytool.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keytool) { Write-Host "keytool was not found. Install Java 17 from https://adoptium.net (or Android Studio), then run this again." -ForegroundColor Red; exit 1 }
if (Test-Path "mawah-upload.jks") { Write-Host "mawah-upload.jks already exists here. It is your key: do not make a second one." -ForegroundColor Yellow; exit 1 }

$alias = "mawah-upload"
Write-Host "Choose a strong password (at least 12 characters). Type it when keytool asks, twice." -ForegroundColor Cyan
& $keytool -genkeypair -v -storetype PKCS12 -keystore mawah-upload.jks -alias $alias -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=MAWAH Academy, O=MAWAH Academy, C=BD"
if (-not (Test-Path "mawah-upload.jks")) { exit 1 }

[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path "mawah-upload.jks"))) | Set-Clipboard
Write-Host ""
Write-Host "Done. Now open GitHub: the repository -> Settings -> Secrets and variables -> Actions -> New repository secret:" -ForegroundColor Green
Write-Host "  ANDROID_KEYSTORE_BASE64   = paste (Ctrl+V) - it is already copied"
Write-Host "  ANDROID_KEYSTORE_PASSWORD = the password you just typed"
Write-Host "  ANDROID_KEY_ALIAS         = $alias"
Write-Host "  ANDROID_KEY_PASSWORD      = the same password"
Write-Host ""
Write-Host "Then copy mawah-upload.jks and the password to two safe places (a USB stick and a password manager)." -ForegroundColor Yellow
