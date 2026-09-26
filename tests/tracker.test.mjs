import test from 'node:test';
import assert from 'node:assert/strict';
import { withDeadline, cameraError } from '../dist/tracker.js';
test('late camera/model resources are disposed after cancellation',async()=>{
  const abort=new AbortController();let resolve,disposed=false;
  const pending=withDeadline(new Promise(r=>resolve=r),abort.signal,1000,'timeout',()=>disposed=true);
  abort.abort();await assert.rejects(pending,{name:'AbortError'});resolve({});await Promise.resolve();assert.equal(disposed,true);
});
test('late resources are also disposed after timeout',async()=>{
  let resolve,disposed=false;const abort=new AbortController();
  const pending=withDeadline(new Promise(r=>resolve=r),abort.signal,5,'model timed out',()=>disposed=true);
  await assert.rejects(pending,/model timed out/);resolve({});await Promise.resolve();assert.equal(disposed,true);
});
test('successful resources are retained, and failed loads propagate',async()=>{
  const abort=new AbortController();const resource={};
  assert.equal(await withDeadline(Promise.resolve(resource),abort.signal,100,'timeout'),resource);
  await assert.rejects(withDeadline(Promise.reject(new Error('unavailable')),abort.signal,100,'timeout'),/unavailable/);
});
test('already cancelled sessions release incoming resources',async()=>{
  const abort=new AbortController();abort.abort();let disposed=false;
  await assert.rejects(withDeadline(Promise.resolve({}),abort.signal,100,'timeout',()=>disposed=true),{name:'AbortError'});
  assert.equal(disposed,true);
});
test('camera failures offer specific recovery instructions',()=>{
  assert.match(cameraError({name:'NotAllowedError'}),/denied/);
  assert.match(cameraError({name:'NotFoundError'}),/No camera/);
  assert.match(cameraError({name:'NotReadableError'}),/busy/);
});
