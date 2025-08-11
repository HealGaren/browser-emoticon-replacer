const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const mainPs1Path = path.join(__dirname, '..', 'main.ps1');
const cmdPath = path.join(distDir, 'browserEmoticonReplacer.cmd');
const zipPath = path.join(distDir, 'browserEmoticonReplacer_win.zip');

// browserEmoticonReplacer.cmd 생성
fs.writeFileSync(cmdPath, 'powershell ./main.ps1\n', 'utf-8');

// 압축 파일 생성
const zip = new AdmZip();
zip.addLocalFile(mainPs1Path);
zip.addLocalFile(cmdPath);
zip.writeZip(zipPath);

console.log(`Created zip: ${zipPath}`);

