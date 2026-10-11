// Копирует шрифт Montserrat (SIL OFL) из npm-пакета в ресурсы интерфейса,
// чтобы шрифт работал без интернета.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/@fontsource-variable/montserrat/files/';
const dst = 'src/assets/fonts/';
mkdirSync(dst, { recursive: true });
for (const f of ['montserrat-cyrillic-wght-normal.woff2', 'montserrat-latin-wght-normal.woff2']) {
  if (!existsSync(src + f)) { console.error('Нет файла шрифта: ' + src + f + ' — выполните npm install'); process.exit(1); }
  copyFileSync(src + f, dst + f);
  console.log('font:', f);
}
