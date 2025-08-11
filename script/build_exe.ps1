Invoke-PS2EXE `
   -inputFile "./main.ps1" `
   -outputFile "./dist/main.exe" `
   -noConsole:$false `
   -requireAdmin:$false
