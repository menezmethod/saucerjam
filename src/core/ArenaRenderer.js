import * as THREE from "three";
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP, RULES, WEAPONS, angleDiff } from "../../shared/simulation";
import {World} from '../world/World';
import {CameraRig} from '../view/CameraRig';
import {ShipIndicators} from '../view/ShipIndicators';
import {CombatFX} from './CombatFX';
import {coverOccludes} from './visibility';
const Y=.9;
// `?lowgfx` (or the test harness flag) trades antialiasing, shadows and resolution
// for frame rate on software rendering and old GPUs.
const LOW_GFX=typeof window!=='undefined'&&(window.__SAUCERJAM_LOWGFX===true||new URLSearchParams(location.search).has('lowgfx'));
const pixelRatio=()=>LOW_GFX?.5:Math.min(devicePixelRatio,1.5);
export class ArenaRenderer {
  constructor(canvas){
    this.canvas=canvas;this.renderer=new THREE.WebGLRenderer({canvas,antialias:!LOW_GFX,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(pixelRatio());this.renderer.setClearColor('#080d18');
    this.renderer.shadowMap.enabled=!LOW_GFX;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(55,1,.1,400);this.rig=new CameraRig(this.camera);
    this.world=new World(this.scene,this.renderer);this.fx=new CombatFX(this.scene);
    this.ships=new Map();this.shots=new Map();this.pickups=new Map();this.view=0;this.zoom=1;this.cameraReady=false;this.frameTime=0;this.reduceMotion=false;
    this.ray=new THREE.Raycaster();this.floor=new THREE.Plane(new THREE.Vector3(0,1,0),-Y);
    const overlay=document.createElement('div');overlay.id='ship-indicators';overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:4';document.getElementById('hud').append(overlay);this.indicators=new ShipIndicators(overlay);this.indicatorRoot=overlay;
    this.reticle=new THREE.Mesh(new THREE.RingGeometry(.5,.56,32),new THREE.MeshBasicMaterial({color:'#8defff',depthTest:false,transparent:true,opacity:.85}));this.reticle.rotation.x=-Math.PI/2;this.reticle.renderOrder=5;this.reticle.visible=false;this.scene.add(this.reticle);
    this.grenadeRing=new THREE.Mesh(new THREE.RingGeometry(WEAPONS.GRENADE.radius-.04,WEAPONS.GRENADE.radius,64),new THREE.MeshBasicMaterial({color:WEAPONS.GRENADE.color,depthTest:false,transparent:true,opacity:.55}));this.grenadeRing.rotation.x=-Math.PI/2;this.grenadeRing.visible=false;this.scene.add(this.grenadeRing);
    this.shotGeometries={LASER:new THREE.CylinderGeometry(.055,.055,1.5,6).rotateX(Math.PI/2),BOUNCE:new THREE.CylinderGeometry(.10,.10,3,8).rotateX(Math.PI/2),GRENADE:new THREE.IcosahedronGeometry(.27,1)};this.shotMaterials=Object.fromEntries(Object.entries(WEAPONS).map(([key,w])=>[key,new THREE.MeshBasicMaterial({color:w.color})]));
    this.resize();window.addEventListener('resize',()=>this.resize());
    // Observe the CSS surface as mobile browser chrome changes its visible
    // height, even when the layout viewport does not emit a window resize.
    this.resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>this.resize()):null;
    this.resizeObserver?.observe(canvas);
    this.visualViewport=window.visualViewport||null;
    this.onVisualViewportResize=()=>this.resize();
    this.visualViewport?.addEventListener('resize',this.onVisualViewportResize);
    this.buildArena(MAP);
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect(),width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));
    const ratio=pixelRatio();
    if(this.width===width&&this.height===height&&this.pixelRatio===ratio)return;
    this.width=width;this.height=height;this.pixelRatio=ratio;
    this.renderer.setPixelRatio(ratio);this.renderer.setSize(width,height,false);
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.rig?.reset();
  }
  buildArena(map){this.map=map;this.world.build(map);this.renderer.shadowMap.needsUpdate=true;this.fx.clear();this.rig.reset();this.cameraReady=false;}
  setTimeOfDay(time){this.world.setTimeOfDay(time);this.renderer.shadowMap.needsUpdate=true;}
  makeShip(p){
    const group=new THREE.Group();this.scene.add(group);
    const profile=[[.06,-.16],[.56,-.20],[.87,-.09],[.98,.03],[.84,.18],[.5,.25],[.23,.29]].map(([x,y])=>new THREE.Vector2(x,y));
    const hull=new THREE.LatheGeometry(profile,28);
    const finGeometries=[hull];
    for(const side of [-1,1]){const fin=new THREE.BoxGeometry(.21,.14,1.22);fin.translate(side*.68,.03,-.1);finGeometries.push(fin);}
    const body=new THREE.Mesh(mergeGeometries(finGeometries),new THREE.MeshStandardMaterial({color:'#81939d',metalness:.72,roughness:.35}));body.castShadow=false;group.add(body);finGeometries.forEach(g=>g.dispose());
    // Draw only fragments hidden by opaque scenery. Equal-depth visible hull
    // fragments fail this test, preserving normal materials in clear sightlines.
    const silhouette=new THREE.Mesh(body.geometry.clone(),new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.46,depthWrite:false,depthFunc:THREE.GreaterDepth}));silhouette.renderOrder=9;group.add(silhouette);

    const ring=new THREE.Mesh(new THREE.TorusGeometry(.9,.035,6,36),new THREE.MeshBasicMaterial({color:p.color}));ring.rotation.x=Math.PI/2;group.add(ring);
    const canopy=new THREE.Mesh(new THREE.SphereGeometry(.36,16,8),new THREE.MeshStandardMaterial({color:'#162639',emissive:p.color,emissiveIntensity:.20,metalness:.8,roughness:.18}));canopy.scale.set(1,.55,1.2);canopy.position.y=.29;group.add(canopy);

    const thruster=new THREE.Mesh(new THREE.ConeGeometry(.24,.65,8),new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false}));thruster.rotation.x=-Math.PI/2;thruster.position.z=-1.05;group.add(thruster);
    // Spawn-protection only — never driven by energy / combat shields.
    const spawnProtectMaterial=new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color('#c9b6ff')},strength:{value:1}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=-p.xyz;gl_Position=projectionMatrix*p;}',fragmentShader:'uniform vec3 tint;uniform float strength;varying vec3 n;varying vec3 v;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.2);gl_FragColor=vec4(tint,(.55*rim+.03)*strength);}' });
    const spawnProtect=new THREE.Mesh(new THREE.SphereGeometry(1.17,18,12),spawnProtectMaterial);spawnProtect.visible=false;group.add(spawnProtect);
    const aim=new THREE.Group();const barrel=new THREE.Mesh(new THREE.BoxGeometry(.08,.09,.95),new THREE.MeshBasicMaterial({color:p.color}));barrel.position.set(0,.34,.64);aim.add(barrel);group.add(aim);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(1.02,28),new THREE.MeshBasicMaterial({color:'#000000',transparent:true,opacity:.38,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-Y+.08;group.add(shadow);
    const ship={group,thruster,spawnProtect,spawnProtectMaterial,aim,silhouette,x:p.x,z:p.z,angle:p.angle,alive:p.alive};group.position.set(p.x,Y,p.z);this.ships.set(p.id,ship);return ship;
  }
  screenMovement(horizontal,vertical){
    const e=this.camera.matrixWorld.elements;
    const right=Math.hypot(e[0],e[2])||1,up=Math.hypot(e[4],e[6])||1;
    const x=horizontal*e[0]/right+vertical*e[4]/up,z=horizontal*e[2]/right+vertical*e[6]/up;
    const length=Math.max(1,Math.hypot(x,z));return {x:x/length,z:z/length};
  }
  aimAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        (-(clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const point = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.floor, point)) return null;
    return { x: point.x, z: point.z };
  }
  event(event){this.fx.event(event);}
  makePickup(p){
    const group=new THREE.Group();
    const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.42,1),new THREE.MeshStandardMaterial({color:'#b5fbff',emissive:'#48d9ff',emissiveIntensity:2,metalness:.3,roughness:.16}));group.add(core);
    for(const radius of [.68,.94]){const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.025,6,32),new THREE.MeshBasicMaterial({color:'#7beaff',transparent:true,opacity:.82,blending:THREE.AdditiveBlending,depthWrite:false}));ring.rotation.x=Math.PI/2;group.add(ring);}
    group.position.set(p.x,.72,p.z);this.scene.add(group);const pickup={group,x:p.x,z:p.z};this.pickups.set(p.id,pickup);return pickup;
  }
  drawPickups(pickups=[]){
    const present=new Set();for(const p of pickups){present.add(p.id);const pickup=this.pickups.get(p.id)||this.makePickup(p);pickup.group.visible=Boolean(p.available);pickup.group.position.y=.72+Math.sin(this.frameTime*2+p.x)*.12;pickup.group.rotation.y=this.frameTime*.9;}
    for(const[id,pickup]of this.pickups)if(!present.has(id)){this.scene.remove(pickup.group);this.dispose(pickup.group);this.pickups.delete(id);}
  }
  draw(state,playerId,predicted,aim,weapon,dt,lobby=false){
    // Freeze idle bob/spin under prefers-reduced-motion; combat effects and
    // user-driven motion still play.
    if(!this.reduceMotion)this.frameTime+=dt;
    const worldOnly=this.showcaseModule==='world';this.world.setShowcase?.(this.showcaseModule||'arena');
    const rendered=[], present=new Set();
    for(const serverPlayer of state.players){
      const p=serverPlayer.id===playerId&&predicted?predicted:serverPlayer;present.add(p.id);
      const ship=this.ships.get(p.id)||this.makeShip(p);const snap=ship.alive!==p.alive||Math.hypot(p.x-ship.x,p.z-ship.z)>8;
      const blend=snap?1:1-Math.exp(-(p.id===playerId?25:20)*dt);ship.x+=(p.x-ship.x)*blend;ship.z+=(p.z-ship.z)*blend;ship.angle+=angleDiff(p.angle,ship.angle)*blend;ship.alive=p.alive;
      ship.group.visible=p.alive&&!worldOnly;ship.group.position.set(ship.x,Y+Math.sin(this.frameTime*3+p.x)*.025,ship.z);ship.group.rotation.y=ship.angle;
      ship.aim.rotation.y=angleDiff(p.id===playerId&&aim?Math.atan2(aim.x-p.x,aim.z-p.z):p.aimAngle,ship.angle);
      ship.thruster.scale.y=.3+Math.hypot(p.vx,p.vz)/10;
      const spawnProtected=p.protectedUntil>state.time;
      ship.spawnProtect.visible=spawnProtected;
      if(spawnProtected){
        const remaining=Math.max(0,Math.min(1,(p.protectedUntil-state.time)/RULES.protection));
        ship.spawnProtectMaterial.uniforms.strength.value=.35+.65*remaining;
      }
      rendered.push({...p,x:ship.x,z:ship.z,y:Y,renderPosition:ship.group.position});
    }
    for(const[id,ship]of this.ships)if(!present.has(id)){this.scene.remove(ship.group);this.dispose(ship.group);this.ships.delete(id);}
    const ids=new Set();
    for(const p of state.projectiles){ids.add(p.id);let mesh=this.shots.get(p.id);if(!mesh){mesh=new THREE.Mesh(this.shotGeometries[p.weapon],this.shotMaterials[p.weapon]);this.shots.set(p.id,mesh);this.scene.add(mesh);}
      const grenade=p.weapon==='GRENADE';mesh.visible=!worldOnly;mesh.position.set(p.x,grenade?Y+Math.sin(Math.min(1,p.age/WEAPONS.GRENADE.life)*Math.PI)*6:Y+.25,p.z);mesh.scale.setScalar(1);mesh.rotation.y=Math.atan2(p.vx,p.vz);
    }
    for(const[id,mesh]of this.shots)if(!ids.has(id)){this.scene.remove(mesh);this.shots.delete(id);}
    this.drawPickups(state.pickups);
    this.reticle.visible=Boolean(aim&&!lobby&&!worldOnly&&predicted?.alive);this.grenadeRing.visible=this.reticle.visible&&weapon==='GRENADE';
    if(this.reticle.visible){let{x,z}=aim;if(weapon==='GRENADE'){const dx=x-predicted.x,dz=z-predicted.z,scale=Math.min(1,WEAPONS.GRENADE.range/(Math.hypot(dx,dz)||1));x=predicted.x+dx*scale;z=predicted.z+dz*scale;}this.reticle.position.set(x,.15,z);this.reticle.material.color.set(WEAPONS[weapon].color);this.grenadeRing.position.set(x,.12,z);}
    const local=rendered.find(p=>p.id===playerId);
    if(!this.cameraReady)this.rig.reset();
    this.rig.update({player:local,aim,map:this.map,dt,lobby:lobby||worldOnly,view:this.view,zoom:this.zoom,reducedMotion:this.reduceMotion});this.cameraReady=true;
    for(const ship of this.ships.values())ship.silhouette.visible=ship.alive&&!lobby&&!worldOnly&&coverOccludes(this.camera.position,ship.group.position,this.map.obstacles);
    this.world.update(this.frameTime,dt);
    if(!worldOnly)this.fx.update({...state,players:rendered},dt,this.ships);else this.fx.clear();
    this.indicatorRoot.hidden=lobby||worldOnly;
    if(!lobby&&!worldOnly)this.indicators.update({players:rendered,localId:playerId,camera:this.camera,width:this.width,height:this.height,time:state.time,aim});
    this.renderer.render(this.scene,this.camera);
  }
  dispose(root){this.resizeObserver?.disconnect();this.visualViewport?.removeEventListener('resize',this.onVisualViewportResize);root.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}});}
}
