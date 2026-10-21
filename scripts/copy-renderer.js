const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'renderer');
const dest = path.join(__dirname, '..', 'dist', 'renderer');
fs.mkdirSync(dest, { recursive: true });
for (const f of ['index.html', 'styles.css', 'renderer.js']) {
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
// app icon for window/taskbar
fs.copyFileSync(path.join(__dirname, '..', 'icon.png'), path.join(__dirname, '..', 'dist', 'icon.png'));

// toast hero images + 提醒网页（Windows 通知大图 / 浏览器提醒页）
const assetsSrc = path.join(__dirname, '..', 'assets');
const assetsDest = path.join(__dirname, '..', 'dist', 'assets');
if (fs.existsSync(assetsSrc)) {
  fs.mkdirSync(assetsDest, { recursive: true });
  for (const f of fs.readdirSync(assetsSrc)) {
    if (/\.(png|html)$/i.test(f)) {
      fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDest, f));
    }
  }
}
console.log('[copy-renderer] done ->', dest);
