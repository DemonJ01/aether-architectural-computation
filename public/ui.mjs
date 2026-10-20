import {createAetherScene} from './scene.mjs';
import {DEFAULT_PARAMS, generateStudy, runSweep, exportOBJ} from './aether-engine.mjs';
import {solve, planSVG, RULES} from './engine.mjs';

const $=id=>document.getElementById(id);
const format=n=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:0}).format(n);
const baseline=solve(),sweep=runSweep(DEFAULT_PARAMS);
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const scene=createAetherScene($('aether-scene'));
let tower=generateStudy(DEFAULT_PARAMS),study=baseline,selected='derived',userChose=false;
let revision=0,requestNo=0,debounce,scrollFrame=0,disposed=false,exportURL,sceneKey='';
const chapters=[...document.querySelectorAll('.chapter')];
const phaseWords=['Aether.','Generate.','Context.','Check.','Revise.','Test.'];
const phaseTitles=['Aether / Generated form','Aether / Shared geometry','Construction information / Authored insert','Occupied space / Headroom','Route generation / Clearance','Live study / Model change'];
const phaseCaptions=['18 storeys · 64.8 m · 60° total twist','Floor plates, shade rings and a fitted core','A 12 × 8 × 3.6 m service-zone insert','Below beam · 2.25 m underside · R02 fails','Clearance-derived bypass · 16.20 m · passes','Change an input. Inspect the result.'];
let activePhase=-1,livePhase=0,wordTimer;
for(const r of baseline.rows){const o=document.createElement('option');o.value=r.id;o.textContent=r.name;$('route-select').append(o);}
$('route-select').value=selected;

function themePlan(s,id) {
  return planSVG(s,id).replaceAll('#f4f2eb','#efeee8').replaceAll('#087f78','#bf7546').replaceAll('#bb5639','#a94f31');
}
function syncSceneRoute() {
  const route=livePhase<2.65?'direct':livePhase<3.65?'under':livePhase<4.65?'derived':selected;
  const data=livePhase<4.65?baseline:study;
  const key=route+':'+(data===baseline?'baseline':revision);
  if(key!==sceneKey){sceneKey=key;scene.setStudy(data,route);}
}
function renderStudy() {
  const row=study.rows.find(r=>r.id===selected)||study.rows[0];
  $('beam-value').textContent=study.params.beamSoffit.toFixed(2)+' m';
  $('head-value').textContent=study.params.headroom.toFixed(2)+' m';
  $('clear-value').textContent=study.params.clearance.toFixed(2)+' m';
  $('route-select').value=row.id;
  $('route-length').textContent=row.length.toFixed(2)+' m';
  $('route-underside').textContent=row.minHeadroom.toFixed(2)+' m';
  $('pass-count').textContent=study.feasibleCount+' / '+study.rows.length;
  $('route-outcome').textContent=row.name+(row.feasible?' meets the three checks.':' fails '+row.violations.join(', ')+'.');
  $('route-outcome').dataset.state=row.feasible?'pass':'fail';
  $('rule-results').innerHTML=row.checks.map(check=>{
    const rule=RULES.find(r=>r.id===check.rule);
    return '<div class="rule-line"><div><strong>'+rule.id+' / '+rule.title+'</strong><span class="'+(check.pass?'pass':'fail')+'">'+(check.pass?'Pass':'Fail')+'</span></div><p>'+check.detail+'</p></div>';
  }).join('');
  $('route-plan').innerHTML=themePlan(study,selected);
  $('route-table').innerHTML='<table><thead><tr><th scope="col">Arrangement</th><th scope="col">Length</th><th scope="col">Underside</th><th scope="col">Result</th></tr></thead><tbody>'+study.rows.map(r=>'<tr class="'+(r.id===study.selectedId?'preferred':'')+'"><th scope="row">'+r.name+'</th><td>'+r.length.toFixed(2)+' m</td><td>'+r.minHeadroom.toFixed(3)+' m</td><td class="'+(r.feasible?'pass':'fail')+'">'+(r.feasible?'Pass':r.violations.join(', '))+'</td></tr>').join('')+'</tbody></table>';
  syncSceneRoute();
}
function renderTower() {
  $('tower-floor-title').textContent=tower.params.floors===18?'Eighteen floors.':tower.params.floors+' floors.';
  phaseCaptions[0]=tower.params.floors+' storeys · '+tower.metrics.height.toFixed(1)+' m · '+tower.params.twist+'° total twist';
  $('tower-height').textContent=tower.metrics.height.toFixed(1)+' m';
  $('tower-area').textContent=format(tower.metrics.grossFloorArea)+' m²';
  $('twist-value').textContent=tower.params.twist+'°';
  $('taper-value').textContent=Math.round(tower.params.taper*100)+'%';
  $('floors-value').textContent=tower.params.floors;
}
let towerTimer;
for(const id of ['twist','taper','floors'])$(id).addEventListener('input',()=>{
  const params={...DEFAULT_PARAMS,twist:Number($('twist').value),taper:Number($('taper').value)/100,floors:Number($('floors').value)};
  tower=generateStudy(params);renderTower();clearTimeout(towerTimer);
  towerTimer=setTimeout(()=>{if(!disposed)scene.setTowerParams(params);},60);
});

