(function(root){'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const statusLabels={ok:'정상',disconnected:'연결 끊김',error:'오류',no_paper:'용지 없음',no_permission:'권한 없음',unavailable:'사용 불가'};
 const hardware=v=>v==null||v===''||v==='unknown'?'미보유 / 미관측':statusLabels[v]||String(v);
 const badHardware=v=>['error','no_paper'].includes(v);
 const powerLabels={ac:'AC 전원',usb:'USB 급전',wireless:'무선 충전',battery:'배터리',unknown:'미확인'};
 function normalize(d,stores){const id=String(d.device_id),store=String(d.store_id??''),faults=[['QR 리더',d.qr_status],['카메라',d.camera_status],['프린터',d.printer_status]].filter(x=>badHardware(x[1])).map(([n,v])=>n+' '+hardware(v));
  const online=d.online==null||d.online===''?null:Number(d.online),level=batteryState(d.battery).level;if(level!==null&&level<20)faults.push('배터리 '+level+'%');const status=online===0?'bad':online!==1?'unknown':faults.length?'warn':'good';
  return {id,store,name:d.label||'(이름 미설정)',floor:d.floor==null?null:String(d.floor),zone:'',status,reason:status==='bad'?'서버에서 오프라인으로 판정':status==='unknown'?'연결 상태 미수집':faults.length?faults.join(' / '):'현재 수집된 장치에서 이상 보고 없음',screen:d.current_screen_label||'화면 미수집',power:powerLabels[d.power_source]||'미확인',battery:d.battery==null?'미확인':String(d.battery)+'%',seen:d.last_seen_at||'기록 없음',qr:hardware(d.qr_status),camera:hardware(d.camera_status),printer:hardware(d.printer_status),storeName:stores.find(s=>s.id===store)?.name||'지점 '+store,raw:d};
 }
 function safeImage(value){try{const u=new URL(value,'https://wow4423.github.io/manual-draft/device-manager/');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
 function position(p){if(p?.x==null||p?.y==null||p?.x===''||p?.y==='')return null;const x=Number(p.x),y=Number(p.y);return Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1&&y>=0&&y<=1?{x,y,floor:String(p.floor)}:null}
 function schedule(raw){const re=/^(?:[01]\d|2[0-3]):[0-5]\d$/;return raw&&re.test(raw.wake_time)&&re.test(raw.sleep_time)&&raw.wake_time!==raw.sleep_time?{start:raw.wake_time,end:raw.sleep_time}:null}
 function deviceList(response){if(Array.isArray(response))return response;if(response&&Array.isArray(response.items))return response.items;throw new Error('기기 목록 응답 형식을 확인할 수 없습니다.')}
 const known=v=>v!=null&&String(v).trim()!==''&&v!=='unknown';
 function versionState(d,versions){const tools=versions?.tools_latest?.available?versions.tools_latest.v:null,bridge=versions?.bridge_latest?.available?versions.bridge_latest.versionName:null;const pairs=[[d.app_build_version,tools],[d.bridge_app_version||d.app_version,bridge]];if(pairs.some(([a,b])=>known(a)&&known(b)&&String(a)!==String(b)))return 'different';return pairs.every(([a,b])=>known(a)&&known(b))?'same':'unknown'}
 function scheduleState(d,expected){const actual=schedule({wake_time:d.display_wake_time,sleep_time:d.display_sleep_time});if(!actual||!expected||!known(d.display_schedule_timezone))return 'unknown';return actual.start===expected.start&&actual.end===expected.end&&d.display_schedule_timezone==='Asia/Seoul'?'same':'different'}
 function batteryState(value){const n=value==null||value===''?NaN:Number(value);if(!Number.isFinite(n)||n<0||n>100)return {level:null,color:'unknown',label:'미수집'};return {level:n,color:n===0?'empty':n<20?'low':n<80?'medium':'high',label:n+'%'}}
 const api={badHardware,esc,normalize,safeImage,position,schedule,deviceList,versionState,scheduleState,batteryState};if(typeof module==='object')module.exports=api;else root.LiveModel=api;
})(typeof window==='undefined'?globalThis:window);
