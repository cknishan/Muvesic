import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
test('static server serves app modules with correct MIME types and refuses traversal',async()=>{
  const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  try{
    const [output]=await once(server.stdout,'data');const origin=output.toString().match(/http:\/\/localhost:\d+/)[0];
    for(const file of ['/','/app.js','/music.js','/audio.js','/tracker.js','/style.css','/favicon.svg']){
      const response=await fetch(origin+file);assert.equal(response.status,200,file);
      if(file.endsWith('.js'))assert.match(response.headers.get('content-type'),/javascript/);
    }
    assert.equal((await fetch(origin+'/missing.js')).status,404);
    assert.equal((await fetch(origin+'/',{method:'POST'})).status,405);
    assert.equal((await fetch(origin+'/%2e%2e%5cpackage.json')).status,403);
  }finally{server.kill();}
});
