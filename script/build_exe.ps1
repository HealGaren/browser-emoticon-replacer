$distDir = Join-Path $PSScriptRoot '..\dist'
if (-not (Test-Path $distDir)) {
    New-Item -Path $distDir -ItemType Directory -Force | Out-Null
}

Invoke-PS2EXE `
   -InputFile  "$PSScriptRoot\..\main.ps1" `
   -OutputFile "$distDir\browserEmoticonReplacer.exe" `
   -NoConsole:$false `
   -RequireAdmin:$false `
#    -Verbose