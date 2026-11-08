param([string]$PythonPath = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONUTF8 = "1"

try {
    if (-not $PythonPath) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            foreach ($version in @("3.11", "3.12", "3.10")) {
                try {
                    $candidate = & py "-$version" -c "import sys; print(sys.executable)" 2>$null
                    if ($LASTEXITCODE -eq 0 -and $candidate) { $PythonPath = $candidate.Trim(); break }
                } catch { }
            }
        }
        if (-not $PythonPath -and (Get-Command python -ErrorAction SilentlyContinue)) {
            $candidate = & python -c "import sys; print(sys.executable)"
            if ($LASTEXITCODE -eq 0) { $PythonPath = $candidate.Trim() }
        }
    }
    if (-not $PythonPath) { throw "Can cai Python 3.11 64-bit (hoac 3.10/3.12), sau do chay lai install.bat." }
    & $PythonPath -c "import sys, struct; print(sys.version); sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) and struct.calcsize('P') == 8 else 1)"
    if ($LASTEXITCODE -ne 0) { throw "Baseline nay dung Python 3.10 den 3.12 64-bit. Khuyen nghi 3.11. Co the truyen -PythonPath vao install.ps1." }
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-Host "Dang tao moi truong rieng .venv. Vui long doi, khong bam Ctrl+C."
        & $PythonPath -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw "Khong tao duoc .venv." }
    }
    $VenvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
    & $VenvPython -c "import sys, struct; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) and struct.calcsize('P') == 8 else 1)"
    if ($LASTEXITCODE -ne 0) { throw ".venv cu dung sai Python. Doi ten thu muc .venv cu, roi chay lai install.bat." }
    & $VenvPython -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) { throw "Khong khoi tao duoc pip." }
    & $VenvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "Khong cap nhat duoc pip. Kiem tra Internet." }
    & $VenvPython -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "Cai thu vien that bai. Xem loi pip phia tren." }
    & $VenvPython -m AI.download_model
    if ($LASTEXITCODE -ne 0) { throw "Kiem tra hoac tai model that bai." }
    & $VenvPython -m Backend.check_install
    if ($LASTEXITCODE -ne 0) { throw "Model chua chay duoc. Xem muc xu ly loi trong README.md." }
    Write-Host "Thanh cong. Bay gio chay run.bat."
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
