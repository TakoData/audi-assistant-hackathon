import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const adb = path.join(process.env.ANDROID_HOME || path.join(process.env.HOME,'Library/Android/sdk'),'platform-tools/adb');
const dir = path.resolve('artifacts', `device-pack-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(dir,{recursive:true});
const pause = ms => new Promise(r=>setTimeout(r,ms));
const run = async args => (await exec(adb,args,{timeout:20000,maxBuffer:8*1024*1024})).stdout;
let dumpSequence = 0;
const ui = async () => {
  let failure;
  for (let attempt=0; attempt<3; attempt++) {
    const file = `/sdcard/audi-pack-${process.pid}-${++dumpSequence}.xml`;
    try {
      const output = await run(['shell','uiautomator','dump',file]);
      if (!output.includes('dumped to:')) throw new Error('Android UI inspector returned no current hierarchy');
      const xml = await run(['exec-out','cat',file]);
      await run(['shell','rm',file]);
      return xml;
    } catch (error) { failure=error; await pause(1000); }
  }
  throw failure;
};
async function tap(label) {
  let xml = '';
  for (let attempt=0; attempt<4; attempt++) {
    xml = await ui();
    const node = xml.match(/<node\b[^>]*>/g)?.find(n=>n.includes(`content-desc="${label}"`) || n.includes(`text="${label}"`));
    const m = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if(m) {
      const [,x1,y1,x2,y2] = m.map(Number);
      if (x2>x1 && y2>y1) {
        await run(['shell','input','tap',String(Math.round((x1+x2)/2)),String(Math.round((y1+y2)/2))]);
        return;
      }
    }
    await pause(750);
  }
  await writeFile(path.join(dir,'missing-control.xml'),xml);
  throw new Error(`Visible control not found after waiting: ${label}`);
}
const scenarios = [
  'Nvidia stock price',
  'Weather in Wolfsburg today',
  'Explain regenerative braking in two sentences',
  'Compare Volkswagen and Toyota annual revenue',
  'What is the population of Wolfsburg',
  'What is the current inflation rate in Germany',
  'Who leads the Bundesliga table',
  'Compare annual revenue of Volkswagen Toyota and BMW and explain the main differences',
];
const queries = process.env.AUDI_TEST_QUERY ? [process.env.AUDI_TEST_QUERY] : scenarios;
const results=[];
for(let i=0;i<queries.length;i++) {
  const question=queries[i], prefix=String(i+1).padStart(2,'0'), coldStart=i%3===0;
  const started=Date.now();
  let logs='';
  let logger;
  try {
    if(coldStart) {
      await run(['shell','am','force-stop','com.tako.volkswagen.demo']);
      await run(['shell','am','start','-n','com.tako.volkswagen.demo/.MainActivity']);
      let homeReady = false;
      for (let attempt=0; attempt<5; attempt++) {
        await pause(1500);
        const home = await ui();
        if(home.includes('content-desc="Tap to talk"')) { homeReady = true; break; }
        await writeFile(path.join(dir,`${prefix}-launch-wait.xml`),home);
      }
      if(!homeReady) throw new Error('App launch did not reach the assistant');
    }
    await run(['logcat','-c']);
    logger=spawn(adb,['logcat','-s','ReactNativeJS:I']);
    logger.stdout.on('data',chunk=>{logs+=chunk.toString();});
    // A prior failed scenario may have left the editor open. Do not toggle it
    // closed and then misreport an absent input as an application launch issue.
    if (!(await ui()).includes('content-desc="Type your question"')) await tap('Type a question');
    // Wait for the native editor/IME layout, then explicitly focus it. A fixed
    // 400 ms delay could inject text before Android had focused the field.
    await tap('Type your question');
    await pause(1200); // Let Android finish its IME focus/adjust-pan transition.
    await run(['shell','input','text',question.replaceAll(' ','%s')]);
    await pause(1500); // Allow final native text events to reach the UI inspector.
    const entered = await ui();
    if (!entered.match(/<node\b[^>]*>/g)?.some(n => n.includes('class="android.widget.EditText"') && n.includes(`text="${question}"`))) {
      await writeFile(path.join(dir,`${prefix}-input-failure.xml`),entered);
      throw new Error('Test keyboard input did not reach the question field');
    }
    await tap('Send question');
    let completed=false, metadata=null;
    for(let attempt=0;attempt<100;attempt++) {
      if(logs.includes('AUDI_DEMO_ANSWER_FAILED')) throw new Error('Answer request failed');
      const line=logs.split('\n').find(l=>l.includes('AUDI_DEMO_ANSWER_COMPLETE'));
      const json=line?.match(/\{.*\}/)?.[0];
      if(json) metadata=JSON.parse(json);
      if(metadata && logs.includes('AUDI_SPEECH_FINISHED') && (!metadata.cards || logs.includes('AUDI_CARD_READY'))) {completed=true;break;}
      await pause(1000);
    }
    if(!completed) throw new Error('Answer, speech or card did not finish within the test deadline');
    const screen=await ui();
    // Card-first results deliberately omit the repeated query heading. The
    // exact question was verified in the editor before submission above.
    if(!screen.includes('Replay spoken answer')) throw new Error('Answer replay control is missing');
    if(metadata.cards && screen.includes('text="Audi assistant"')) throw new Error('Redundant header still takes space above the card');
    if(!metadata.cards && !screen.includes('text="Audi assistant"')) throw new Error('Text-only answer header is missing');
    await writeFile(path.join(dir,`${prefix}-ui.xml`),screen);
    const png=await exec(adb,['exec-out','screencap','-p'],{encoding:'buffer',timeout:15000,maxBuffer:8*1024*1024});
    await writeFile(path.join(dir,`${prefix}.png`),png.stdout);
    results.push({question,passed:true,coldStart,...metadata,totalMs:Date.now()-started});
    console.log(`PASS ${prefix} ${coldStart?'cold launch':'consecutive'} | ${question} | ${metadata.cards} cards | speech finished`);
  } catch(error) {
    results.push({question,passed:false,coldStart,error:error.message,totalMs:Date.now()-started});
    console.log(`FAIL ${prefix} ${question}: ${error.message}`);
  }
  logger?.kill();
  await writeFile(path.join(dir,`${prefix}.log`),logs);
  await writeFile(path.join(dir,'results.json'),JSON.stringify(results,null,2));
}
const passed=results.filter(r=>r.passed).length;
await writeFile(path.join(dir,'report.txt'),`${passed}/${results.length} device queries passed.\n${results.map(r=>`${r.passed?'PASS':'FAIL'} ${r.question}${r.error?' — '+r.error:''}`).join('\n')}\n`);
console.log(`\n${passed}/${results.length} passed. Evidence: ${dir}`);
if(passed!==results.length)process.exit(1);
