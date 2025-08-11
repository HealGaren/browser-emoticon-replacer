Install-Module -Name ps2exe -force -Scope CurrentUser
import-module -Name ps2exe
Invoke-PS2EXE `
   -inputFile "./main.ps1" `
   -outputFile "./main.exe" `
   -noConsole:$false `
   -requireAdmin:$false