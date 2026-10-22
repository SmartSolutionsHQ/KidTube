import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

export async function compressAssets(directory) {
  let rawBytes = 0, brotliBytes = 0, gzipBytes = 0, files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await compressAssets(file);
      rawBytes += nested.rawBytes; brotliBytes += nested.brotliBytes; gzipBytes += nested.gzipBytes; files += nested.files;
    } else if (entry.isFile() && ['.html', '.js', '.mjs', '.css', '.json', '.svg'].includes(extname(file))) {
      const data = await readFile(file);
      const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
      const gz = gzipSync(data, { level: 9 });
      if (br.length < data.length) await writeFile(file + '.br', br);
      if (gz.length < data.length) await writeFile(file + '.gz', gz);
      rawBytes += data.length; brotliBytes += Math.min(br.length, data.length); gzipBytes += Math.min(gz.length, data.length); files++;
    }
  }
  return { files, rawBytes, brotliBytes, gzipBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await compressAssets(resolve(process.argv[2] || 'public'))));
}
