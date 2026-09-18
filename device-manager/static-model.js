'use strict';
// Presentation-only gate. No network authentication or protected data.
window.StaticDemo=(()=>{
 const key='nexus-public-concept-session-v1',ttl=86400000;
 const stores=[['3','동탄'],['4','하남'],['1','영등포'],['2','경주']].map(([store_id,name])=>({store_id,store_name:'주렁주렁 '+name+'점',status:'ACTIVE'}));
 const fail=(message,status=401)=>{const error=new Error(message);error.status=status;throw error};
 function session(){
  let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{fail('로그인이 필요합니다.')}
  if(!saved||saved.username!=='admin'||!Number.isFinite(saved.expiresAt)||saved.expiresAt<=Date.now()||saved.expiresAt>Date.now()+ttl){try{localStorage.removeItem(key)}catch{}fail('로그인이 필요하거나 만료되었습니다.')}
  return {user:{username:'admin',role:'ADMIN',store_id:'3',store_name:'주렁주렁 동탄점'}};
 }
 const screenCatalog=[
  '메인화면','주렁은행','쿠폰 사용/취소','쿠폰도구','여권취소',
  '[퀘스트] QR태깅 미션 (미션명 : 모험의 시작)',
  '[퀘스트] 사진촬영 미션 (미션명 : 서로 다른 3가지 깃털을 찾아줘~!)',
  '[퀘스트] QR태깅 미션 (미션명 : 밤의 동물 탐정단)',
  '[퀘스트] OX퀴즈 미션 (미션명 : 동물박사님의 퀴즈)',
  '[퀘스트] 그림퀴즈 미션 (미션명 : 내가그린 기린그림 퀴즈)',
  '미션 수동확인','주키퍼 본부','주렁맨'
 ];
 function devices(store){
  const prefix=({'3':'DT','4':'HN','1':'YD','2':'GJ'})[store]||'DT';
  // Each branch has a different installed mix; optional devices are not faults.
  const roster={
   '3':[0,1,2,3,4,5,6,7,8,9,10,11,12],
   '4':[0,5,8,9,4,7,10,6,3],
   '1':[7,8,0,1,9,4,5,6,10,11,12],
   '2':[5,8,9,7,0,6]
  };
  const ids=['demo-otter','demo-photo','demo-lab','demo-garden','demo-penguin','demo-tools','demo-bank','demo-entry','demo-qr-only','demo-camera-ready','demo-low-charge','demo-idle','demo-signal'];
  // floor, online, battery, source, QR, camera, printer, screen
  const cases=[
   [4,1,83,'ac','ok','ok','disconnected','OX 퀴즈'],
   [4,1,48,'battery','ok','error','ok','사진 촬영'],
   [4,0,12,'battery','ok','ok','disconnected','그림 퀴즈'],
   [5,0,0,'battery','disconnected','disconnected','disconnected','서비스 메뉴'],
   [5,1,67,'ac','ok','disconnected','no_paper','사진 출력'],
   [4,1,100,'ac','disconnected','disconnected','disconnected','서비스 메뉴'],
   [5,1,19,'battery','ok','disconnected','disconnected','주렁은행'],
   [4,1,96,'battery','ok','disconnected','disconnected','입장 확인'],
   [4,1,92,'battery','ok','disconnected','disconnected','QR 미션'],
   [5,1,76,'battery','ok','ok','disconnected','사진 촬영'],
   [5,1,8,'usb','ok','disconnected','disconnected','쿠폰 사용 / 취소'],
   [4,0,0,'battery','disconnected','disconnected','disconnected','입장 확인'],
   [5,1,null,'unknown','unknown','unknown','unknown','주키퍼 본부']
  ];
  return (roster[store]||[]).map((caseIndex,i)=>{
   const [floor,online,battery,power_source,qr_status,camera_status,printer_status]=cases[caseIndex];
   const screenMix={
    '3':[8,6,9,0,3,0,1,10,5,7,2,4,11],
    '4':[9,12,7,6,3,4,2,1,0],
    '1':[10,5,8,6,9,3,0,1,2,4,11],
    '2':[12,7,6,4,8,1]
   };
   const current_screen_label=screenCatalog[screenMix[store][i]];
   return {first_seen_at:new Date(Date.UTC(2026,7,1)+(i*2+Number(store))*86400000).toISOString(),device_id:store==='3'?ids[caseIndex]:prefix+'-'+(i+1),label:prefix+'태블릿'+String(i+1).padStart(2,'0'),store_id:store,floor:store==='3'?floor:1,status:'active',online,battery,power_source,charging:['ac','usb'].includes(power_source)&&battery<100,qr_status,camera_status,printer_status,current_screen_label,last_seen_at:new Date(Date.now()-(online?10000+i*1000:caseIndex===11?1800000:480000)).toISOString(),app:'tools',app_version:caseIndex===11?'1.1.20':'1.1.21',bridge_app_version:caseIndex===11?'1.1.20':'1.1.21',app_build_version:caseIndex===12?null:'1789366191',display_wake_time:({'3':'07:00','4':'09:00','1':'09:30','2':'10:00'})[store],display_sleep_time:({'3':'22:00','4':'21:00','1':'20:30','2':'20:00'})[store],display_schedule_timezone:'Asia/Seoul',_demo:true,_demo_case:caseIndex};
  });
 }

 // Session-in-memory presentation. Refresh restores the initial pending roster.
 let enrollmentMemory=null;
 const lifecycleLog=[];let lifecycleSerial=0;
 function logLifecycle(record,action){const title={approve:'기기 승인 / 모니터링 시작',retire:'기기 삭제 / 모니터링 제외',restore:'기기 복구 / 모니터링 재개'}[action];lifecycleLog.push({id:-8000000000000000+(++lifecycleSerial),stamp:Date.now(),deviceId:record.id,name:record.label,store:record.store_id,type:'lifecycle',tone:action==='retire'?'neutral':'good',title,lifecycleAction:action})}
 function lifecycleEvents(){session();return lifecycleLog.map(r=>({...r}));}
 function enrollmentSeed(){const now=Date.now();return [
  ['enroll-dt-01','pending','staff.dt','3','Galaxy Tab A9','1.1.21','192.168.40.31',4],
  ['enroll-dt-02','pending','staff.dt','3','Galaxy Tab A9+','1.1.20','192.168.40.32',5],
  ['enroll-hn-01','pending','staff.hn','4','Galaxy Tab A8','1.1.21','192.168.20.18',null],
  ['enroll-unknown-01','pending','staff.test',null,'Galaxy Tab S6 Lite','1.1.19','192.168.1.24',null],
  ['retired-dt-01','retired','staff.dt','3','Galaxy Tab A8','1.1.18','192.168.40.12',4],
  ['retired-gj-01','retired','staff.gj','2','Galaxy Tab A8','1.1.18','192.168.60.12',1]
 ].map(([id,status,account,suggested_store,model,bridge,ip,reported_floor],i)=>({id,status,account,suggested_store,store_id:status==='retired'?suggested_store:null,label:status==='retired'?'교체된 태블릿01':'',model,bridge,ip,reported_floor,floor:status==='retired'?reported_floor:null,first_seen:new Date(now-(i+1)*3600000).toISOString(),last_seen:new Date(now-60000*(i+1)).toISOString(),retired_at:status==='retired'?new Date(now-86400000).toISOString():null}));}
 function enrollmentRead(){
  return enrollmentMemory||(enrollmentMemory=enrollmentSeed());
 }
 function lifecycle(){session();return enrollmentRead().map(r=>({...r}));}
 function approveEnrollment(id,fields,action='approve'){
  session();const records=enrollmentRead(),record=records.find(r=>r.id===id);
  if(!record||record.status!=='pending')fail('이미 처리되었거나 찾을 수 없는 기기입니다.',409);
  const label=String(fields.label||'').trim(),store=String(fields.store_id||''),floor=fields.floor===''||fields.floor==null?null:Number(fields.floor);
  if(!label||label.length>40)fail('기기 이름을 1~40자로 입력해 주세요.',400);
  if(!stores.some(s=>s.store_id===store))fail('지점을 선택해 주세요.',400);
  if(floor!==null&&(!Number.isInteger(floor)||floor===0||floor< -5||floor>100))fail('층은 지하 5층부터 100층 사이의 정수로 입력해 주세요.',400);
  if(floor!==null&&(store==='3'?![4,5].includes(floor):floor!==1))fail(store==='3'?'동탄점 지도는 4층 또는 5층을 선택해 주세요.':'이 지점은 1층 전체 지도로 배치됩니다.',400);
  if(activeDevices(store).some(d=>d.device_id!==id&&d.label===label))fail('해당 지점에서 사용 중인 이름입니다.',409);
  const actualFloor=floor??(store==='3'?(Math.random()<.5?4:5):1),slot=Math.floor(Math.random()*4);
  const samples=[{online:1,battery:84,power_source:'ac',charging:true,camera_status:'ok',printer_status:'disconnected',current_screen_label:screenCatalog[6]},{online:1,battery:47,power_source:'battery',charging:false,camera_status:'disconnected',printer_status:'ok',current_screen_label:screenCatalog[5]},{online:1,battery:16,power_source:'battery',charging:false,camera_status:'error',printer_status:'disconnected',current_screen_label:screenCatalog[6]},{online:0,battery:0,power_source:'battery',charging:false,camera_status:'disconnected',printer_status:'disconnected',current_screen_label:screenCatalog[0]}];
  const anchors=store==='3'?(actualFloor===5?[[.2,.48],[.39,.4],[.55,.55],[.69,.61]]:[[.2,.43],[.4,.48],[.59,.39],[.64,.65]]):store==='4'?[[.24,.47],[.49,.35],[.66,.56],[.6,.72]]:store==='1'?[[.35,.51],[.56,.4],[.65,.62],[.72,.75]]:[[.22,.24],[.49,.28],[.7,.48],[.48,.72]];
  const [x,y]=anchors[Math.floor(Math.random()*anchors.length)];
  const updated={...record,status:'active',label,store_id:store,floor:actualFloor,approved_at:new Date().toISOString(),telemetry:samples[slot],placement:{x:x+(Math.random()-.5)*.04,y:y+(Math.random()-.5)*.04,floor:store==='3'?String(actualFloor):({'4':'Hanam','1':'Yeongdeungpo','2':'Gyeongju'})[store]}};
  const next=records.map(r=>r.id===id?updated:r);
  enrollmentMemory=next;
  logLifecycle(updated,action);
  return {...updated};
 }
 function enrolledDevices(store){return enrollmentRead().filter(r=>r.status==='active'&&r.store_id===store&&!r.base_device).map(r=>({device_id:r.id,label:r.label,store_id:r.store_id,status:'active',floor:r.floor,...r.telemetry,qr_status:'ok',last_seen_at:r.telemetry.online?new Date(Math.max(Date.parse(r.approved_at),Date.now()-10000)).toISOString():r.approved_at,first_seen_at:r.first_seen,app:'tools',bridge_app_version:r.bridge,login_account:r.account,device_model:r.model,app_build_version:'1789366191',display_wake_time:'07:00',display_sleep_time:'22:00',display_schedule_timezone:'Asia/Seoul',_demo:true,_enrolledAt:r.approved_at,_demo_position:r.placement}));}
 function unmovedActiveDevices(store){const retired=new Set(enrollmentRead().filter(r=>r.status==='retired').map(r=>r.id));return [...devices(store).filter(d=>!retired.has(d.device_id)),...enrolledDevices(store)];}
 function retireDevice(id,store){
  session();const records=enrollmentRead(),existing=records.find(r=>r.id===id),device=activeDevices(store).find(d=>d.device_id===id);if(!device)fail('이미 삭제되었거나 찾을 수 없는 기기입니다.',409);
  const next={...(existing||{id,label:device.label,store_id:store,suggested_store:store,account:device.login_account||'staff.'+({'3':'dt','4':'hn','1':'yd','2':'gj'})[store],bridge:device.bridge_app_version,model:device.device_model||'Galaxy Tab A9',floor:device.floor,first_seen:device.first_seen_at||device.last_seen_at,last_seen:device.last_seen_at,ip:'미수신',base_device:true}),store_id:device.store_id,floor:device.floor,placement:device._demo_position,last_device:{...device},status:'retired',retired_at:new Date().toISOString()};
  enrollmentMemory=existing?records.map(r=>r.id===id?next:r):[...records,next];logLifecycle(next,'retire');return {...next};
 }
 function restoreDevice(id){
  session();const records=enrollmentRead(),record=records.find(r=>r.id===id);if(!record||record.status!=='retired')fail('이미 복구되었거나 찾을 수 없는 기기입니다.',409);
  if(record.base_device||record.telemetry){const next={...record,status:'active',retired_at:null};enrollmentMemory=records.map(r=>r.id===id?next:r);logLifecycle(next,'restore');return {...next};}
  enrollmentMemory=records.map(r=>r.id===id?{...r,status:'pending'}:r);
  try{return approveEnrollment(id,{store_id:record.store_id,label:record.label,floor:record.floor},'restore')}catch(error){enrollmentMemory=records;throw error}
 }

 // Transfers are an in-memory overlay; telemetry and device identity are retained.
 const deviceTransfers=new Map(),deviceNames=new Map();
 function renameDevice(id,value){
  session();const device=stores.flatMap(s=>activeDevices(s.store_id)).find(d=>d.device_id===id);
  if(!device)fail('운영중인 기기를 찾을 수 없습니다.',409);
  const label=String(value??'').trim();
  if(!label||label.length>40)fail('기기 이름을 1~40자로 입력해 주세요.',400);
  if(activeDevices(device.store_id).some(d=>d.device_id!==id&&d.label===label))fail('해당 지점에서 사용 중인 이름입니다.',409);
  deviceNames.set(id,{label});
  enrollmentMemory=enrollmentRead().map(r=>r.id===id?{...r,label,last_device:r.last_device?{...r.last_device,label}:undefined}:r);
  return {...device,label};
 }
 function activeDevices(store){
  return stores.flatMap(s=>unmovedActiveDevices(s.store_id)).map(device=>({...device,...(deviceTransfers.get(device.device_id)||{}),...(deviceNames.get(device.device_id)||{})})).filter(device=>device.store_id===store);
 }
 function transferDevice(id,fields={}){
  session();const device=stores.flatMap(s=>activeDevices(s.store_id)).find(d=>d.device_id===id);
  if(!device)fail('운영중인 기기를 찾을 수 없습니다.',409);
  const target=String(fields.store_id||''),floor=Number(fields.floor);
  if(fields.from_store!==device.store_id)fail('기기 지점이 변경되었습니다. 다시 확인해 주세요.',409);
  if(!stores.some(s=>s.store_id===target))fail('변경할 지점을 선택해 주세요.',400);
  if(target===device.store_id)fail('현재 지점과 다른 지점을 선택해 주세요.',400);
  if(!Number.isInteger(floor)||(target==='3'?![4,5].includes(floor):floor!==1))fail('선택한 지점의 층을 확인해 주세요.',400);
  if(activeDevices(target).some(d=>d.device_id!==id&&d.label===device.label))fail('이동할 지점에 같은 이름의 기기가 있습니다.',409);
  const anchors=target==='3'?(floor===5?[[.2,.48],[.39,.4],[.55,.55],[.69,.61]]:[[.2,.43],[.4,.48],[.59,.39],[.64,.65]]):target==='4'?[[.24,.47],[.49,.35],[.66,.56],[.6,.72]]:target==='1'?[[.35,.51],[.56,.4],[.65,.62],[.72,.75]]:[[.22,.24],[.49,.28],[.7,.48],[.48,.72]];
  const [x,y]=anchors[Math.floor(Math.random()*anchors.length)],at=new Date().toISOString();
  const patch={store_id:target,floor,_movedAt:at,_demo_position:{x:x+(Math.random()-.5)*.03,y:y+(Math.random()-.5)*.03,floor:target==='3'?String(floor):({'4':'Hanam','1':'Yeongdeungpo','2':'Gyeongju'})[target]}};
  deviceTransfers.set(id,patch);
  const branchName=store=>stores.find(s=>s.store_id===store).store_name.replace(/^주렁주렁\s*/,'');
  for(const store of [device.store_id,target])lifecycleLog.push({id:-8000000000000000+(++lifecycleSerial),stamp:Date.now(),deviceId:id,name:device.label,store,type:'lifecycle',tone:'neutral',title:'지점 변경 / '+branchName(device.store_id)+' → '+branchName(target),lifecycleAction:'transfer',fromStore:device.store_id,toStore:target});
  return {...device,...patch};
 }

 async function request(route,options={}){
  const url=new URL(route,'https://static.invalid');
  if(url.pathname==='/session/login'){
   let data;try{data=JSON.parse(options.body)}catch{fail('아이디와 비밀번호를 확인해 주세요.')}
   if(data.username!=='admin'||data.password!=='wnfjdwnfjd2026')fail('아이디 또는 비밀번호가 올바르지 않습니다.');
   try{localStorage.setItem(key,JSON.stringify({username:'admin',expiresAt:Date.now()+ttl}))}catch{fail('브라우저 저장소를 사용할 수 없습니다. 사이트 저장 권한을 확인해 주세요.',400)}
   return session();
  }
  if(url.pathname==='/session/logout'){try{localStorage.removeItem(key)}catch{fail('브라우저 로그인 정보를 지우지 못했습니다.',400)}return {success:true}}
  const current=session();if(url.pathname==='/session')return current;
  if(url.pathname==='/read/stores')return {stores,total:stores.length};
  if(url.pathname==='/read/devices'){const store=url.searchParams.get('store_id');if(!stores.some(s=>s.store_id===store))fail('지점을 찾을 수 없습니다.',404);const items=activeDevices(store);return {items,counts:{active:items.length,pending:0,retired:0}}}
  if(url.pathname==='/read/versions')return {tools_latest:{available:true,v:1789366191},bridge_latest:{versionName:'1.1.21'}};
  if(url.pathname==='/read/schedule'){const hours={'3':['07:00','22:00'],'4':['09:00','21:00'],'1':['09:30','20:30'],'2':['10:00','20:00']}[url.searchParams.get('store_id')||'3'];if(!hours)throw Object.assign(new Error('지점을 확인해 주세요.'),{status:400});return {wake_time:hours[0],sleep_time:hours[1],timezone:'Asia/Seoul'}};
  if(['/read/maps','/read/positions','/read/history'].includes(url.pathname))return [];
  fail('지원하지 않는 기능입니다.',404);
 }
 return {fleetDevices:()=>{session();return ['3','4','1','2'].flatMap(activeDevices)},renameDevice,transferDevice,request,standalone:true,lifecycle,approveEnrollment,retireDevice,restoreDevice,lifecycleEvents};
})();

