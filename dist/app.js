import { MotionMapper, SCALES, noteName, frequency, clamp } from './music.js';
import { Synthesizer } from './audio.js';
import { HandTracker, cameraError } from './tracker.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['stage','camera','overlay','lanes','welcome','tracking-hint','status','input-label','start','stop','mode','reset','sound','scale','scale-hint','volume','volume-value','mute','note','frequency','dynamics','meter','meter-fill','pan-dot','session-time','error','stage-help'].map(id => [id,$(id)]));
const mapper = new MotionMapper();
const ctx = ui.overlay.getContext('2d');
let mode = 'camera', state = 'idle', muted = false, audio = null, tracker = null, generation = 0, started = 0, sessionTimer = null;
let lastVisual = null, trail = [], keyboard = { x: .5, y: .5 }, tracking = false, pointerId = null, mouseFrame = 0, mouseActive = false;
const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

function setStatus(message) { ui.status.textContent = message; }
function renderLanes() {
  ui.lanes.replaceChildren(...[...SCALES[ui.scale.value].notes].reverse().map((midi, i) => {
    const lane = document.createElement('div'); lane.className = 'lane';
    const label = document.createElement('span'); label.textContent = noteName(midi);
    const hint = document.createElement('span'); hint.className = 'key-hint'; hint.textContent = String(i + 1).padStart(2, '0');
    lane.append(label, hint); return lane;
  }));
  ui['scale-hint'].textContent = SCALES[ui.scale.value].hint;
}
function renderControls() {
  document.body.dataset.running = String(state === 'running');
  ui.start.disabled = state !== 'idle'; ui.stop.disabled = state === 'idle';
  ui.start.innerHTML = `<span aria-hidden="true">▶</span> ${state === 'loading' ? 'Starting…' : mode === 'camera' ? 'Start camera' : 'Start playing'}`;
  ui.mode.innerHTML = mode === 'camera' ? 'Try with mouse <span aria-hidden="true">↗</span>' : 'Use camera <span aria-hidden="true">↗</span>';
  ui['input-label'].textContent = mode === 'camera' ? 'CAMERA INPUT' : 'MOUSE / KEYS';
  ui.welcome.hidden = state === 'running';
  ui.camera.hidden = mode !== 'camera';
  ui.stage.style.touchAction = state === 'running' && mode === 'mouse' ? 'none' : 'auto';
  ui['stage-help'].textContent = mode === 'camera'
    ? 'Use one hand · Lift to go higher · Move sideways to pan · Move faster for louder notes'
    : 'Move your pointer to play · On touchscreens, drag · Arrow keys change pitch and pan · Escape stops';
  ui.welcome.querySelector('p').innerHTML = mode === 'camera'
    ? 'Start your camera, then move your<br>index finger up and down to play.'
    : 'Press Start playing, then move your pointer.<br>You can also focus this area and use arrow keys.';
}
function volumeChanged() {
  audio?.setVolume(Number(ui.volume.value) / 100, muted);
  ui['volume-value'].textContent = `${ui.volume.value}%`;
  ui.mute.setAttribute('aria-pressed', String(muted)); ui.mute.textContent = muted ? 'Unmute' : 'Mute';
}
function clearVisual() {
  lastVisual = null; trail = []; ctx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  [...ui.lanes.children].forEach(lane => lane.classList.remove('active'));
  ui.note.textContent = '—'; ui.frequency.textContent = 'Waiting to play';
  ui.dynamics.textContent = 'At rest'; ui['meter-fill'].style.width = '0%'; ui.meter.setAttribute('aria-valuenow','0'); ui['pan-dot'].style.left = '50%';
}
function loseTracking() {
  mouseActive = false;
  if (tracking) { audio?.release(); mapper.reset(); clearVisual(); }
  tracking = false;
  ui['tracking-hint'].hidden = state !== 'running' || mode !== 'camera';
  if (state === 'running') setStatus(mode === 'camera' ? 'No hand detected' : 'Move into the play area');
}
function paint(landmarks, point, time) {
  const w = ui.overlay.clientWidth, h = ui.overlay.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  if (ui.overlay.width !== Math.round(w*dpr) || ui.overlay.height !== Math.round(h*dpr)) { ui.overlay.width = Math.round(w*dpr); ui.overlay.height = Math.round(h*dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  if (landmarks) {
    ctx.strokeStyle = '#d4f5a788'; ctx.lineWidth = 2;
    for (const [a,b] of connections) { ctx.beginPath(); ctx.moveTo((1-landmarks[a].x)*w,landmarks[a].y*h); ctx.lineTo((1-landmarks[b].x)*w,landmarks[b].y*h); ctx.stroke(); }
    for (const landmark of landmarks) { ctx.beginPath(); ctx.arc((1-landmark.x)*w,landmark.y*h,3,0,Math.PI*2); ctx.fillStyle='#e3f6d4'; ctx.fill(); }
  }
  trail = trail.filter(p => time - p.time < 550); trail.push({x:point.x,y:point.y,time});
  for (let i=1;i<trail.length;i++) { ctx.beginPath(); ctx.moveTo(trail[i-1].x*w,trail[i-1].y*h); ctx.lineTo(trail[i].x*w,trail[i].y*h); ctx.strokeStyle=`rgba(198,243,107,${(i/trail.length)*.5})`;ctx.lineWidth=3;ctx.stroke(); }
  ctx.beginPath(); ctx.arc(point.x*w,point.y*h,17,0,Math.PI*2);ctx.fillStyle='#c6f36b26';ctx.fill();
  ctx.beginPath();ctx.arc(point.x*w,point.y*h,6,0,Math.PI*2);ctx.fillStyle='#d9ff95';ctx.fill();
  lastVisual = { landmarks, point, time };
}
function playPoint(x,y,time,landmarks=null) {
  if (state !== 'running') return;
  const mapped = mapper.update(x,y,time); if (!mapped) return;
  tracking = true; ui['tracking-hint'].hidden = true;
  setStatus(mode === 'camera' ? 'Hand tracked · Playing' : 'Mouse & keys · Playing');
  try {
    if (mapped.trigger) audio.play(mapped.midi,mapped.velocity,mapped.pan,ui.sound.value);
    else audio.pan(mapped.pan);
  } catch { fail(new Error('Audio playback stopped. Press Start to try again.')); return; }
  [...ui.lanes.children].forEach((lane,i) => lane.classList.toggle('active',i===mapped.index));
  ui.note.textContent = noteName(mapped.midi); ui.frequency.textContent = `${frequency(mapped.midi).toFixed(1)} Hz`;
  const intensity = Math.round(mapped.intensity*100);
  ui['meter-fill'].style.width = `${intensity}%`;ui.meter.setAttribute('aria-valuenow',String(intensity));
  ui.dynamics.textContent = intensity > 65 ? 'Expressive' : intensity > 20 ? 'Flowing' : 'Gentle';
  ui['pan-dot'].style.left = `${mapped.x*100}%`;
  paint(landmarks,mapped,time);
}
function stop(message = 'Session stopped') {
  generation++; state='idle';
  tracker?.stop(); tracker=null;
  const previousAudio=audio; audio=null; void previousAudio?.close().catch(()=>{});
  clearInterval(sessionTimer); sessionTimer=null; cancelAnimationFrame(mouseFrame); mouseActive=false; mapper.reset(); tracking=false; pointerId=null;
  ui['tracking-hint'].hidden=true; clearVisual(); renderControls(); setStatus(message);
}
function fail(error) { stop('Unable to start');ui.error.textContent=cameraError(error);ui.error.hidden=false; }
async function start() {
  if (state !== 'idle') return;
  const token=++generation; state='loading';ui.error.hidden=true;renderControls();setStatus('Starting audio…');
  let ownAudio;
  try {
    ownAudio=new Synthesizer();audio=ownAudio;volumeChanged();
    await ownAudio.start();
    if(token!==generation){void ownAudio.close();return;}
    if(mode==='camera') {
      const ownTracker=new HandTracker(ui.camera,(landmarks,time)=>{
        if(token!==generation||state!=='running')return;
        if(!landmarks){loseTracking();return;}
        // The video is mirrored: align the control point and skeleton with what the player sees.
        playPoint(1-landmarks[8].x,landmarks[8].y,time,landmarks);
      },error=>{if(token===generation)fail(error);});
      tracker=ownTracker;await ownTracker.start(message=>{if(token===generation)setStatus(message);});
    }
    if(token!==generation)return;
    state='running';started=performance.now();ui['session-time'].textContent='00:00';
    sessionTimer=setInterval(()=>{const s=Math.floor((performance.now()-started)/1000);ui['session-time'].textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;},250);
    renderControls();loseTracking();
    if(mode==='mouse'){
      ui.stage.focus({preventScroll:true});
      let lastFrame=-Infinity;
      const tick=time=>{if(token!==generation)return;if(mouseActive&&time-lastFrame>=30){playPoint(keyboard.x,keyboard.y,time);lastFrame=time;}mouseFrame=requestAnimationFrame(tick);};
      mouseFrame=requestAnimationFrame(tick);
    }
  } catch(error) { if(token===generation && error.name!=='AbortError')fail(error); }
}
function applySettings(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['scale','sound','volume','mute'].includes(key)))throw new Error('Invalid instrument settings');
  const {scale=ui.scale.value,sound=ui.sound.value,volume=Number(ui.volume.value),mute=muted}=input;
  if(!Object.hasOwn(SCALES,scale)||!['keys','synth','bell'].includes(sound)||!Number.isFinite(volume)||volume<0||volume>100||typeof mute!=='boolean')throw new Error('Invalid instrument settings');
  const changed=scale!==ui.scale.value||sound!==ui.sound.value;
  ui.scale.value=scale;ui.sound.value=sound;ui.volume.value=String(volume);muted=mute;
  if(changed){audio?.release();mapper.setScale(scale);clearVisual();}
  volumeChanged();renderLanes();
  return {scale,sound,volume,muted};
}
ui.start.addEventListener('click',start);ui.stop.addEventListener('click',()=>stop());
ui.mode.addEventListener('click',()=>{stop('Ready when you are');mode=mode==='camera'?'mouse':'camera';ui.error.hidden=true;renderControls();});
ui.reset.addEventListener('click',()=>{stop('Ready when you are');mode='camera';applySettings({scale:'pentatonic',sound:'keys',volume:65,mute:false});ui['session-time'].textContent='00:00';ui.error.hidden=true;renderControls();});
for(const control of [ui.scale,ui.sound])control.addEventListener('change',()=>{audio?.release();mapper.setScale(ui.scale.value);clearVisual();renderLanes();});
ui.volume.addEventListener('input',volumeChanged);ui.mute.addEventListener('click',()=>{muted=!muted;volumeChanged();});
function pointer(e) { if(mode!=='mouse'||state!=='running'||(e.pointerType==='touch'&&pointerId!==e.pointerId))return;const rect=ui.stage.getBoundingClientRect();keyboard={x:clamp((e.clientX-rect.left)/rect.width),y:clamp((e.clientY-rect.top)/rect.height)};mouseActive=true; }
ui.stage.addEventListener('pointermove',pointer);
ui.stage.addEventListener('pointerdown',e=>{if(mode==='mouse'&&state==='running'){pointerId=e.pointerId;ui.stage.setPointerCapture(e.pointerId);ui.stage.focus({preventScroll:true});pointer(e);}});
ui.stage.addEventListener('pointerleave',()=>{if(mode==='mouse'&&pointerId===null)loseTracking();});
for(const name of ['pointerup','pointercancel','lostpointercapture'])ui.stage.addEventListener(name,e=>{if(mode==='mouse'){pointerId=null;loseTracking();}});
ui.stage.addEventListener('keydown',e=>{
  if(mode!=='mouse'||state!=='running'||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();const count=SCALES[ui.scale.value].notes.length;
  if(e.key==='ArrowUp'||e.key==='ArrowDown') { const lane=clamp(Math.floor(keyboard.y*count)+(e.key==='ArrowUp'?-1:1),0,count-1);keyboard.y=(lane+.5)/count;mapper.point=null; }
  else keyboard.x=clamp(keyboard.x+(e.key==='ArrowLeft'?-.1:.1));
  mouseActive=true;
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state!=='idle')stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state!=='idle')stop('Paused while this tab was away');});
window.addEventListener('pagehide',()=>stop());
new ResizeObserver(()=>{if(lastVisual)paint(lastVisual.landmarks,lastVisual.point,lastVisual.time);}).observe(ui.stage);

// Optional agent controls share exactly the same validated actions as the UI.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  const tools=[
    {name:'configure_instrument',description:'Set the musical scale, sound, volume and mute state. Does not start the camera or audio.',inputSchema:{type:'object',properties:{scale:{type:'string',enum:Object.keys(SCALES)},sound:{type:'string',enum:['keys','synth','bell']},volume:{type:'number',minimum:0,maximum:100},mute:{type:'boolean'}},additionalProperties:false},execute:input=>applySettings(input),annotations:{readOnlyHint:false}},
    {name:'stop_instrument',description:'Stop the camera, hand tracking and audio session.',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:()=>{stop();return{state};},annotations:{readOnlyHint:false}},
    {name:'read_instrument',description:'Read the current instrument settings and session state.',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:()=>({state,mode,scale:ui.scale.value,sound:ui.sound.value,volume:Number(ui.volume.value),muted}),annotations:{readOnlyHint:true}},
  ];
  for(const tool of tools){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
renderLanes();renderControls();volumeChanged();
