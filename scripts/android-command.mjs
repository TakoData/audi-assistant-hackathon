// Never leave the demo launcher silently hanging on an unresponsive emulator.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const adb = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.HOME,'Library/Android/sdk'),'platform-tools/adb');
try {
  const output=execFileSync(adb,process.argv.slice(2),{timeout:Number(process.env.AUDI_ADB_TIMEOUT_MS || 15000),maxBuffer:8*1024*1024});
  process.stdout.write(output);
} catch(error) {
  if(error.code==='ETIMEDOUT') console.error('Android emulator is not responding. Quit its window and reopen the demo launcher.');
  else if(error.stderr) process.stderr.write(error.stderr);
  process.exit(1);
}
