import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';

test('play timeout and restore preemption release the queue without losing the checkpoint', { timeout: 10000 }, async () => {
  const output = resolve('out'); await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, 'play-deadline-')); await mkdir(join(root, 'lib'));
  await copyFile(new URL('../worker.mjs', import.meta.url), join(root, 'worker.mjs'));
  await writeFile(join(root, 'lib', 'ncm.mjs'), `
    export const isReady=async()=>true;
    export async function connect(){return {
      snapshot:async()=>({songId:'original',name:'original',seconds:9,queue:[]}),
      readState:async()=>({name:'original',playing:false,seconds:9}),
      playTrackById:async()=>{await new Promise(r=>setTimeout(r,600));return {ok:true,info:{name:'clip'}}},
      restore:async()=>({song:'original',seeked:9,steps:0,cleaned:true}),close(){}
    }};
  `);
  const child=spawn(process.execPath,[join(root,'worker.mjs')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:child.stdout}); const pending=new Map();let id=0, checkpoint;
  child.stderr.setEncoding('utf8');child.stderr.on('data',text=>{if(text.includes('记下中断点')&&checkpoint){checkpoint();checkpoint=null}});
  lines.on('line',line=>{const r=JSON.parse(line);const finish=pending.get(r.id);if(finish){pending.delete(r.id);finish(r)}});
  const send=cmd=>new Promise(resolve=>{const key=++id;pending.set(key,resolve);child.stdin.write(JSON.stringify({...cmd,id:key})+'\n')});
  try {
    assert.equal((await send({cmd:'ping'})).ready,true);
    const timed=await send({cmd:'play',songId:'clip',deadlineMs:Date.now()+200});
    assert.equal(timed.ok,false); assert.match(timed.error,/超过时限/);
    assert.equal((await send({cmd:'status'})).suspended,true);
    assert.equal((await send({cmd:'restore'})).ok,true);
    const captured=new Promise(resolve=>{checkpoint=resolve});
    const playing=send({cmd:'play',songId:'clip'});
    await captured;
    const restoring=send({cmd:'restore'});
    const cancelled=await playing;assert.equal(cancelled.ok,false);assert.match(cancelled.error,/复位请求中断/);
    assert.equal((await restoring).ok,true);
    await new Promise(resolve=>setTimeout(resolve,650));
    assert.equal((await send({cmd:'status'})).suspended,false);
    assert.equal((await send({cmd:'play',songId:'clip',deadlineMs:Date.now()-1})).ok,false);
    assert.equal((await send({cmd:'status'})).suspended,false);
  } finally {child.stdin.end();child.kill();lines.close()}
});

test('real worker reconnects after Chinese connection/timeout errors and keeps stdout JSON', { timeout: 10000 }, async () => {
  const output = resolve('out'); await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, 'worker-recovery-'));
  await mkdir(join(root, 'lib'));
  await copyFile(new URL('../worker.mjs', import.meta.url), join(root, 'worker.mjs'));
  await writeFile(join(root, 'lib', 'ncm.mjs'), `
    let count=0;
    export const isReady=async()=>true;
    export async function connect(){
      const n=++count;
      return {readState:async()=>{
        const errors=['CDP 连接已断开','页面求值超时','页面异常: TypeError: window.__ncm is undefined'];
        if(n<=errors.length)throw new Error(errors[n-1]);
        return {name:'connection-'+n,playing:false,seconds:0,duration:100};
      },close(){}};
    }
  `);
  const child = spawn(process.execPath, [join(root, 'worker.mjs')], { cwd: root, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const lines = createInterface({ input: child.stdout }); const pending = new Map(); let stderr='';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr+=text; });
  lines.on('line', line => { const r=JSON.parse(line); const finish=pending.get(r.id);if(finish){pending.delete(r.id);finish(r);} });
  const command = id => new Promise(resolve => { pending.set(id, resolve);child.stdin.write(JSON.stringify({id,cmd:'status'})+'\n'); });
  try {
    for(let id=1;id<=3;id++) { const r=await command(id);assert.equal(r.ok,false);assert.ok(r.error); }
    const recovered=await command(4);assert.equal(recovered.ok,true);assert.equal(recovered.name,'connection-4');
    assert.match(stderr,/命令失败 cmd=status/);
  } finally { child.stdin.end(); child.kill(); lines.close(); }
});

test('restore deadline releases the queue, retains the checkpoint and ignores a late completion', { timeout: 10000 }, async () => {
  const output = resolve('out'); await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, 'restore-deadline-')); await mkdir(join(root, 'lib'));
  await copyFile(new URL('../worker.mjs', import.meta.url), join(root, 'worker.mjs'));
  await writeFile(join(root, 'lib', 'ncm.mjs'), `
    let attempts=0,snapshots=0;
    export const isReady=async()=>true;
    export async function connect(){return {
      readState:async()=>({name:'attempts-'+attempts,playing:false,seconds:0,duration:100}),
      snapshot:async()=>({songId:'original',name:'original-'+(++snapshots),seconds:9,queue:[]}),
      playTrackById:async()=>({ok:true,info:{name:'clip',artists:'test'}}),
      restore:async s=>{
        attempts++;
        if(attempts===1)await new Promise(r=>setTimeout(r,450));
        return {song:s.name,target:9,seeked:9,error:0,steps:0,cleaned:true,wasPlaying:false};
      },close(){}
    }};
  `);
  const child=spawn(process.execPath,[join(root,'worker.mjs')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stderr.resume();const lines=createInterface({input:child.stdout});const pending=new Map();let id=0;
  lines.on('line',line=>{const r=JSON.parse(line);const finish=pending.get(r.id);if(finish){pending.delete(r.id);finish(r)}});
  const send=cmd=>new Promise(resolve=>{const key=++id;pending.set(key,resolve);child.stdin.write(JSON.stringify({...cmd,id:key})+'\n')});
  try {
    assert.equal((await send({cmd:'play',songId:'clip'})).ok,true);
    const failed=await send({cmd:'restore',deadlineMs:Date.now()+80});assert.equal(failed.ok,false);
    assert.equal((await send({cmd:'status'})).suspended,true);
    assert.equal((await send({cmd:'restore'})).ok,true);
    assert.equal((await send({cmd:'play',songId:'clip'})).ok,true);
    await new Promise(r=>setTimeout(r,550));
    const state=await send({cmd:'status'});assert.equal(state.suspended,true);assert.equal(state.savedName,'original-2');
    assert.equal((await send({cmd:'restore',deadlineMs:Date.now()-1})).ok,false);
    assert.equal((await send({cmd:'status'})).name,'attempts-2');
  } finally {child.stdin.end();child.kill();lines.close()}
});