function renderSweep() {
  const left=55,top=28,w=430,h=237,minX=8000,maxX=16600,minY=1050,maxY=2100;
  const X=n=>left+(n-minX)/(maxX-minX)*w,Y=n=>top+h-(n-minY)/(maxY-minY)*h;
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 330" role="img" aria-label="Twelve Aether cases: gross floor area in square metres versus an illustrative material carbon proxy in tonnes of carbon dioxide equivalent"><rect width="520" height="330" fill="#e6e4da"/>';
  for(const v of [1100,1400,1700,2000])svg+='<path d="M55 '+Y(v)+'H485" stroke="#c9cdbb" stroke-width=".7"/><text x="45" y="'+(Y(v)+3)+'" text-anchor="end" font-family="Arial" font-size="9" fill="#858676">'+format(v)+'</text>';
  for(const v of [8500,11000,13500,16000])svg+='<text x="'+X(v)+'" y="284" text-anchor="middle" font-family="Arial" font-size="9" fill="#858676">'+format(v)+'</text>';
  const front=sweep.filter(r=>r.pareto).sort((a,b)=>a.metrics.grossFloorArea-b.metrics.grossFloorArea);
  svg+='<polyline points="'+front.map(r=>X(r.metrics.grossFloorArea)+','+Y(r.metrics.embodiedCarbon/1000)).join(' ')+'" fill="none" stroke="#bf7b49" stroke-width="1.2" stroke-dasharray="3 4"/>';
  sweep.forEach((r,i)=>{
    const x=X(r.metrics.grossFloorArea),y=Y(r.metrics.embodiedCarbon/1000);
    svg+='<g><title>'+r.name+'; '+format(r.metrics.grossFloorArea)+' square metres; '+(r.metrics.embodiedCarbon/1000).toFixed(1)+' tonnes proxy; '+(r.pareto?'non-dominated':'dominated in this set')+'</title><circle cx="'+x+'" cy="'+y+'" r="'+(r.pareto?5:3.5)+'" fill="'+(r.pareto?'#c57b49':'#a6ad98')+'"/><text x="'+(x+(r.pareto?-9:9))+'" y="'+(y+(r.pareto?13:-7))+'" font-size="7" font-family="Arial" fill="#8b886f">'+String(i+1).padStart(2,'0')+'</text></g>';
  });
  svg+='<text x="270" y="315" text-anchor="middle" font-family="Arial" font-size="9" fill="#7a806d">GROSS FLOOR AREA / m² →</text><text x="16" y="150" transform="rotate(-90 16 150)" text-anchor="middle" font-family="Arial" font-size="9" fill="#7a806d">MATERIAL PROXY / tCO₂e ↓</text></svg>';
  $('sweep-plot').innerHTML=svg;
  $('sweep-table').innerHTML='<table><thead><tr><th scope="col">n / taper / twist</th><th scope="col">GFA m²</th><th scope="col">Proxy tCO₂e</th><th scope="col">Front</th></tr></thead><tbody>'+sweep.map(r=>'<tr><th scope="row">'+r.params.floors+' / '+Math.round(r.params.taper*100)+'% / '+r.params.twist+'°</th><td>'+format(r.metrics.grossFloorArea)+'</td><td>'+(r.metrics.embodiedCarbon/1000).toFixed(1)+'</td><td>'+(r.pareto?'●':'—')+'</td></tr>').join('')+'</tbody></table>';
}
function params(){return {beamSoffit:Number($('beam').value),headroom:Number($('headroom').value),clearance:Number($('clearance').value),maintenance:$('maintenance').checked};}
async function evaluate() {
  const id=++requestNo;revision++;
  $('lab-state').textContent='Updating…';$('lab-error').hidden=true;
  try{
    const response=await fetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params())});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error?.message||'The study could not be updated.');
    if(id!==requestNo||disposed)return;
    study=data;if(!userChose)selected=data.selectedId||selected;
    renderStudy();$('lab-state').textContent='Study ready';
    if(livePhase>=4.65)$('scene-caption').textContent=study.feasibleCount+' of 6 pass · '+study.rows.find(r=>r.id===selected).name;
  }catch(error){if(id!==requestNo||disposed)return;$('lab-state').textContent='Update unavailable';$('lab-error').textContent=error.message;$('lab-error').hidden=false;}
}
for(const id of ['beam','headroom','clearance'])$(id).addEventListener('input',()=>{
  $(id==='beam'?'beam-value':id==='headroom'?'head-value':'clear-value').textContent=Number($(id).value).toFixed(2)+' m';
  clearTimeout(debounce);debounce=setTimeout(evaluate,100);
});
$('maintenance').addEventListener('change',evaluate);
$('study-controls').addEventListener('submit',e=>e.preventDefault());
$('route-select').addEventListener('change',()=>{selected=$('route-select').value;userChose=true;renderStudy();});
$('reset-study').addEventListener('click',()=>{$('beam').value=2.7;$('headroom').value=2.4;$('clearance').value=.1;$('maintenance').checked=true;selected='derived';userChose=false;evaluate();});

