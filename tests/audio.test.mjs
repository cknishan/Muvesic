import test from 'node:test';
import assert from 'node:assert/strict';
import { Synthesizer } from '../dist/audio.js';
class Param{value=0;events=[];setTargetAtTime(...a){this.events.push(['target',...a]);}setValueAtTime(...a){this.events.push(['set',...a]);}linearRampToValueAtTime(...a){this.events.push(['attack',...a]);}exponentialRampToValueAtTime(...a){this.events.push(['decay',...a]);}cancelAndHoldAtTime(...a){this.events.push(['hold',...a]);}}
class Node{gain=new Param();pan=new Param();frequency=new Param();connect(){}disconnect(){this.disconnected=true;}start(){this.started=true;}stop(){this.stopped=true;this.onended?.();}}
class Context{currentTime=0;state='suspended';destination=new Node();oscillators=[];createGain(){return new Node();}createDynamicsCompressor(){return new Node();}createStereoPanner(){return new Node();}createBiquadFilter(){return new Node();}createOscillator(){const n=new Node();this.oscillators.push(n);return n;}async resume(){this.state='running';}async close(){this.state='closed';}}
test('all instruments generate oscillators, envelope and correct tuning',async()=>{
  for(const sound of ['keys','synth','bell','bass','guitar']){
    const synth=new Synthesizer(Context);await synth.start();synth.play(69,.5,1,sound);
    assert.equal(synth.voice.oscillators[0].oscillator.frequency.value,sound==='bass'?220:440);
    assert.equal(synth.voice.panner.pan.value,1);
    assert.ok(synth.voice.gain.gain.events.some(e=>e[0]==='attack'));
    assert.ok(synth.context.oscillators.every(o=>o.started));await synth.close();
  }
});
test('guitar has a bright fundamental and a quick plucked decay',async()=>{
  const synth=new Synthesizer(Context);await synth.start();synth.play(69,.5,0,'guitar');
  const voice=synth.voice;
  assert.deepEqual(voice.oscillators.map(partial=>partial.oscillator.frequency.value),[440,880,1320]);
  assert.deepEqual(voice.oscillators.map(partial=>partial.oscillator.type),['sawtooth','sine','sine']);
  assert.deepEqual(voice.filter.frequency.events,[['set',4500,0],['decay',900,.28]]);
  assert.deepEqual(voice.gain.gain.events.filter(event=>event[0]==='attack'||event[0]==='decay'),[
    ['attack',.5,.002],['decay',.01,.6],
  ]);
  await synth.close();
});
test('changing notes releases old voices; loss/stop disconnects every oscillator',async()=>{
  const synth=new Synthesizer(Context);await synth.start();synth.play(60,.5,0,'keys');const old=[...synth.context.oscillators];
  synth.play(64,.5,0,'bell');assert.ok(old.every(o=>o.stopped&&o.disconnected));
  synth.release();assert.equal(synth.voice,null);assert.equal(synth.voices.size,0);await synth.close();assert.equal(synth.context.state,'closed');
});
test('mute and volume control the master gain, and pan updates sustained notes',()=>{
  const synth=new Synthesizer(Context);synth.setVolume(.8,true);assert.equal(synth.master.gain.events.at(-1)[1],0);
  synth.setVolume(.8,false);assert.equal(synth.master.gain.events.at(-1)[1],.8);
  synth.play(60,.5,0,'synth');synth.pan(-1);assert.equal(synth.voice.panner.pan.events.at(-1)[1],-1);
});