// Deterministic local demo history: the same branch/day always has the same events.
window.DemoEventStore=(()=>{
 const prefix='nexus-demo-events-v2:',memory=new Map(),dayMs=86400000;
 const dayKey=stamp=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
 const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*dayMs).toISOString().slice(0,10);
 function hash(text){let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0}
 function load(store){
  if(memory.has(store))return memory.get(store);
  let value={version:2,days:{}};
  try{const raw=localStorage.getItem(prefix+store);if(raw&&raw.length<1500000){const saved=JSON.parse(raw);if(saved?.version===2&&saved.days&&typeof saved.days==='object')value=saved}}catch{}
  memory.set(store,value);return value;
 }
 function events(store,day,now,make,plans=[]){
  const today=dayKey(now),first=shift(today,-7);if(!store||day<first||day>today)return [];
  const data=load(String(store));let changed=false;data.scenarios=data.scenarios||{};for(const key of Object.keys(data.scenarios))if(key<first||key>today){delete data.scenarios[key];changed=true}
  for(const key of Object.keys(data.days))if(key<first||key>today){delete data.days[key];changed=true}
  const midnight=Date.parse(day+'T00:00:00+09:00'),seed=hash(store+':'+day),rows=[];
  // Low-volume overnight checks, then irregular daytime activity. No future events.
  const minutes=[7,187,367,527,...Array.from({length:108},(_,i)=>540+i*7+(hash(seed+':'+i)%180)/60),1325,1385];
  for(let i=0;i<minutes.length;i++){
   const stamp=midnight+Math.floor(minutes[i]*60000);if(stamp>now)continue;
   const row=make((i+seed%15)%15,stamp,stamp);if(row)rows.push(row);
  }
  if(plans.length&&!Array.isArray(data.scenarios[day])){
   const end=Math.min(now,midnight+23*3600000),span=Math.min(28*60000,Math.max(0,end-midnight));
   data.scenarios[day]=plans.flatMap((p,i)=>{
    const stamp=Math.floor(end-span+(i+1)*span/(plans.length+1));
    const resolvedAt=Math.min(end,stamp+Math.min(3*60000,span/(plans.length+1)/2));
    return [{id:-(stamp+i*2+1),stamp,type:p.type,tone:'bad',title:p.title,name:p.name,deviceId:p.deviceId,resolvedAt,before:p.before,after:p.after},
    {id:-(resolvedAt+i*2+2),stamp:resolvedAt,type:p.type,tone:'good',title:p.recoveryTitle,name:p.name,deviceId:p.deviceId,recoveryOf:-(stamp+i*2+1)}];
   });changed=true;
  }
  for(const row of data.scenarios[day]||[])if(row.stamp<=now)rows.push(row);
  rows.sort((a,b)=>b.stamp-a.stamp);
  // Saved rows survive reopen; canonical generation also fills time spent away.
  const existing=Array.isArray(data.days[day])?data.days[day]:[];
  const known=new Map(existing.filter(r=>r&&Number.isFinite(r.stamp)&&r.stamp>=midnight&&r.stamp<midnight+dayMs&&r.stamp<=now&&typeof r.deviceId==='string'&&typeof r.title==='string'&&typeof r.name==='string').map(r=>[r.id,r]));
  const merged=rows.map(r=>known.get(r.id)||r);
  if(JSON.stringify(existing)!==JSON.stringify(merged)){data.days[day]=merged;changed=true}
  if(changed)try{localStorage.setItem(prefix+store,JSON.stringify(data))}catch{}
  return merged;
 }
 return {events};
})();
