const fs = require('fs');
const path = require('path');
const terser = require('terser');

const src = path.join(__dirname, '..', 'main.js');
const dst = path.join(__dirname, '..', 'dist', 'browserEmoticonReplacer.min.js');

if (!fs.existsSync(src)) {
    console.error(`main.js not found: ${src}`);
    process.exit(1);
}

const code = fs.readFileSync(src, 'utf-8');

terser.minify(code, { compress: true, mangle: true }).then(result => {
    if (result.error) {
        console.error('Minify error:', result.error);
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, result.code, 'utf-8');
    console.log(`Minified file created: ${dst}`);
}).catch(err => {
    console.error('Minify failed:', err);
    process.exit(1);
});
