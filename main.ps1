if ($PSScriptRoot) {
    $BaseDir = $PSScriptRoot
}
else {
    $BaseDir = Split-Path -Parent (Convert-Path ([Environment]::GetCommandLineArgs()[0]))
}
$configPath = Join-Path $BaseDir "config.json"

if (-not (Test-Path $configPath)) {
    Write-Error "Config file not found: $configPath"
    exit 1
}

try {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to load/parse config.json: $($_.Exception.Message)"
    exit 1
}

$BaseURL = $config.BaseURL
$DebugPort = $config.DebugPort
$TimeoutSec = $config.TimeoutSec
$TargetPrefix = $config.TargetPrefix
$ListUrl     = "http://localhost:$DebugPort/json/list"
$Expression = @"
if (!window['__custom_dccon']) {
    const baseURL = '$BaseURL';
    const dcConsMapByKeyword = {};

    function prepareDccon() {
        const dcconListByStreamer = document.createElement('script');
        dcconListByStreamer.src = baseURL + '/lib/dccon_list.js';
        document.body.appendChild(dcconListByStreamer);

        return new Promise((resolve, reject) => {
            dcconListByStreamer.onload = resolve;
            dcconListByStreamer.onerror = reject;
        });
    }

    prepareDccon().then(() => {
        window['dcConsData'].forEach(dccon => {
            dccon.keywords.forEach(keyword => dcConsMapByKeyword[keyword] = dccon);
        });
    });

    function appendDCConBeforeNode(keyword, dccon, textNode) {
        const img = document.createElement('img');
        img.src = baseURL + '/images/dccon/' + dccon.name;
        img.alt = keyword;
        img.className = 'dccon';
        img.style.height = '100px';
        textNode.parentNode.insertBefore(img, textNode);
    }

    function onChatTextAdded(textNode) {
        const match = textNode.textContent.match(/^~([^~\s]+)(?:~([^~\s]+))?$/);
        if (!match) return;

        const [full, keyword1, keyword2] = match;
        const dccon1 = dcConsMapByKeyword[keyword1];
        const dccon2 = keyword2 ? dcConsMapByKeyword[keyword2] : null;

        if (keyword1 && !dccon1 || keyword2 && !dccon2) {
            console.log('No DCCon found for keyword');
            return;
        }

        if (dccon1) {
            appendDCConBeforeNode(keyword1, dccon1, textNode);
        }
        if (dccon2) {
            appendDCConBeforeNode(keyword2, dccon2, textNode);
        }

        textNode.textContent = '';
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    const textNode = node.querySelector('.chat .text');
                    onChatTextAdded(textNode);
                });
            }
        });
    });

    for (let i = 0; i < document.getElementsByClassName('chat_list').length; i++) {
        const chatList = document.getElementsByClassName('chat_list')[i];
        observer.observe(chatList, {
            childList: true
        });
    }
    window['__custom_dccon'] = true;
    'execute done';
} else {
    'already executed';
}
"@

$OpenLogOnError = $true

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Runtime.Extensions