function sweepCSV(){
  const columns=['id','floors','width','depth','floorHeight','twist','taper','shadeDepth','height','grossFloorArea','envelopeArea','embodiedCarbon','carbonIntensity','pareto'];
  return columns.join(',')+'\n'+sweep.map(r=>[r.id,...['floors','width','depth','floorHeight','twist','taper','shadeDepth'].map(k=>r.params[k]),...['height','grossFloorArea','envelopeArea','embodiedCarbon','carbonIntensity'].map(k=>r.metrics[k]),r.pareto].join(',')).join('\n')+'\n';
}
$('download').addEventListener('click',async()=>{
  const button=$('download'),format=$('download-format').value;
  if(format==='pdf'){const a=document.createElement('a');a.href='/Saatvik-Computation-Portfolio.pdf';a.download='Saatvik-Computation-Portfolio.pdf';a.click();return;}
  button.disabled=true;
  try{
    let blob,extension;
    if(format==='obj'){blob=new Blob([exportOBJ(tower)],{type:'text/plain'});extension='obj';}
    else if(format==='tower-json'){blob=new Blob([JSON.stringify(tower,null,2)],{type:'application/json'});extension='json';}
    else if(format==='sweep-csv'){blob=new Blob([sweepCSV()],{type:'text/csv'});extension='csv';}
    else {
      extension=format.split('-')[1];
      const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({params:study.params,format:extension,routeId:selected})});
      if(!response.ok)throw new Error('The export could not be generated.');
      blob=await response.blob();
    }
    if(disposed)return;
    if(exportURL)URL.revokeObjectURL(exportURL);exportURL=URL.createObjectURL(blob);
    $('download-preview').hidden=false;$('download-preview').open=true;$('download-label').textContent=format.replaceAll('-',' ')+' export ready';
    $('download-content').textContent=(await blob.text()).slice(0,6000);
    $('download-link').href=exportURL;$('download-link').download='aether-'+format+'.'+extension;$('download-link').click();
  }catch(error){$('download-preview').hidden=false;$('download-preview').open=true;$('download-label').textContent='Export unavailable';$('download-content').textContent=error.message;}
  finally{button.disabled=false;}
});

