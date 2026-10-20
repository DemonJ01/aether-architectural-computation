import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../public/vendor/three.module.min.js';
import {generateStudy,DEFAULT_PARAMS} from '../public/aether-engine.mjs';
import {solve,axonSVG} from '../public/engine.mjs';

test('Aether fallback follows tower edits, routing phases and idempotent disposal without WebGL',async()=>{
  const source=(await readFile(new URL('../public/scene.mjs',import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replace('export function createAetherScene','function createAetherScene');
  let next=0;const frames=new Map(),observations=[];
  class Element {
    constructor(){this.style={};this.dataset={};this.children=[];this.clientWidth=700;this.clientHeight=600;this.markup='';}
    append(...nodes){this.children.push(...nodes);}
    prepend(...nodes){this.children.unshift(...nodes);}
    remove(){this.removed=true;}
    setAttribute(){}
    addEventListener(){}
    removeEventListener(){}
    getContext(){return null;}
    querySelector(selector){return selector==='svg'&&this.markup.includes('<svg')?{style:{}}:null;}
    set innerHTML(text){this.markup=text;}
    get innerHTML(){return this.markup;}
  }
  const media={matches:false,addEventListener(){},removeEventListener(){}};
  const fakeWindow={matchMedia:()=>media,devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
  const fakeDocument={createElement:()=>new Element(),createElementNS:()=>new Element()};
  class Observer {constructor(fn){this.fn=fn;observations.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  const raf=fn=>{const id=++next;frames.set(id,fn);return id;};
  const cancel=id=>frames.delete(id);
  const run=()=>{let budget=10;while(frames.size&&budget--){const [id,fn]=frames.entries().next().value;frames.delete(id);fn();}assert.ok(budget>=0,'fallback must not animate indefinitely');};
  const factory=new Function('THREE','OrbitControls','generateStudy','DEFAULT_PARAMS','solve','axonSVG','window','document','ResizeObserver','IntersectionObserver','requestAnimationFrame','cancelAnimationFrame',source+'\nreturn createAetherScene;');
  const create=factory(THREE,class{},generateStudy,DEFAULT_PARAMS,solve,axonSVG,fakeWindow,fakeDocument,Observer,Observer,raf,cancel);
  const originalDocument=globalThis.document;globalThis.document=fakeDocument;
  const originalError=console.error;console.error=()=>{};
  try{
    const host=new Element(),scene=create(host);run();
    assert.equal(host.dataset.sceneRenderer,'fallback');
    const markup=()=>host.children[0].children.find(child=>child.markup)?.markup||'';
    assert.match(markup(),/Aether tower/);
    scene.setPhase(3);run();assert.match(markup(),/Axonometric service zone/);
    scene.setStudy(solve({beamSoffit:3.05}),'under');run();assert.match(markup(),/Authored study geometry/);
    scene.setTowerParams({...DEFAULT_PARAMS,floors:8});scene.setPhase(1);run();
    assert.equal((markup().match(/<polygon /g)||[]).length,9);
    media.matches=true;scene.setPhase(5);run();assert.match(markup(),/Axonometric service zone/);
    scene.dispose();scene.dispose();assert.equal(frames.size,0);assert.ok(observations.every(o=>o.disconnected));
  }finally{console.error=originalError;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});
