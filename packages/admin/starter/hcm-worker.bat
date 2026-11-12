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
# The worker's usage error (argparse): an image older than this starter's supervisor (finding 74 of 2026-11-03).
$Usage = 2
$Refusals = 3
$GetDocker = 'https://docs.docker.com/get-started/get-docker/'
$ImageApi = "https://us-central1-$Project.cloudfunctions.net/worker-image"
$ImagePattern = '^us-central1-docker\.pkg\.dev/' + [regex]::Escape($Project) + '/hcm/pipeline@sha256:[0-9a-f]{64}$'
$Folder = Join-Path $env:LOCALAPPDATA $Name
$Installed = Join-Path $Folder "$Name.ps1"
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) "$Name.cmd"
$Run = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Installed`""
# The local AI (docs/research/M10-local-ai.md): a sidecar with no network, started here because the worker has no Docker socket.
$Matcher = 'hcm-matcher'
$AiFiles = 'hcm-ai-files'
$AiBox = 'hcm-ai-box'
$AiMinFreeKb = 31457280
$AiSeconds = 20
$AiImagePattern = '^pytorch/pytorch(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$'
$AiImageNote = Join-Path $Folder 'ai-image'
$SidecarFlags = @('--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-u', '10001:10001', '-e', 'HOME=/tmp', '--tmpfs', '/tmp')
$SidecarFlags += @('-e', 'HCM_AI_ROOT=/ai', '-e', 'PYTHONPATH=/ai/files/code:/ai/files/lib', '-v', "${AiFiles}:/ai/files:ro", '-v', "${AiBox}:/ai/box", '--entrypoint', 'python')
$script:SidecarImage = ''
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

# Says in the box why the sidecar cannot come (the panel shows it, the worker stops waiting); a word of this file only, never data.
function Set-AiRefused($WorkerImage, $Why) {
    Write-Host "local AI: unavailable ($Why)"
    # Octal, not a quote: a backslash escapes nothing in PowerShell, and Windows PowerShell strips a quote inside an argument; the worker reads JSON.
    $word = "printf '{\042state\042:\042unavailable\042,\042why\042:\042$Why\042}' > /ai/box/starter.json"
    & docker run --rm -u 10001:10001 --network none -v "${AiBox}:/ai/box" --entrypoint sh $WorkerImage -c $word *> $null
}

# Free kilobytes where Docker keeps images, read inside a container: on Docker Desktop this computer's disks say nothing of it.
function Get-DockerFreeKb($WorkerImage) {
    $lines = & docker run --rm --network none --entrypoint df $WorkerImage -Pk / 2> $null
    if ($lines.Count -lt 2) { return 0 }
    return [int64](($lines[1] -split '\s+')[3])
}

# The image on this computer: pulled once a frame needs it, when there is room for it, one already here used as it is (offline, or Docker
# Hub refusing, must not cost a working sidecar); its volumes owned by the sidecar's user.
function Get-AiImage($WorkerImage, $Wanted) {
    & docker image inspect $Wanted *> $null
    if ($LASTEXITCODE -eq 0) {
        & docker run --rm --network none -v "${AiFiles}:/ai/files" -v "${AiBox}:/ai/box" --entrypoint true $WorkerImage *> $null
        return $true
    }
    if ((Get-DockerFreeKb $WorkerImage) -lt $AiMinFreeKb) {
        Set-AiRefused $WorkerImage 'disk'
        return $false
    }
    Write-Host 'local AI: first use: about 10 GB to fetch, once; it runs on this computer, never in a cloud'
    & docker pull $Wanted *> $null
    if ($LASTEXITCODE -ne 0) {
        Set-AiRefused $WorkerImage 'pull'
        return $false
    }
    Set-AiImageNote $Wanted
    & docker run --rm --network none -v "${AiFiles}:/ai/files" -v "${AiBox}:/ai/box" --entrypoint true $WorkerImage *> $null
    return $true
}

# The images this file pulled, one a line: uninstall removes those and no other. A new pin's pull lets the earlier ones go at once, about
# 10 GB each; one Docker will not remove yet stays noted.
function Set-AiImageNote($Wanted) {
    Stop-Sidecar
    $kept = @()
    if (Test-Path -LiteralPath $AiImageNote) {
        foreach ($old in Get-Content -LiteralPath $AiImageNote) {
            if ($old -and $old -ne $Wanted) {
                & docker image rm $old *> $null
                if ($LASTEXITCODE -ne 0) { $kept += $old }
            }
        }
    }
    Set-Content -LiteralPath $AiImageNote -Value ($kept + $Wanted) -Encoding Ascii
}

# What PyTorch sees under these flags, inside the sidecar's own image: true when it may use the card; else why not, said: a Docker or a
# driver that refused this once is not a computer with no card. `none` is the reason's place: Windows PowerShell drops an empty argument.
function Test-AiGpu($Image, $Flags) {
    & docker run --rm @Flags @SidecarFlags $Image -m matcher.child probe gpu none *> $null
    $code = $LASTEXITCODE
    switch ($code) {
        0 {}
        77 { Write-Host 'local AI: no graphics card seen' }
        76 { Write-Host 'local AI: the graphics card has under 2 GB of memory' }
        default { Write-Host "local AI: Docker or the graphics driver refused the graphics card (code $code)" }
    }
    return $code -eq 0
}

# The sidecar itself, detached: this loop keeps reading /state.
function Start-Sidecar($Image, $Device, $Why, $Flags) {
    & docker rm -f $Matcher *> $null
    $limits = @('--memory', '6g', '--memory-swap', '6g', '--shm-size', '1g', '--pids-limit', '512')
    & docker run -d --rm --name $Matcher @Flags @limits -e "HCM_AI_DEVICE=$Device" -e "HCM_AI_WHY=$Why" @SidecarFlags $Image -m matcher.serve *> $null
}

# The sidecar this loop started gone: what a frame no longer wants, or a worker no longer here, holds no container.
function Stop-Sidecar {
    if ($script:SidecarImage) {
        & docker rm -f $Matcher *> $null
        $script:SidecarImage = ''
    }
}

function Test-SidecarUp {
    return (& docker inspect --format '{{.State.Running}}' $Matcher 2> $null) -eq 'true'
}

# The sidecar of the image the worker names, up: a new pin, or one that ended (77, 76, a crash), starts again and probes again.
function Update-Sidecar($Image) {
    if ($script:SidecarImage -eq $Image -and (Test-SidecarUp)) { return }
    Stop-Sidecar
    Start-Matcher $Image
    $script:SidecarImage = $Image
}

# Graphics card first, through each way Docker offers one; only then the processor, said in plain words. Every start probes again, and a
# sidecar lives only while a frame wants it, so a driver installed later, or a card back from a suspend, is found by the next frame. A
# silent processor run is impossible: the sidecar refuses HCM_AI_DEVICE=cpu without a reason.
function Start-Matcher($Image) {
    if (Test-AiGpu $Image @('--gpus', 'all')) {
        Write-Host 'local AI: graphics card found'
        Start-Sidecar $Image 'gpu' '' @('--gpus', 'all')
    } elseif (((& docker info 2> $null) -match 'nvidia\.com/gpu') -and (Test-AiGpu $Image @('--device', 'nvidia.com/gpu=all'))) {
        Write-Host 'local AI: graphics card found'
        Start-Sidecar $Image 'gpu' '' @('--device', 'nvidia.com/gpu=all')
    } else {
        Write-Host 'local AI: no usable graphics card; using the processor (slower)'
        Start-Sidecar $Image 'cpu' 'no-gpu' @()
    }
}

# Beside the worker, in a process of its own, for as long as the supervisor that started it lives: polls /state, and while a frame wants
# the AI and its files are there, keeps the sidecar up; once none does, or the worker has not answered twice running, removes it. A sidecar
# an earlier loop left goes first.
function Start-MatcherLoop($Supervisor) {
    $pulled = ''
    $missed = 0
    & docker rm -f $Matcher *> $null
    while (Get-Process -Id $Supervisor -ErrorAction SilentlyContinue) {
        try {
            $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/state" -TimeoutSec 5 -ErrorAction Stop
        } catch {
            $state = $null
        }
        if (-not $state) {
            $missed += 1
            if ($missed -ge 2) { Stop-Sidecar }
        } elseif ($state.ai.wanted) {
            $missed = 0
            $wanted = [string]$state.ai.image
            $workerImage = & docker inspect --format '{{.Config.Image}}' $Name 2> $null
            if ($wanted -cnotmatch $AiImagePattern) {
                Write-Host 'local AI: refused an unexpected program image'
            } elseif ($workerImage) {
                if ($pulled -ne $wanted -and (Get-AiImage $workerImage $wanted)) { $pulled = $wanted }
                if ($pulled -eq $wanted -and $state.ai.files) { Update-Sidecar $wanted }
            }
        } else {
            $missed = 0
            Stop-Sidecar
        }
        Start-Sleep -Seconds $AiSeconds
    }
    Stop-Sidecar
}

# The supervisor: the worker in the foreground, started again whenever it ends: at once after an outdated image (75), else
# after a wait that grows to five minutes while it keeps failing (and starts small again after a long run). A worker that
# refuses the supervisor's arguments (usage error 2) three times in a row runs an image older than this starter: that is
# said once, and the supervisor asks again every five minutes until the map is updated.
function Start-Supervisor {
    Stop-Processes "*$Name.ps1*matcher*"
    Start-Process -FilePath 'powershell.exe' -ArgumentList "$Run matcher $PID" -WindowStyle Hidden
    $wait = 10
    $refused = 0
    while ($true) {
        $image = Get-CurrentImage
        if ($image) {
            & docker pull $image *> $null
            if ($LASTEXITCODE -eq 0) {
                & docker rm -f $Name *> $null
                $started = Get-Date
                $digest = 'sha256:' + $image.Split('@')[1].Substring(7)
                $arguments = @('run', '--rm', '--name', $Name, '-p', "127.0.0.1:${Port}:${Port}", '-v', "${Name}:/work")
                $arch = & docker version --format '{{.Server.Arch}}' 2> $null
                $arguments += @('-v', "${AiFiles}:/ai/files", '-v', "${AiBox}:/ai/box", '-e', 'HCM_STARTER=2', '-e', "HCM_DOCKER_ARCH=$arch", $image)
                $arguments += @('worker', '--city', $City, '--project', $Project, '--supervised', '--image', $digest)
                & docker @arguments
                $code = $LASTEXITCODE
                if ($code -eq $Outdated -or ((Get-Date) - $started).TotalSeconds -gt 600) { $wait = 0 }
                if ($code -eq $Usage) { $refused += 1 } else { $refused = 0 }
            }
        }
        if ($refused -eq $Refusals) {
            Write-Host "The server named an image that does not support this computer's starter: update the map."
            Write-Host 'In the admin: Setup, Update the map. The worker is asked for again every 5 minutes.'
        }
        if ($refused -ge $Refusals) { $wait = 300 }
        Start-Sleep -Seconds $wait
        $wait = [Math]::Min(300, $wait * 2 + 10)
    }
}

# The processes of this file whose command line looks like this.
function Stop-Processes($Like) {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like $Like } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# The supervisors of an earlier setup, stopped (a new setup or the removal replaces them).
function Stop-Supervisors {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Stop-Processes "*$Name.ps1*"
    & docker rm -f $Name $Matcher *> $null
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
    & docker volume rm $Name $AiFiles $AiBox *> $null
    # Only the images this file pulled, by the names it noted: the owner's other PyTorch images stay.
    if (Test-Path -LiteralPath $AiImageNote) {
        foreach ($each in Get-Content -LiteralPath $AiImageNote) { if ($each) { & docker image rm $each *> $null } }
    }
    Remove-Item -LiteralPath $Folder -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'The worker is removed from this computer.'
}

# The installed copy started with the word `matcher` and its supervisor's process id is the sidecar's loop (Start-Supervisor starts it).
if ($args -contains 'matcher') { $Action = 'matcher' }
switch ($Action) {
    'run' { Start-Supervisor }
    'matcher' { Start-MatcherLoop ([int]$args[1]) }
    'uninstall' { Uninstall-Worker }
    default { Install-Worker }
}
