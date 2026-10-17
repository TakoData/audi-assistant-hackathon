// Android UI smoke-test helper: find controls by accessibility label, not pixels.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const adb = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.HOME, 'Library/Android/sdk'), 'platform-tools/adb');
const label = process.argv[2];
if (!label) throw new Error('Pass the exact visible text or accessibility label.');
let bounds;
for (let attempt=0; attempt<5; attempt++) {
  // Never read an old hierarchy when Android returns a null root during launch.
  const file = `/sdcard/audi-tap-${process.pid}-${attempt}.xml`;
  try {
    const output = execFileSync(adb, ['shell', 'uiautomator', 'dump', file], {encoding:'utf8',timeout:15000});
    if (!output.includes('dumped to:')) throw new Error('UI hierarchy not ready');
    const xml = execFileSync(adb, ['exec-out', 'cat', file], {encoding:'utf8',timeout:10000});
    const nodes = xml.match(/<node\b[^>]*>/g) || [];
    // Prefer the accessible control over a heading that happens to repeat it.
    const node = nodes.find(n => n.includes(`content-desc="${label}"`))
      || nodes.find(n => n.includes(`text="${label}"`));
    bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (bounds && Number(bounds[3])>Number(bounds[1]) && Number(bounds[4])>Number(bounds[2])) break;
    bounds = undefined;
  } catch { bounds = undefined; }
  finally { try { execFileSync(adb, ['shell', 'rm', '-f', file], {timeout:5000}); } catch {} }
  await new Promise(resolve=>setTimeout(resolve,1500));
}
if (!bounds) throw new Error(`Visible control not found after waiting: ${label}`);
const [,x1,y1,x2,y2] = bounds.map(Number);
execFileSync(adb, ['shell', 'input', 'tap', String(Math.round((x1+x2)/2)), String(Math.round((y1+y2)/2))], {timeout:10000});
console.log(`Tapped: ${label}`);
