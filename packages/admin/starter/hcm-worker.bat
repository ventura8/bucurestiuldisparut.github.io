@echo off
rem Historic City Map: use this computer for the imagery pipeline's jobs (docs/research/M7-local-worker.md section 1.5).
rem The admin's "Use this computer" fills the three values below; the file holds no secret (the admin pairs this computer
rem by itself once the worker runs). Double-click it once: it checks Docker, writes its PowerShell part to a folder of
rem yours and registers a task of your user at logon (no administrator rights), which runs the worker in the background:
rem it asks the server for the installed pipeline image, pulls it by digest, runs the worker and starts it again whenever
rem it ends. "Stop using this computer" in the admin gives this file with uninstall chosen: it removes all of it.
setlocal
set "HCM_PROJECT=__HCM_PROJECT__"
set "HCM_CITY=__HCM_CITY__"
set "HCM_ACTION=__HCM_ACTION__"
if not "%~1"=="" set "HCM_ACTION=%~1"
set "HCM_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$t = Get-Content -LiteralPath $env:HCM_SELF -Raw; $m = '#PS' + '-BEGIN'; & ([scriptblock]::Create(($t -split $m, 2)[1]))"
if not "%HCM_ACTION%"=="run" pause
exit /b
#PS-BEGIN
# The PowerShell part (the lines above are cmd's). Its values come from the environment the lines above set, or from
# the header the installed copy carries (hcm-worker.ps1 under %LOCALAPPDATA%\hcm-worker).
$Project = $env:HCM_PROJECT
$City = $env:HCM_CITY
$Action = $env:HCM_ACTION
$Name = 'hcm-worker'
$Port = 8765
$Outdated = 75
$GetDocker = 'https://docs.docker.com/get-started/get-docker/'
$ImageApi = "https://us-central1-$Project.cloudfunctions.net/worker-image"
$ImagePattern = '^us-central1-docker\.pkg\.dev/' + [regex]::Escape($Project) + '/hcm/pipeline@sha256:[0-9a-f]{64}$'
$Folder = Join-Path $env:LOCALAPPDATA $Name
$Installed = Join-Path $Folder "$Name.ps1"
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) "$Name.cmd"
$Run = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Installed`""
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Docker must be installed and running.
function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    & docker info *> $null
    return $LASTEXITCODE -eq 0
}

# The installed pipeline image, by digest, as the server names it (worker.image); $null when it cannot say.
function Get-CurrentImage {
    try {
        $body = '{"data":{}}'
        $answer = Invoke-RestMethod -Method Post -Uri $ImageApi -ContentType 'application/json' -Body $body -TimeoutSec 30 -ErrorAction Stop
    } catch {
        return $null
    }
    $image = [string]$answer.result.image
    if ($image -cmatch $ImagePattern) { return $image }
    return $null
}

# The supervisor: the worker in the foreground, started again whenever it ends: at once after an outdated image (75), else
# after a wait that grows to five minutes while it keeps failing (and starts small again after a long run).
function Start-Supervisor {
    $wait = 10
    while ($true) {
        $image = Get-CurrentImage
        if ($image) {
            & docker pull $image *> $null
            if ($LASTEXITCODE -eq 0) {
                & docker rm -f $Name *> $null
                $started = Get-Date
                $digest = 'sha256:' + $image.Split('@')[1].Substring(7)
                $arguments = @('run', '--rm', '--name', $Name, '-p', "127.0.0.1:${Port}:${Port}", '-v', "${Name}:/work", $image)
                $arguments += @('worker', '--city', $City, '--project', $Project, '--supervised', '--image', $digest)
                & docker @arguments
                if ($LASTEXITCODE -eq $Outdated -or ((Get-Date) - $started).TotalSeconds -gt 600) { $wait = 0 }
            }
        }
        Start-Sleep -Seconds $wait
        $wait = [Math]::Min(300, $wait * 2 + 10)
    }
}

# The supervisors of an earlier setup, stopped (a new setup or the removal replaces them).
function Stop-Supervisors {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$Name.ps1*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    & docker rm -f $Name *> $null
}

function Install-Worker {
    if (-not (Test-Docker)) {
        Write-Host 'Docker is not installed or not running.'
        Write-Host "Get Docker: $GetDocker"
        Write-Host 'Start Docker Desktop, then open this file again.'
        Start-Process $GetDocker
        return
    }
    Stop-Supervisors
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    $part = (Get-Content -LiteralPath $env:HCM_SELF -Raw) -split ('#PS' + '-BEGIN'), 2
    $header = "`$env:HCM_PROJECT = '$Project'`r`n`$env:HCM_CITY = '$City'`r`n`$env:HCM_ACTION = 'run'`r`n"
    Set-Content -LiteralPath $Installed -Value ($header + $part[1]) -Encoding Ascii
    try {
        $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Run
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $Name -Action $taskAction -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
        Start-ScheduledTask -TaskName $Name -ErrorAction Stop
    } catch {
        # Without the Task Scheduler: the Startup folder at the next logon, and the supervisor started now.
        Set-Content -LiteralPath $Startup -Value "@start `"`" powershell.exe $Run" -Encoding Ascii
        Start-Process -FilePath 'powershell.exe' -ArgumentList $Run -WindowStyle Hidden
    }
    Write-Host 'This computer is set up: the worker runs in the background and starts when you log on.'
    Write-Host 'Go back to the admin: it connects this computer by itself.'
}

function Uninstall-Worker {
    Stop-Supervisors
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Startup -Force -ErrorAction SilentlyContinue
    & docker volume rm $Name *> $null
    Remove-Item -LiteralPath $Folder -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'The worker is removed from this computer.'
}

switch ($Action) {
    'run' { Start-Supervisor }
    'uninstall' { Uninstall-Worker }
    default { Install-Worker }
}