function updateScroll() {
  scrollFrame=0;if(disposed)return;
  const journey=$('work').getBoundingClientRect(),h=window.innerHeight;
  let progress;
  if(window.innerWidth>760){
    progress=Math.max(0,Math.min(5,(76-journey.top)/Math.max(1,h-76)));
  }else {
    const target=h*.74;
    const positions=chapters.map(c=>c.getBoundingClientRect());
    let i=0;for(let n=0;n<positions.length;n++)if(positions[n].top<target)i=n;
    const next=positions[i+1];
    progress=Math.max(0,Math.min(5,i+(next?Math.max(0,(target-positions[i].top)/Math.max(1,positions[i].height))*.45:0)));
  }
  livePhase=progress;
  scene.setPhase(reduced.matches?Math.round(progress):progress);
  syncSceneRoute();
  const index=Math.max(0,Math.min(5,Math.round(progress)));
  if(index!==activePhase){
    const first=activePhase<0;activePhase=index;clearTimeout(wordTimer);if(reduced.matches||first){$('model-word').textContent=phaseWords[index];$('model-word').classList.remove('is-changing');}else{$('model-word').classList.add('is-changing');wordTimer=setTimeout(()=>{$('model-word').textContent=phaseWords[index];$('model-word').classList.remove('is-changing');},100);}$('scene-title').textContent=phaseTitles[index];$('scene-counter').textContent=String(index+1).padStart(2,'0')+' / 06';$('scene-caption').textContent=phaseCaptions[index];
  }
  if(!reduced.matches){const local=progress-Math.round(progress);$('model-word').style.transform='translateY('+(local*-40)+'px)';$('model-word').style.opacity=String(1-Math.abs(local)*.45);}else{$('model-word').style.transform='none';$('model-word').style.opacity='1';}
  const max=document.documentElement.scrollHeight-h;
  $('reading-progress').style.transform='scaleX('+(max>0?Math.min(1,Math.max(0,window.scrollY/max)):0)+')';
  const current=$('research').getBoundingClientRect().top<h*.45?'research':$('results').getBoundingClientRect().top<h*.45?'results':'work';
  document.querySelectorAll('nav a').forEach(a=>{if(a.getAttribute('href')==='#'+current)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
}
function scheduleScroll(){if(!scrollFrame)scrollFrame=requestAnimationFrame(updateScroll);}
window.addEventListener('scroll',scheduleScroll,{passive:true});window.addEventListener('resize',scheduleScroll,{passive:true});
document.addEventListener('focusin',event=>{
  if(window.innerWidth>760||!event.target.closest('.chapters')||!event.target.matches('input,select,summary,button,a'))return;
  requestAnimationFrame(()=>{const target=event.target.getBoundingClientRect(),stage=$('cinema-stage').getBoundingClientRect();if(target.top<stage.bottom+16&&stage.bottom>0)window.scrollBy({top:target.top-stage.bottom-16,behavior:'instant'});else if(target.bottom>window.innerHeight-20)window.scrollBy({top:target.bottom-window.innerHeight+20,behavior:'instant'});});
});

const observers=[];
if('IntersectionObserver'in window){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}}),{threshold:.06});
  document.querySelectorAll('.reveal').forEach(e=>observer.observe(e));observers.push(observer);
  document.documentElement.classList.add('motion-ready');
}
function motionChange(){document.documentElement.classList.toggle('reduced-motion',reduced.matches);scheduleScroll();}
reduced.addEventListener?.('change',motionChange);motionChange();
renderTower();renderSweep();renderStudy();updateScroll();
fetch('/api/study').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(!revision&&!disposed){study=data;renderStudy();}}).catch(()=>{if(!disposed)$('lab-state').textContent='Start the project server for live edits';});
window.addEventListener('pagehide',event=>{if(event.persisted||disposed)return;disposed=true;clearTimeout(wordTimer);requestNo++;clearTimeout(debounce);clearTimeout(towerTimer);cancelAnimationFrame(scrollFrame);observers.forEach(o=>o.disconnect());window.removeEventListener('scroll',scheduleScroll);window.removeEventListener('resize',scheduleScroll);reduced.removeEventListener?.('change',motionChange);scene.dispose();if(exportURL)URL.revokeObjectURL(exportURL);});
