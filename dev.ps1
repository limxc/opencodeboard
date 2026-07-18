param()

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
$STATE_FILE = Join-Path -Path $scriptRoot ".server-pids.json"
$FRONTEND_PORT = 3000
$BACKEND_PORT = 3001

function Read-State {
    if (Test-Path -LiteralPath $STATE_FILE -PathType Leaf) {
        try {
            $json = Get-Content -LiteralPath $STATE_FILE -Raw
            $obj = $json | ConvertFrom-Json
            return @{ frontend = [int]$obj.frontend; backend = [int]$obj.backend }
        } catch { }
    }
    return @{ frontend = -1; backend = -1 }
}

function Write-State($st) {
    $st | ConvertTo-Json | Set-Content -LiteralPath $STATE_FILE
}

function Is-Port-Used($port) {
    $conn = netstat -an 2>&1 | Select-String "LISTENING" | Select-String ":$port "
    return ($conn -ne $null)
}

function Get-Pid-By-Port($port) {
    $line = netstat -ano 2>&1 | Select-String "LISTENING" | Select-String ":$port "
    if ($line) {
        $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
        $last = $parts[-1]
        $num = 0
        if ([int]::TryParse($last, [ref]$num)) { return $num }
    }
    return -1
}

function Is-Frontend-Alive {
    $st = Read-State
    $procId = $st.frontend
    if ($procId -gt 0) {
        try {
            $p = Get-Process -Id $procId -ErrorAction Stop
            if ($p -and (Is-Port-Used $FRONTEND_PORT)) { return $true }
        } catch { }
        $st.frontend = -1; Write-State $st; return $false
    }
    $p = Get-Pid-By-Port $FRONTEND_PORT
    if ($p -gt 0) { $st.frontend = $p; Write-State $st; return $true }
    return $false
}

function Is-Backend-Alive {
    $st = Read-State
    $procId = $st.backend
    if ($procId -gt 0) {
        try {
            $p = Get-Process -Id $procId -ErrorAction Stop
            if ($p -and (Is-Port-Used $BACKEND_PORT)) { return $true }
        } catch { }
        $st.backend = -1; Write-State $st; return $false
    }
    $p = Get-Pid-By-Port $BACKEND_PORT
    if ($p -gt 0) { $st.backend = $p; Write-State $st; return $true }
    return $false
}

function Show-Status {
    $fa = Is-Frontend-Alive
    $ba = Is-Backend-Alive

    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  OpenCodeBoard - Dev Server Manager" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""

    $st = Read-State
    $fp = $st.frontend
    $bp = $st.backend

    if ($fa) {
        Write-Host "  Frontend  [RUN]  PID $fp  http://localhost:$FRONTEND_PORT" -ForegroundColor Green
    } else {
        Write-Host "  Frontend  [STOP] stopped" -ForegroundColor Red
    }
    if ($ba) {
        Write-Host "  Backend   [RUN]  PID $bp  http://localhost:$BACKEND_PORT" -ForegroundColor Green
    } else {
        Write-Host "  Backend   [STOP] stopped" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "--------------------------------------------" -ForegroundColor DarkGray
}

function Show-Menu {
    Write-Host "  [1] Start All Services" -ForegroundColor Yellow
    Write-Host "  [2] Stop All Services" -ForegroundColor Yellow
    Write-Host "  [3] Restart Frontend" -ForegroundColor Yellow
    Write-Host "  [4] Restart Backend" -ForegroundColor Yellow
    Write-Host "  [0] Exit" -ForegroundColor Yellow
    Write-Host ""
}

$NPM = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }

function Start-Frontend {
    if (Is-Frontend-Alive) { Write-Host "[!] Frontend is already running." -ForegroundColor Yellow; return }
    Write-Host "[*] Starting frontend dev server (vite)..." -ForegroundColor Green
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $NPM run dev -- --port $FRONTEND_PORT" -WorkingDirectory $scriptRoot -WindowStyle Hidden -PassThru
    $st = Read-State; $st.frontend = $proc.Id; Write-State $st
    Write-Host "[+] Frontend launching (PID $($proc.Id), http://localhost:$FRONTEND_PORT)" -ForegroundColor Green
}

function Start-Backend {
    if (Is-Backend-Alive) { Write-Host "[!] Backend is already running." -ForegroundColor Yellow; return }
    Write-Host "[*] Starting backend dev server (tsx watch)..." -ForegroundColor Green
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c set PORT=$BACKEND_PORT && $NPM run dev:server" -WorkingDirectory $scriptRoot -WindowStyle Hidden -PassThru
    $st = Read-State; $st.backend = $proc.Id; Write-State $st
    Write-Host "[+] Backend launching (PID $($proc.Id), http://localhost:$BACKEND_PORT)" -ForegroundColor Green
}

function Start-All {
    Write-Host "[*] Starting all services..." -ForegroundColor Cyan
    Start-Frontend
    Start-Backend
}

function Stop-Proc-Tree($procId) {
    try { taskkill /T /F /PID $procId 2>&1 | Out-Null } catch { try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch {} }
}

function Stop-Frontend {
    $st = Read-State; $procId = $st.frontend
    if ($procId -le 0) { $procId = Get-Pid-By-Port $FRONTEND_PORT }
    if ($procId -gt 0) {
        Stop-Proc-Tree $procId
        $st.frontend = -1; Write-State $st
        Write-Host "[+] Frontend stopped (PID $procId)" -ForegroundColor Green
    } else { Write-Host "[!] No running frontend server found." -ForegroundColor Yellow }
}

function Stop-Backend {
    $st = Read-State; $procId = $st.backend
    if ($procId -le 0) { $procId = Get-Pid-By-Port $BACKEND_PORT }
    if ($procId -gt 0) {
        Stop-Proc-Tree $procId
        $st.backend = -1; Write-State $st
        Write-Host "[+] Backend stopped (PID $procId)" -ForegroundColor Green
    } else { Write-Host "[!] No running backend server found." -ForegroundColor Yellow }
}

function Stop-All {
    Write-Host "[*] Stopping all services..." -ForegroundColor Cyan
    Stop-Frontend
    Stop-Backend
}

function Restart-Frontend {
    Write-Host "[*] Restarting frontend..." -ForegroundColor Cyan
    Stop-Frontend
    Start-Frontend
}

function Restart-Backend {
    Write-Host "[*] Restarting backend..." -ForegroundColor Cyan
    Stop-Backend
    Start-Backend
}

do {
    Clear-Host
    Show-Status
    Show-Menu

    $char = $null
    $waited = 0
    while ($waited -lt 30) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            $char = $key.KeyChar
            break
        }
        Start-Sleep -Milliseconds 100
        $waited++
    }

    $quit = $false
    if ($char -ne $null -and $char -ne "`0") {
        switch ($char) {
            "1" { Start-All }
            "2" { Stop-All }
            "3" { Restart-Frontend }
            "4" { Restart-Backend }
            "0" { $quit = $true }
        }
        Start-Sleep -Milliseconds 500
    }
} while (-not $quit)

Write-Host "Bye!" -ForegroundColor Cyan
