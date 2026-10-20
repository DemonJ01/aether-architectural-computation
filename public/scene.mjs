import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {generateStudy, DEFAULT_PARAMS} from './aether-engine.mjs';
import {solve, axonSVG} from './engine.mjs';

const C = {concrete:'#e5e1d4',core:'#ada594',orange:'#cb7143',glass:'#8b9a9b',landscape:'#b8bfaa',beam:'#858e85',access:'#d7b15f'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

export function createAetherScene(container, options={}) {
  let towerStudy=generateStudy(options.params||DEFAULT_PARAMS), serviceStudy=solve(), routeId='derived';
  let phase=0,targetPhase=0,disposed=false,visible=true,dragging=false,frame=0,settle=0;
  let renderer,controls,resizeObserver,intersectionObserver,width=1,height=1;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-60,60,60,-60,.1,2000);
  const tower=new THREE.Group(), site=new THREE.Group(), service=new THREE.Group();
  scene.add(tower,site,service);
  const geometries=new Set(),materials=new Set(),dynamicGeometry=new Set();
  const floorParts=[],shadeParts=[];
  const towerMaterials=new Set();
  const serviceGeometries=new Set(),serviceMaterials=new Set();
  const cameraDirection=new THREE.Vector3(1,.86,1.2).normalize();
  let coreGroup,facade,ribsGroup,anchor=new THREE.Vector3(),selectedLevel;
  const clippingPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),1000);
  const surface=document.createElement('div');
  Object.assign(surface.style,{position:'absolute',inset:'0',overflow:'hidden'});
  const fallbackRoot=document.createElement('div');
  Object.assign(fallbackRoot.style,{position:'absolute',inset:'0',display:'none'});
  surface.append(fallbackRoot);
  container.append(surface);

  function geometry(data,dynamic=false) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(data.vertices.flat(),3));
    g.setIndex(data.faces.flat());g.computeVertexNormals();
    geometries.add(g);if(dynamic)dynamicGeometry.add(g);return g;
  }
  function mat(color,opts={}) {
    const m=new THREE.MeshStandardMaterial({color,roughness:.8,metalness:0,...opts});
    materials.add(m);return m;
  }
  const material={
    slab:mat(C.concrete),shade:mat(C.orange,{roughness:.65}),core:mat(C.core),
    glass:mat(C.glass,{transparent:true,opacity:.43,roughness:.4,metalness:.16,depthWrite:false,side:THREE.DoubleSide}),
    rib:mat('#c4b69d'),corner:mat(C.orange,{roughness:.6}),site:mat('#e3e0d4'),path:mat('#d7d1bf'),
    tree:mat(C.landscape,{flatShading:true}),trunk:mat('#a18d72'),
    floor:mat('#e6e1d3'),beam:mat(C.beam),route:mat('#d48147',{roughness:.55}),
    failed:mat('#b45b37',{roughness:.6}),access:mat(C.access,{transparent:true,opacity:.15,depthWrite:false,side:THREE.DoubleSide}),
    head:mat('#b6bda6',{transparent:true,opacity:.045,depthWrite:false,side:THREE.DoubleSide})
  };
  const boxGeo=new THREE.BoxGeometry(1,1,1);geometries.add(boxGeo);
  const cylinder=new THREE.CylinderGeometry(1,1,1,5);geometries.add(cylinder);
  const crown=new THREE.IcosahedronGeometry(1,1);geometries.add(crown);
  function mesh(data,m,parent,dynamic=false) {const o=new THREE.Mesh(geometry(data,dynamic),m);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  function box(size,position,m,parent) {const o=new THREE.Mesh(boxGeo,m);o.scale.set(...size);o.position.set(...position);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  function beam(a,b,r,m,parent) {
    const u=new THREE.Vector3(...a),v=new THREE.Vector3(...b),d=v.clone().sub(u);
    const o=new THREE.Mesh(cylinder,m);o.scale.set(r,d.length(),r);o.position.copy(u.add(v).multiplyScalar(.5));
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());o.castShadow=true;parent.add(o);return o;
  }
  function clearGroup(group) {while(group.children.length)group.remove(group.children[0]);}
  function rebuildTower(params) {
    towerStudy=generateStudy(params);
    for(const g of dynamicGeometry){g.dispose();geometries.delete(g);}dynamicGeometry.clear();
    for(const m of towerMaterials){m.dispose();materials.delete(m);}towerMaterials.clear();
    clearGroup(tower);clearGroup(site);floorParts.length=0;shadeParts.length=0;
    facade=mesh(towerStudy.geometry.envelope,material.glass,tower,true);
    towerStudy.geometry.slabs.forEach((g,i)=>{const m=material.slab.clone();materials.add(m);towerMaterials.add(m);floorParts.push({object:mesh(g,m,tower,true),index:i});});
    towerStudy.geometry.shades.forEach((g,i)=>{const m=material.shade.clone();materials.add(m);towerMaterials.add(m);shadeParts.push({object:mesh(g,m,tower,true),index:i+1});});
    coreGroup=new THREE.Group();tower.add(coreGroup);
    towerStudy.geometry.core.forEach(g=>mesh(g,material.core,coreGroup,true));
    ribsGroup=new THREE.Group();tower.add(ribsGroup);
    const interpolate=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
    towerStudy.floors.forEach((floor,i)=>{
      const next=towerStudy.levels[i+1];
      floor.corners.forEach((a,side)=>[0,.25,.5,.75].forEach(f=>{
        const b=floor.corners[(side+1)%4],aa=interpolate(a,b,f);
        const bb=interpolate(next.corners[side],next.corners[(side+1)%4],f);
        beam(aa,bb,f===0?.16:.055,f===0?material.corner:material.rib,ribsGroup);
      }));
    });
    const sw=Math.max(72,towerStudy.params.width*1.85),sd=Math.max(62,towerStudy.params.depth*2);
    box([sw,1.2,sd],[0,-.9,0],material.site,site);
    box([sw-.6,.08,sd-.6],[0,-.27,0],material.slab,site);
    box([sw-.7,.035,5.6],[0,-.20,sd*.34],material.path,site);
    box([5.6,.035,sd-.7],[-sw*.33,-.19,0],material.path,site);
    const positions=[[-sw/2+6,-sd*.3],[-sw/2+6,0],[-sw/2+6,sd*.3],[sw/2-6,-sd*.3],[sw/2-6,0],[sw/2-6,sd*.3],[-18,-sd/2+5],[0,-sd/2+5],[18,-sd/2+5]];
    positions.forEach(([x,z],i)=>{
      const s=i%3===0?.8:1;beam([x,-.2,z],[x,2*s,z],.14,material.trunk,site);
      const t=new THREE.Mesh(crown,material.tree);t.position.set(x,3*s,z);t.scale.setScalar(1.75*s);t.castShadow=true;site.add(t);
    });
    selectedLevel=towerStudy.levels[Math.floor(towerStudy.params.floors*.45)];
    anchor.set(0,selectedLevel.y+.02,selectedLevel.depth/2-4.12).applyAxisAngle(new THREE.Vector3(0,1,0),selectedLevel.rotation);
    anchor.y=selectedLevel.y+.02;
    service.position.copy(anchor);service.rotation.y=selectedLevel.rotation;
    wake();
  }
  function drawService() {
    clearGroup(service);
    for(const g of serviceGeometries){g.dispose();geometries.delete(g);}serviceGeometries.clear();
    for(const m of serviceMaterials){m.dispose();materials.delete(m);}serviceMaterials.clear();
    box([12,.09,8],[0,-.045,0],material.floor,service);
    const lineMat=new THREE.LineBasicMaterial({color:'#c4c2b1',transparent:true,opacity:.65});materials.add(lineMat);serviceMaterials.add(lineMat);
    const points=[];
    for(let x=0;x<=12;x++)points.push(x-6,.01,-4,x-6,.01,4);
    for(let y=0;y<=8;y++)points.push(-6,.01,y-4,6,.01,y-4);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometries.add(g);serviceGeometries.add(g);
    service.add(new THREE.LineSegments(g,lineMat));
    const row=serviceStudy.rows.find(r=>r.id===routeId)||serviceStudy.rows[0];
    const convertBox=(a,b,m)=>{
      const size=[b[0]-a[0],b[2]-a[2],b[1]-a[1]];
      const position=[(a[0]+b[0])/2-6,(a[2]+b[2])/2,(a[1]+b[1])/2-4];
      return box(size,position,m,service);
    };
    convertBox(serviceStudy.obstacles[0].min,serviceStudy.obstacles[0].max,material.beam);
    if(serviceStudy.params.maintenance) {
      const access=serviceStudy.obstacles[1];const am=convertBox(access.min,access.max,material.access);
      const edgeGeo=new THREE.EdgesGeometry(am.geometry);geometries.add(edgeGeo);serviceGeometries.add(edgeGeo);
      const lm=new THREE.LineBasicMaterial({color:'#bda264'});materials.add(lm);serviceMaterials.add(lm);
      const edge=new THREE.LineSegments(edgeGeo,lm);edge.scale.copy(am.scale);edge.position.copy(am.position);service.add(edge);
    }
    row.segments.forEach(s=>convertBox(s.min,s.max,row.feasible?material.route:material.failed));
    box([12,.01,8],[0,serviceStudy.params.headroom,0],material.head,service);
    const outlineGeo=new THREE.EdgesGeometry(boxGeo);geometries.add(outlineGeo);serviceGeometries.add(outlineGeo);
    const outlineMat=new THREE.LineBasicMaterial({color:'#b6b4a4',transparent:true,opacity:.4});materials.add(outlineMat);serviceMaterials.add(outlineMat);
    const outline=new THREE.LineSegments(outlineGeo,outlineMat);outline.scale.set(12,3.6,8);outline.position.y=1.8;service.add(outline);
    wake();
  }
  function fitTarget() {
    const p=phase;
    const explosion=smooth(.3,1.1,p)*(1-smooth(1.25,2,p));
    floorParts.forEach(({object,index})=>{object.position.y=index*1.12*explosion;const alpha=(1-smooth(2.05,2.7,p))*(index>selectedLevel.index?1-smooth(1.5,1.85,p):1);object.material.transparent=alpha<.999;object.material.opacity=alpha;object.material.depthWrite=alpha>.7;object.castShadow=alpha>.99;object.visible=alpha>.001;});
    shadeParts.forEach(({object,index})=>{object.position.y=index*1.12*explosion;const alpha=(1-smooth(2.05,2.7,p))*(index>selectedLevel.index?1-smooth(1.5,1.85,p):1);object.material.transparent=alpha<.999;object.material.opacity=alpha;object.material.depthWrite=alpha>.7;object.castShadow=alpha>.99;object.visible=alpha>.001;});
    const towerFade=1-smooth(2.05,2.7,p);
    tower.visible=towerFade>.002;site.visible=tower.visible;
    facade.visible=p<1.9;
    material.glass.opacity=.43*(1-smooth(.4,1.2,p));
    for(const name of ['slab','shade','core','rib','corner','site','path','tree','trunk']) {
      const m=material[name];m.transparent=towerFade<.999;m.opacity=towerFade;m.depthWrite=towerFade>.65;
    }
    ribsGroup.visible=explosion<.05;
    clippingPlane.constant=mix(towerStudy.metrics.height+2,selectedLevel.y+3.9,smooth(1.3,2.1,p));
    if(renderer)renderer.clippingPlanes=p>1.3&&p<2.8?[clippingPlane]:[];
    service.visible=p>1.5;
    const focus=smooth(1.6,2.7,p),aspect=width/Math.max(1,height);
    const direction=cameraDirection;
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
    const up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const fullTarget=new THREE.Vector3(0,(towerStudy.metrics.height+towerStudy.params.floors*1.12*explosion)*.37,0);
    const zoneCenter=new THREE.Vector3(0,1.8,0).applyAxisAngle(new THREE.Vector3(0,1,0),selectedLevel.rotation).add(anchor);
    const target=fullTarget.clone().lerp(zoneCenter,focus);
    const points=towerStudy.levels.flatMap(level=>level.corners.map(v=>new THREE.Vector3(v[0],v[1]+level.index*1.12*explosion,v[2])));
    const sw=Math.max(72,towerStudy.params.width*1.85),sd=Math.max(62,towerStudy.params.depth*2);
    for(const x of [-sw/2,sw/2])for(const z of [-sd/2,sd/2])points.push(new THREE.Vector3(x,-1.5,z));
    let fullHalf=1;
    const available=aspect>1.2?.65:.92;
    for(const point of points){const d=point.clone().sub(fullTarget);fullHalf=Math.max(fullHalf,Math.abs(d.dot(up)),Math.abs(d.dot(right))/(aspect*available));}
    fullHalf/= .88;
    const zoneHalf=Math.max(6.8,9.4/(aspect*(aspect>1.2?.62:.92)));
    const half=mix(fullHalf,zoneHalf,focus);
    const side=[0,1,-1,1,-1,1],i=Math.min(4,Math.floor(p)),f=p-i;
    const shift=aspect>1.2?mix(side[i],side[i+1],smooth(0,1,f))*.20:0;
    target.addScaledVector(right,half*2*aspect*shift);
    return {target,half};
  }
  function updateCamera(immediate=false) {
    if(dragging)return;
    const fit=fitTarget(),aspect=width/Math.max(1,height);
    const alpha=immediate||reduced.matches?1:.16;
    const currentTarget=controls?.target||new THREE.Vector3();
    currentTarget.lerp(fit.target,alpha);
    camera.position.copy(currentTarget).addScaledVector(cameraDirection,250);
    camera.up.set(0,1,0);camera.lookAt(currentTarget);
    const half=mix(camera.top||fit.half,fit.half,alpha);
    camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;
    camera.updateProjectionMatrix();
    if(controls){controls.target.copy(currentTarget);controls.update();}
  }
  function fallback() {
    container.dataset.sceneRenderer='fallback';fallbackRoot.style.display='block';
    if(phase>=2)fallbackRoot.innerHTML=axonSVG(serviceStudy,routeId,{background:'#efeee8'});
    else {
      const project=([x,y,z])=>[(x-z)*.9,-y+(x+z)*.3];
      const points=towerStudy.levels.flatMap(l=>l.corners).map(project);
      const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
      const s=Math.min(440/(maxX-minX),420/(maxY-minY));
      const P=v=>{const a=project(v);return [250+(a[0]-(minX+maxX)/2)*s,235+(a[1]-(minY+maxY)/2)*s].join(',');};
      fallbackRoot.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 470" role="img" aria-label="Aether tower generated from the same floor geometry">'+towerStudy.levels.map(l=>'<polygon points="'+l.corners.map(P).join(' ')+'" fill="#e6dfcf" fill-opacity=".55" stroke="#cb7143" stroke-width="1.2"/>').join('')+'</svg>';
    }
    const svg=fallbackRoot.querySelector('svg');if(svg)Object.assign(svg.style,{width:'100%',height:'100%'});
    container.querySelector('.scene-poster')?.remove();
  }
  function tick() {
    frame=0;if(disposed||!visible)return;
    const diff=targetPhase-phase;
    phase=(!renderer||reduced.matches)?targetPhase:phase+diff*.14;
    if(Math.abs(diff)<.001)phase=targetPhase;
    if(!renderer){fallback();return;}
    updateCamera();
    try{renderer.render(scene,camera);}catch{renderer.dispose();renderer=null;fallback();return;}
    if(Math.abs(targetPhase-phase)>.001||settle-->0)frame=requestAnimationFrame(tick);
  }
  function wake() {if(!disposed&&visible&&!frame){settle=Math.max(settle,35);frame=requestAnimationFrame(tick);}}
  function resize() {
    width=container.clientWidth||1;height=container.clientHeight||1;
    if(renderer){renderer.setSize(width,height,false);updateCamera(true);}wake();
  }
  rebuildTower(towerStudy.params);drawService();
  try {
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
    renderer.setClearColor(0xefeee8,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
    renderer.localClippingEnabled=true;
    renderer.domElement.setAttribute('role','img');
    renderer.domElement.setAttribute('aria-label','Aether 3D: generated tower, cutaway floor and authored service routes. Drag to orbit; scroll continues the page.');
    surface.prepend(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff,1.8));
    scene.add(new THREE.HemisphereLight(0xfffdf4,0xb5b2a1,1.2));
    const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(-55,110,55);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-90,right:90,top:150,bottom:-90,far:400});
    sun.shadow.bias=-.00025;sun.shadow.normalBias=.08;scene.add(sun);
    const fill=new THREE.DirectionalLight(0xf5e7d2,.7);fill.position.set(60,40,-50);scene.add(fill);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;
    controls.enableZoom=false;controls.enablePan=false;controls.maxPolarAngle=Math.PI/2.05;
    controls.addEventListener('start',()=>{dragging=true;wake();});
    controls.addEventListener('change',()=>{if(dragging){cameraDirection.copy(camera.position).sub(controls.target).normalize();settle=45;wake();}});
    controls.addEventListener('end',()=>{dragging=false;wake();});
    renderer.domElement.style.touchAction='pan-y';
    container.dataset.sceneRenderer='webgl';
    container.querySelector('.scene-poster')?.remove();
  } catch {renderer=null;fallback();}
  if('ResizeObserver'in window){resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);}else window.addEventListener('resize',resize);
  if('IntersectionObserver'in window){intersectionObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)wake();else{cancelAnimationFrame(frame);frame=0;}},{rootMargin:'100px'});intersectionObserver.observe(container);}
  const motionChange=()=>{phase=targetPhase;wake();};reduced.addEventListener?.('change',motionChange);
  resize();
  return {
    setPhase(value){const next=clamp(Number(value)||0,0,5);if(Math.abs(next-targetPhase)<.0001)return;targetPhase=next;wake();},
    setTowerParams(params){rebuildTower(params);drawService();if(!renderer)fallback();wake();return towerStudy;},
    setStudy(data,id){serviceStudy=data;routeId=id||data.selectedId||data.rows[0].id;drawService();if(!renderer)fallback();wake();},
    capture(){if(renderer){renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');}return null;},
    dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);controls?.dispose();resizeObserver?.disconnect();intersectionObserver?.disconnect();window.removeEventListener('resize',resize);reduced.removeEventListener?.('change',motionChange);for(const g of geometries)g.dispose();for(const m of materials)m.dispose();renderer?.dispose();surface.remove();}
  };
}