try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 `
    -bor [System.Net.SecurityProtocolType]::Tls13
} catch { }

$logDir  = $BaseDir
$logFile = Join-Path $logDir ("ws-eval_errors_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
$hadError = $false
$errors = New-Object System.Collections.Generic.List[string]

function Write-Info($msg){ Write-Host "[INFO]  $msg" }
function Write-Warn($msg){ Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err ($msg){ Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Get-DebuggerList {
  param([string]$Url)
  Write-Info "Fetching debugger list: $Url"
  try {
    return Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec $TimeoutSec -UseBasicParsing
  } catch {
    throw "Failed to fetch debugger list from $Url : $($_.Exception.Message)"
  }
}

function Get-TargetWsUrls {
  param($DebuggerList, [string]$Prefix)
  $urls = @()
  foreach ($item in $DebuggerList) {
    if ($item -and $item.url -and $item.webSocketDebuggerUrl -and $item.url.StartsWith($Prefix)) {
      $urls += [string]$item.webSocketDebuggerUrl
    }
  }
  return $urls
}

function Connect-WebSocket {
  param([string]$WsUrl, [int]$TimeoutSec)

  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $cts = [System.Threading.CancellationTokenSource]::new()
  $cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))

  try {
    $uri = [Uri]$WsUrl
    $ws.ConnectAsync($uri, $cts.Token).GetAwaiter().GetResult()
    return @{ Socket = $ws; TokenSource = $cts }
  } catch {
    $cts.Dispose()
    throw "Connect failed: $($_.Exception.Message)"
  }
}

function Send-Text {
  param([System.Net.WebSockets.ClientWebSocket]$Socket, [string]$Text, $Token)

  $bytes   = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $segment = [System.ArraySegment[byte]]::new($bytes)
  $Socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $Token).GetAwaiter().GetResult()
}

function Receive-TextOnce {
  param([System.Net.WebSockets.ClientWebSocket]$Socket, $Token)

  $buffer = New-Object byte[] (8192)
  $sb = [System.Text.StringBuilder]::new()

  while ($true) {
    $seg = [System.ArraySegment[byte]]::new($buffer)
    $res = $Socket.ReceiveAsync($seg, $Token).GetAwaiter().GetResult()

    if ($res.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      return $null
    }

    if ($res.Count -gt 0) {
      $null = $sb.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $res.Count))
    }

    if ($res.EndOfMessage) { break }
  }

  return $sb.ToString()
}

function Invoke-RuntimeEvaluate {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    $Token,
    [string]$Expression,
    [int]$Id
  )
  $cmdObj = @{
    id = $Id
    method = "Runtime.evaluate"
    "params" = @{ expression = $Expression }
  }
  $cmdJson = $cmdObj | ConvertTo-Json -Compress

  Send-Text -Socket $Socket -Text $cmdJson -Token $Token

  while ($true) {
    $text = Receive-TextOnce -Socket $Socket -Token $Token
    if (-not $text) { throw "Socket closed before response (id=$Id)" }
    try {
      $obj = $text | ConvertFrom-Json
    } catch {
      continue
    }
    if ($obj.id -eq $Id) { return $obj }
  }
}

$success = 0
$failed  = 0

try {
  $list = Get-DebuggerList -Url $ListUrl
  $targets = Get-TargetWsUrls -DebuggerList $list -Prefix $TargetPrefix

  if (-not $targets -or $targets.Count -eq 0) {
    throw "No targets matched prefix: $TargetPrefix"
  }

  Write-Info ("Matched {0} target(s)." -f $targets.Count)

  $i = 0
  foreach ($wsUrl in $targets) {
    $i++
    Write-Info "[$i/$($targets.Count)] Connecting: $wsUrl"
    try {
      $conn = Connect-WebSocket -WsUrl $wsUrl -TimeoutSec $TimeoutSec
      $ws   = $conn.Socket
      $cts  = $conn.TokenSource

      $id = 1000 + $i

      Write-Info "Sending Runtime.evaluate to $wsUrl (id=$id)"
      $resp = Invoke-RuntimeEvaluate -Socket $ws -Token $cts.Token -Expression $Expression -Id $id

      $raw = ($resp | ConvertTo-Json -Depth 10)
      if ($raw.Length -gt 1200) { $raw = $raw.Substring(0,1200) + " ... (truncated)" }
      Write-Host "[$i] OK: $wsUrl`n$raw`n"

      try {
        $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "bye", $cts.Token).GetAwaiter().GetResult()
      } catch {}

      $cts.Dispose()
      $success++
    }
    catch {
      $failed++
      $hadError = $true
      $msg = "[{0}] FAIL: {1} : {2}" -f $i, $wsUrl, $_
      Write-Err $msg
      $errors.Add(("{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $msg))
      try { if ($ws -and $ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) { $ws.Abort() } } catch {}
      try { if ($cts) { $cts.Dispose() } } catch {}
    }
  }

  Write-Host "---- SUMMARY ----"
  Write-Host ("Success: {0}, Failed: {1}, Total: {2}" -f $success, $failed, ($success+$failed))
  Write-Host "Press Enter to exit..."
  [void][System.Console]::ReadLine()
}
catch {
  $hadError = $true
  $msg = "FATAL: $($_.Exception.Message)"
  Write-Err $msg
  $errors.Add(("{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $msg))
}
finally {
  if ($hadError -and $errors.Count -gt 0) {
    $errors | Out-File -FilePath $logFile -Encoding UTF8
    Write-Warn "Errors logged to: $logFile"
    if ($OpenLogOnError) {
      Start-Process notepad.exe $logFile | Out-Null
    }
    exit 1
  } else {
    exit 0
  }
}