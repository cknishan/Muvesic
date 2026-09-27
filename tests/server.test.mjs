import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';

async function modulePaths(directory = new URL('../dist/', import.meta.url), prefix = '') {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) paths.push(...await modulePaths(new URL(entry.name + '/', directory), relative + '/'));
    else if (entry.name.endsWith('.js')) paths.push('/' + relative);
  }
  return paths;
}
test('static server serves app modules with correct MIME types and refuses traversal',async()=>{
  const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  try{
    const [output]=await once(server.stdout,'data');const origin=output.toString().match(/http:\/\/localhost:\d+/)[0];
    for(const file of ['/', '/style.css', '/favicon.svg', ...await modulePaths()]){
      const response=await fetch(origin+file);assert.equal(response.status,200,file);
      if(file.endsWith('.js'))assert.match(response.headers.get('content-type'),/javascript/);
    }
    assert.equal((await fetch(origin+'/missing.js')).status,404);
    assert.equal((await fetch(origin+'/',{method:'POST'})).status,405);
    assert.equal((await fetch(origin+'/%2e%2e%5cpackage.json')).status,403);
  }finally{server.kill();}
});
