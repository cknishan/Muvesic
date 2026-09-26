import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionMapper, SCALES, pitchIndex, noteName, frequency } from '../dist/music.js';

test('pitch runs from high at the top to low at the bottom in every scale',()=>{
  for(const [name,scale] of Object.entries(SCALES)) {
    const mapper=new MotionMapper(name);
    assert.equal(mapper.update(.5,0,0).midi,scale.notes.at(-1));
    mapper.reset();assert.equal(mapper.update(.5,1,0).midi,scale.notes[0]);
    for(let i=0;i<scale.notes.length;i++){mapper.reset();assert.equal(mapper.update(.5,(i+.5)/scale.notes.length,0).midi,scale.notes.at(-1-i));}
  }
});
test('stationary hand sustains without repeated attacks',()=>{
  const mapper=new MotionMapper();assert.equal(mapper.update(.5,.5,0).trigger,true);
  for(let t=33;t<2000;t+=33)assert.equal(mapper.update(.5,.5,t).trigger,false);
});
test('note boundaries tolerate small jitter but allow deliberate crossings',()=>{
  assert.equal(pitchIndex(.501,6,2),2);
  assert.equal(pitchIndex(.519,6,2),2);
  assert.equal(pitchIndex(.53,6,2),3);
  assert.equal(pitchIndex(-10,6),0);assert.equal(pitchIndex(10,6),5);
});
test('new regions sound, with attacks limited to 85 ms apart',()=>{
  const mapper=new MotionMapper();assert.equal(mapper.update(.5,1,0).trigger,true);
  assert.equal(mapper.update(.5,0,33).trigger,false);
  assert.equal(mapper.update(.5,0,66).trigger,false);
  assert.equal(mapper.update(.5,0,99).trigger,true);
});
test('velocity increases with movement speed, and stereo pans across the stage',()=>{
  const slow=new MotionMapper(),fast=new MotionMapper();slow.update(0,.8,0);fast.update(0,.8,0);
  assert.ok(fast.update(.2,.6,100).velocity>slow.update(.2,.6,280).velocity);
  const mapper=new MotionMapper();assert.equal(mapper.update(0,.5,0).pan,-1);
  mapper.reset();assert.equal(mapper.update(1,.5,0).pan,1);
});
test('tracking reacquisition starts fresh without stale speed or pitch',()=>{
  const mapper=new MotionMapper();mapper.update(0,1,0);mapper.update(1,0,100);
  mapper.reset();const result=mapper.update(.5,.5,200);assert.equal(result.trigger,true);assert.equal(result.intensity,0);
  assert.equal(mapper.update(.1,.8,1000).intensity,0);
});
test('invalid coordinates and timestamps cannot generate random notes',()=>{
  const mapper=new MotionMapper();assert.equal(mapper.update(NaN,.5,0),null);assert.equal(mapper.update(.5,Infinity,0),null);
  mapper.update(.5,.5,100);assert.equal(mapper.update(0,0,99),null);assert.equal(mapper.update(0,0,100),null);
});
test('scale changes reset the note gate and reject unknown scales',()=>{
  const mapper=new MotionMapper();mapper.update(.5,1,0);mapper.setScale('minor');assert.equal(mapper.update(.5,1,100).midi,57);
  assert.throws(()=>mapper.setScale('__proto__'));
});
test('musical names and tuning use standard MIDI pitches',()=>{assert.equal(noteName(60),'C4');assert.equal(noteName(69),'A4');assert.equal(frequency(69),440);});
