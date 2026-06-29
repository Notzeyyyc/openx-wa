# OpenX MCP - Build for Termux (Linux ARM64)
# Usage: .\build-termux.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenX MCP - Build for Termux" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set cross-compilation env vars
$env:GOOS = "linux"
$env:GOARCH = "arm64"
$env:CGO_ENABLED = "0"

Write-Host "[1/4] Building for linux/arm64..." -ForegroundColor Yellow
$startTime = Get-Date

go build -ldflags="-s -w" -o openx-v2-termux .

if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED!" -ForegroundColor Red
    exit 1
}

$duration = (Get-Date) - $startTime
Write-Host "  OK: Built in $($duration.TotalSeconds.ToString('F1'))s" -ForegroundColor Green

# Get binary size
$binary = Get-Item "openx-v2-termux"
$sizeMB = [math]::Round($binary.Length / 1MB, 2)
Write-Host "  Size: ${sizeMB} MB" -ForegroundColor Gray

Write-Host ""
Write-Host "[2/4] Creating deploy package..." -ForegroundColor Yellow

$deployDir = "deploy-termux"
if (Test-Path $deployDir) {
    Remove-Item -Recurse -Force $deployDir
}
New-Item -ItemType Directory -Path $deployDir | Out-Null

# Copy files
Copy-Item "openx-v2-termux" "$deployDir\openx-v2"
Copy-Item "config.yaml" "$deployDir\"
Copy-Item "deploy-termux.sh" "$deployDir\"
Copy-Item "start.sh" "$deployDir\"

Write-Host "  OK: Deploy package created in $deployDir/" -ForegroundColor Green

Write-Host ""
Write-Host "[3/4] Creating archive..." -ForegroundColor Yellow

# Create tar.gz (for Termux transfer)
$archiveName = "openx-mcp-termux.tar.gz"
if (Test-Path $archiveName) {
    Remove-Item $archiveName
}

# Use tar if available (Windows 10+)
if (Get-Command tar -ErrorAction SilentlyContinue) {
    tar -czf $archiveName -C $deployDir .
    Write-Host "  OK: Created $archiveName" -ForegroundColor Green
} else {
    Write-Host "  WARN: tar not found, use deploy-termux/ folder" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[4/4] Instructions" -ForegroundColor Yellow
Write-Host ""
Write-Host "Transfer to Termux:" -ForegroundColor Cyan
Write-Host "  # Option 1: SCP (from PC)" -ForegroundColor Gray
Write-Host "  scp deploy-termux/* user@termux:~/openx-v2/" -ForegroundColor White
Write-Host ""
Write-Host "  # Option 2: Termux API (from phone)" -ForegroundColor Gray
Write-Host "  # Download deploy-termux/ folder, then:" -ForegroundColor Gray
Write-Host "  cd ~/openx-v2" -ForegroundColor White
Write-Host "  bash deploy-termux.sh" -ForegroundColor White
Write-Host ""

# Reset env vars
$env:GOOS = $null
$env:GOARCH = $null
$env:CGO_ENABLED = $null

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
