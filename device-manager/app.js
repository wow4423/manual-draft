'use strict';
const $=id=>document.getElementById(id),{esc:E,normalize,safeImage,position,schedule:parseSchedule}=LiveModel;
const labels={good:'이상 없음',warn:'주의',bad:'오프라인',unknown:'미확인'};
let fleetLifecycle='active';
let stateSnapshotAt=null;
const branchSchedules=new Map();
let devices=[],stores=[],maps=[],positions=[],versions=null,user=null,appliedSchedule=null,serverSchedule=null;
let state={store:'',floor:null,view:'overview',filter:'all',query:''},returnFocus=null,mapSequence=0,detailSequence=0,localScheduleChanged=false;
let opsSelection=null,opsQueue='attention',opsQuery='',opsHistorySequence=0,opsRefreshSequence=0,opsRefreshing=false;
let opsStatus=null;
let opsInsight=null,lifecycleCounts={},currentStore=null;
let incidentSelection=null;
let storeSequence=0,storeLoading=false,mapLoadError='';
let pinPopoverId=null;
let demoEnabled=true;
const markupCache=new WeakMap();
function setMarkup(el,html){if(markupCache.get(el)!==html){
 const chartNodes=[...el.querySelectorAll('#connectionChart,#activityMiniChart,#hardwareChart,#activityChart')],hardware=null;
 el.innerHTML=html;
 for(const node of chartNodes){const replacement=el.querySelector('#'+node.id);if(replacement)replacement.replaceWith(node)}
 if(hardware)el.append(hardware);
 markupCache.set(el,html);
}}
const storeName=()=>stores.find(s=>s.id===state.store)?.name||'지점';
const isDongtan=()=>/동탄/.test(storeName());
const localPlanKey=()=>[['하남','Hanam'],['영등포','Yeongdeungpo'],['경주','Gyeongju']].find(([name])=>storeName().includes(name))?.[1]||null;
const incidentRules=[
 {id:'battery',name:'전원 확인',tone:'warn',matches:d=>Number(d.raw.online)===1&&LiveModel.batteryState(d.raw.battery).level!==null&&LiveModel.batteryState(d.raw.battery).level<20,action:'충전기와 잔량 확인',steps:['충전기 연결 확인','배터리 잔량 재수신 확인']},
 {id:'connection',name:'기기 연결 끊김',tone:'bad',matches:d=>Number(d.raw.online)===0,action:'현장 전원과 네트워크 확인',steps:['현장에 전원 네트워크 상태 확인 요청','앱 실행 상태 확인','최근 수신 시각 갱신 확인']},
 {id:'printer',name:'프린터 이상',tone:'warn',matches:d=>Number(d.raw.online)===1&&LiveModel.badHardware(d.raw.printer_status),action:'용지 USB 연결 확인',steps:['오류 상태에 따라 용지 USB 전원 확인','현장 테스트 출력 요청','정상 상태 수신 확인']},
 {id:'camera',name:'카메라 이상',tone:'warn',matches:d=>Number(d.raw.online)===1&&LiveModel.badHardware(d.raw.camera_status),action:'카메라 권한과 연결 확인',steps:['앱 카메라 권한 확인','카메라 연결과 촬영 화면 확인','테스트 촬영 후 정상 상태 수신 확인']},
 {id:'qr',name:'QR 리더 이상',tone:'warn',matches:d=>Number(d.raw.online)===1&&LiveModel.badHardware(d.raw.qr_status),action:'리더 연결과 스캔 확인',steps:['리더 전원 연결 확인','현장 테스트 스캔 요청','정상 상태 수신 확인']},
 {id:'unknown',name:'연결 상태 미수집',tone:'unknown',matches:d=>d.status==='unknown',action:'앱 실행과 상태 수신 확인',steps:['운영 앱 실행 여부 확인','상태 전송 여부 확인','최근 수신 시각 확인']}
];
function currentIncidents(){const list=selected().filter(isOperating);return incidentRules.map(rule=>({...rule,affected:list.filter(rule.matches)})).filter(item=>item.affected.length).sort((a,b)=>(a.id==='connection'?-1:b.id==='connection'?1:b.affected.length-a.affected.length))}
let persistentPauseAt=null;
let alarmEntries=[],alarmSerial=0,alarmPaused=false,alarmTab='events',alarmStore='';
function locateAlarm(entry,open=false){
 const list=selected().filter(isOperating),index=list.findIndex(d=>d.id===entry?.deviceId);if(index<0){const moved=window.StaticDemo?.fleetDevices?.().find(d=>d.device_id===entry?.deviceId&&String(d.store_id)!==state.store);if(open&&moved){switchStore(String(moved.store_id)).then(()=>locateAlarm(entry,true));return false}if(open&&window.StaticDemo?.lifecycle&&lifecycleRecords().some(r=>r.id===entry?.deviceId&&r.status==='retired'))showLifecycleAction(entry.deviceId,'restore');return false;}
 const d=list[index],branch=localPlanKey(),placement=branch?branchPlacement(d,index,branch):isDongtan()?mapPlacement(d,index):position(positions.find(p=>p.device_id===d.id));
 if(!placement){if(open)selectFlowDevice(d.id);return false}
 closePinPopover(false);mapMode='plan';state.floor=String(placement.floor);renderMap();
 const pin=[...$('pins').querySelectorAll('.map-pin')].find(p=>p.dataset.case===d.id);
 document.querySelectorAll('.alarm-entry.is-located').forEach(n=>n.classList.remove('is-located'));
 document.querySelectorAll('.map-pin.alarm-focused').forEach(n=>n.classList.remove('alarm-focused'));
 if(!pin){if(open)selectFlowDevice(d.id);return false}
 locatedEventId=entry.id??null;
 pin.classList.add('alarm-focused');
 [...document.querySelectorAll('.alarm-entry')].find(n=>Number(n.dataset.alarm)===entry.id)?.classList.add('is-located');
 if(open){opsSelection=d.id;openPinPopover(d.id,entry.id??null)}return true;
}
let locatedEventId=null;
function clearAlarmFocus(){
 locatedEventId=null;
 document.querySelectorAll('.map-pin.alarm-focused').forEach(pin=>{if(opsSelection===pin.dataset.case)opsSelection=null;pin.classList.remove('alarm-focused','selected')});
 document.querySelectorAll('.alarm-entry.is-located').forEach(row=>row.classList.remove('is-located'));
}
function createDeviceEvent(index,stamp,id,pool=selected()){
 const list=pool.filter(d=>isOperating(d)&&!d.raw._enrolledAt&&!d.raw._movedAt);if(!list.length)return;
 // Concept events describe a transition, never repeated current fault snapshots.
 const sequence=[
  ['demo-photo','외부 카메라 연결','good','camera'],
  ['demo-garden','충전 시작','good','power'],
  ['demo-photo','외부 카메라 연결 해제','neutral','camera'],
  ['demo-otter','화면 변경 / 사진 촬영','neutral','screen'],
  ['demo-penguin','프린터 연결','good','printer'],
  ['demo-lab','기기 연결 끊김','warn','connection'],
  ['demo-lab','기기 재접속','good','connection'],
  ['demo-garden','충전 종료','neutral','power'],
  ['demo-penguin','프린터 연결 해제','neutral','printer'],
  ['demo-otter','화면 변경 / 서비스 메뉴','neutral','screen'],
 ['demo-qr-only','QR \uC785\uB825 \uC218\uC2E0','good','qr'],
 ['demo-camera-ready','\uCE74\uBA54\uB77C \uC5F0\uACB0','good','camera'],
 ['demo-low-charge','\uCDA9\uC804 \uC2DC\uC791','good','power'],
 ['demo-idle','\uAE30\uAE30 \uC5F0\uACB0 \uB04A\uAE40','warn','connection'],
 ['demo-signal','\uAE30\uAE30 \uC0C1\uD0DC \uC218\uC2E0','neutral','screen']
 ];
 const [deviceId,title,tone,type]=sequence[index%sequence.length],d=list.find(d=>d.id===deviceId)||list[index%list.length];
 return {id,stamp,type,tone,title,name:d.name,deviceId:d.id};
}
function appendAlarm(initial=false){
 const entry=createDeviceEvent(alarmSerial,Math.max(Date.parse(eventToday+'T00:00:00+09:00'),Date.now()-(initial?(7-alarmSerial)*45000:0)),alarmSerial+1);if(!entry)return;
 alarmSerial++;alarmEntries.unshift(entry);alarmEntries=alarmEntries.slice(0,40);
}
const eventDayMs=86400000;
function eventDateKey(now=Date.now()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))}
function shiftEventDate(day,offset){return new Date(Date.parse(day+'T12:00:00Z')+offset*eventDayMs).toISOString().slice(0,10)}
let eventToday=eventDateKey(),eventFirstDay=shiftEventDate(eventToday,-7);
function syncEventDate(){const today=eventDateKey();if(today===eventToday)return false;const age=Math.round((Date.parse(eventDay+'T12:00:00Z')-Date.parse(eventToday+'T12:00:00Z'))/eventDayMs);persistentPauseAt=null;eventToday=today;eventFirstDay=shiftEventDate(today,-7);eventDay=shiftEventDate(today,Math.max(-7,Math.min(0,age)));eventArchives.clear();alarmStore='';alarmEntries=[];alarmSerial=0;return true}
function eventCalendarGrid(){
 const monthStart=eventToday.slice(0,7)+'-01',start=monthStart<eventFirstDay?monthStart:eventFirstDay;
 const from=shiftEventDate(start,-new Date(start+'T12:00:00Z').getUTCDay());
 const nextMonth=new Date(eventToday+'T12:00:00Z');nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1,1);
 const end=shiftEventDate(nextMonth.toISOString().slice(0,10),-1),to=shiftEventDate(end,6-new Date(end+'T12:00:00Z').getUTCDay());
 const count=Math.round((Date.parse(to)-Date.parse(from))/eventDayMs)+1;
 return Array.from({length:count},(_,i)=>{const value=shiftEventDate(from,i),allowed=value>=eventFirstDay&&value<=eventToday;return '<button data-event-day="'+value+'"'+(allowed?'':' disabled')+' aria-label="'+value+'" aria-pressed="'+(value===eventDay)+'" class="'+(value===eventDay?'selected ':'')+(value===eventToday?'today':'')+'">'+Number(value.slice(-2))+'</button>'}).join('');
}
let eventDay=eventToday,eventCalendarOpen=false;
const eventArchives=new Map();
function resolvedEventPlans(pool=selected()){
 const list=pool.filter(d=>Number(d.raw.online)===1&&!d.raw._enrolledAt&&!d.raw._movedAt),plans=[];
 const add=(d,type,title,before,after,recoveryTitle)=>{if(d)plans.push({deviceId:d.id,name:d.name,type,title,before,after,recoveryTitle})};
 add(list.find(d=>isCharging(d.raw)&&Number(d.raw.battery)>0&&Number(d.raw.battery)<20)||list.find(d=>isCharging(d.raw)&&Number(d.raw.battery)<100),'power','전원 꺼짐','전원 꺼짐','충전 중','전원 연결 / 충전 재개');
 add(list.find(d=>d.raw._demo_case===8)||list.find(d=>d.raw.qr_status==='ok'),'connection','장시간 응답 없음','12분간 미응답','연결 복구','기기 재접속 / 수신 재개');
 add(list.find(d=>d.raw.printer_status==='ok'),'printer','프린터 출력 실패','출력 실패','정상 출력 확인','프린터 정상 출력 확인');
 add(list.find(d=>d.raw._demo_case===9)||list.find(d=>d.raw.camera_status==='ok'),'camera','카메라 촬영 불가','촬영 불가','촬영 정상','카메라 영상 수신 / 촬영 복구');
 return plans;
}

function displayedEvents(){
 if(window.StaticDemo?.standalone&&window.DemoEventStore)return [...window.DemoEventStore.events(state.store,eventDay,persistentPauseAt??Date.now(),createDeviceEvent,resolvedEventPlans()),...enrollmentEvents()].sort((a,b)=>b.stamp-a.stamp);
 if(eventDay===eventToday)return alarmEntries;
 const key=state.store+':'+eventDay;
 if(!eventArchives.has(key)){
  const midnight=Date.parse(eventDay+'T00:00:00+09:00'),dayNumber=Math.round((Date.parse(eventToday+'T12:00:00Z')-Date.parse(eventDay+'T12:00:00Z'))/eventDayMs);
  const rows=Array.from({length:36},(_,i)=>createDeviceEvent(i,midnight+(7+i*40)*60000+dayNumber*1000,-(dayNumber*1000+i+1))).filter(Boolean).reverse();
  eventArchives.set(key,rows);
 }
 return eventArchives.get(key);
}
function eventDateControl(){
 const monthLabel=eventFirstDay.slice(0,7)===eventToday.slice(0,7)?eventToday.slice(0,7).replace('-',' / '):eventFirstDay.slice(0,7).replace('-',' / ')+' / '+eventToday.slice(0,7).replace('-',' / ');
 const label=eventDay.slice(5).replace('-','.')+(eventDay===eventToday?' 오늘':'');
 return '<div class="event-date-picker"><button id="eventDateToggle" aria-expanded="'+eventCalendarOpen+'" aria-controls="eventCalendar" aria-label="이벤트 날짜 선택"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2v4M14 2v4M3 8h14"/></svg><span>'+label+'</span><svg class="date-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><section id="eventCalendar" class="event-calendar" aria-label="'+monthLabel+'"'+(eventCalendarOpen?'':' hidden')+'><header><strong>'+monthLabel+'</strong><button data-event-day="'+eventToday+'">오늘</button></header><div class="event-weekdays">'+['일','월','화','수','목','금','토'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="event-calendar-grid">'+eventCalendarGrid()+'</div><footer>'+eventFirstDay.slice(5).replace('-','.')+' ~ '+eventToday.slice(5).replace('-','.')+'</footer></section></div>';
}
function closeEventCalendar(restoreFocus=false){eventCalendarOpen=false;renderAlarmFeed();if(restoreFocus)$('eventDateToggle')?.focus()}
document.addEventListener('click',event=>{
 const toggle=event.target.closest('#eventDateToggle');if(toggle){eventCalendarOpen=!eventCalendarOpen;renderAlarmFeed();if(eventCalendarOpen)$('eventCalendar').querySelector('.selected')?.focus();return}
 const day=event.target.closest('[data-event-day]');if(day){const value=day.dataset.eventDay;if(day.disabled||value<eventFirstDay||value>eventToday||!/^\d{4}-\d{2}-\d{2}$/.test(value))return;eventDay=value;closePinPopover(false);closeEventCalendar(true);const stream=document.querySelector('.alarm-stream');if(stream)stream.scrollTop=0;return}
 if(eventCalendarOpen&&!event.target.closest('.event-date-picker'))closeEventCalendar();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&eventCalendarOpen){event.preventDefault();closeEventCalendar(true)}});

// Local presentation examples only; no Telegram connection or delivery.
let openingNoticeDismissed=false,openingNoticeExpanded=false;
function exampleEventTime(stamp){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(stamp))}
function deviceExample(d){
 const index=Math.max(0,selected().findIndex(x=>x.id===d.id));
 const caseId=d.raw._demo_case,photo=Number.isInteger(caseId)?caseId===1:d.id==='demo-photo'||/02$/.test(d.name),printer=Number.isInteger(caseId)?caseId===4:d.id==='demo-penguin'||/05$/.test(d.name);
 const offline=Number(d.raw.online)!==1,unused=Number.isInteger(caseId)?[3,5].includes(caseId):/04$|06$/.test(d.name);
 return {photo,printer,unused,offline,state:unused?'none':offline?'unknown':photo?'waiting':'applied',expected:'v24',applied:photo||offline?'v23':'v24',changed:Date.now()-18*60000,reported:Date.now()-(offline?12:2)*60000,index};
}
function deviceExampleLinks(d){
 const x=deviceExample(d),label={none:'설정 대상 없음',unknown:'수신 대기',waiting:'반영 대기',applied:'적용 완료'}[x.state];
 return '<div class="example-check-links"><button data-device-example="config" data-example-device="'+E(d.id)+'"><span>CRM 설정</span><b class="'+x.state+'">'+label+' <i>↗</i></b></button><button data-device-example="operation" data-example-device="'+E(d.id)+'"><span>장치 동작 확인</span><b class="'+(x.photo||x.printer?'waiting':'')+'">'+(x.unused?'미사용':x.offline?'마지막 기록':x.photo?'촬영 실패':x.printer?'출력 실패':'최근 동작 정상')+' <i>↗</i></b></button></div>';
}
function openDeviceExample(id,kind){
 const d=selected().find(x=>x.id===id);if(!d)return;
 const x=deviceExample(d);let modal=$('deviceExample');if(!modal){modal=document.createElement('dialog');modal.id='deviceExample';modal.className='device-example-modal';modal.setAttribute('aria-label','설정 및 장치 동작 확인');document.body.append(modal)}
 const head='<header><div><span>'+E(d.name)+'</span><h2>'+(kind==='config'?'CRM 설정 반영':'연결과 실제 동작')+'</h2></div><button data-close-example aria-label="닫기">×</button></header>';
 let body='';
 if(kind==='config'){
  body=x.unused?'<p class="example-note">이 기기는 서비스 메뉴를 사용하고 있어 적용할 미션 설정이 없습니다.</p>':'<div class="config-comparison"><section><span>CRM 최신 설정</span><strong>'+x.expected+'</strong><small>'+exampleEventTime(x.changed)+' 변경</small></section><span class="config-direction">→</span><section><span>태블릿 적용 보고</span><strong class="'+x.state+'">'+x.applied+'</strong><small>'+exampleEventTime(x.reported)+' 마지막 보고</small></section></div><div class="config-result '+x.state+'"><b>'+(x.offline?'최신 적용 여부 미확인':x.photo?'새 설정 반영 대기':'최신 설정 적용 완료')+'</b><p>'+(x.offline?'기기 응답이 없어 마지막으로 보고한 버전을 표시합니다.':x.photo?'CRM은 v24로 변경됐지만 이 기기는 v23 사용을 보고했습니다.':'CRM 버전과 태블릿이 적용 완료를 보고한 버전이 같습니다.')+'</p></div>';
 }else{
  const name=x.photo?'외부 카메라':x.printer?'프린터':'QR 리더';
  body=x.unused?'<p class="example-note">주변장치를 사용하지 않는 기기입니다. 미연결을 이상으로 판단하지 않습니다.</p>':'<div class="operation-device"><strong>'+name+'</strong><span>'+(x.offline?'마지막 수신 기준':'연결 감지됨')+'</span></div><ol class="operation-evidence"><li><i></i><div><span>연결 확인</span><strong>USB 장치 감지</strong><time>'+exampleEventTime(x.reported-5000)+'</time></div></li><li class="'+(x.photo||x.printer?'failed':'')+'"><i></i><div><span>실제 동작 결과</span><strong>'+(x.photo?'촬영 실패':x.printer?'출력 전송 실패':'QR 입력 수신 성공')+'</strong><time>'+exampleEventTime(x.reported)+'</time></div></li></ol>';
 }
 modal.innerHTML=head+body;
 if(!modal.open)modal.showModal();modal.querySelector('[data-close-example]').focus();
}
document.addEventListener('click',e=>{const trigger=e.target.closest('[data-device-example]');if(trigger)openDeviceExample(trigger.dataset.exampleDevice,trigger.dataset.deviceExample);if(e.target.closest('[data-close-example]'))$('deviceExample')?.close();if(e.target===$('deviceExample'))$('deviceExample').close()});

function recentDeviceEvents(d){
 const rows=displayedEvents().filter(row=>row.deviceId===d.id).slice(0,5);
 const end=eventDay===eventToday?Date.now():Date.parse(eventDay+'T23:50:00+09:00');
 const start=Date.parse(eventDay+'T00:00:00+09:00');
 const before=rows.length?rows[rows.length-1].stamp:end;
 const names=['화면 정보 수신','전원 상태 수신','서비스 화면 진입','기기 상태 수신','기기 접속'];
 for(let i=0;!d.raw._enrolledAt&&!d.raw._movedAt&&rows.length<5;i++)rows.push({stamp:Math.max(start,before-(i+1)*90000),title:names[i],deviceId:d.id});
 return '<details class="pin-recent-events" data-history-device="'+E(d.id)+'"><summary><span class="recent-label">최근 이력</span><span class="recent-chevron"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span></summary><section class="recent-history-panel" aria-label="최근 이력"><header><div><strong>최근 이력</strong></div><button type="button" data-close-recent aria-label="이력 닫기">×</button></header><ol>'+rows.map(row=>'<li><time>'+exampleEventTime(row.stamp)+'</time><span>'+E(row.title)+'</span></li>').join('')+'</ol></section></details>';
}
function eventComparison(entry,rows){
 if(entry.resolvedAt)return '<span class="event-recovery-log"><span class="recovery-log-row"><time>'+exampleEventTime(entry.stamp)+'</time><span><small>문제 발생</small><b>'+E(entry.before)+'</b></span></span><span class="recovery-log-row recovered"><time>'+exampleEventTime(entry.resolvedAt)+'</time><span><small>복구</small><b>'+E(entry.after)+'</b></span></span></span>';

 // Current telemetry is an observation, not proof of a recovery transition.
 const target=rows.find(row=>row.type==='camera'&&row.tone==='neutral');
 if(!target||target.id!==entry.id)return '';
 const d=selected().find(device=>device.id===entry.deviceId);if(!d)return '';
 const value=d.raw.camera_status;
 const current=Number(d.raw.online)!==1?'수신 없음':value==='ok'?'연결됨':LiveModel.badHardware(value)?'오류 감지':value==='disconnected'?'연결 해제':'미수집';
 const observed=Date.parse(d.raw.last_seen_at);
 return '<span class="event-recovery-log event-observation-log"><span class="recovery-log-row"><time>'+exampleEventTime(entry.stamp)+'</time><span><small>이벤트 발생</small><b>연결 해제</b></span></span><span class="recovery-log-row observed"><time>'+(Number.isFinite(observed)?exampleEventTime(observed):'—')+'</time><span><small>상태 확인</small><b>'+current+'</b></span></span></span>';
}
function renderOpeningNotice(){
 let el=$('openingNotice');if(!el){el=document.createElement('aside');el.id='openingNotice';el.setAttribute('aria-label','텔레그램 오픈 점검 알림 예시');document.body.append(el)}
 el.hidden=!user||state.view!=='overview'||openingNoticeDismissed;if(el.hidden)return;
 const list=selected().filter(isOperating),offline=list.filter(d=>Number(d.raw.online)!==1),low=list.filter(d=>Number(d.raw.online)===1&&LiveModel.batteryState(d.raw.battery).level!==null&&Number(d.raw.battery)<20&&!isCharging(d.raw));
 const attention=[...new Map([...offline,...low].map(d=>[d.id,d])).values()];
 setMarkup(el,'<header><span class="telegram-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 17-7-4 16-5-5-3 3v-5l9-6-11 5Z"/></svg></span><button id="toggleOpeningNotice" aria-expanded="'+openingNoticeExpanded+'" aria-controls="openingNoticeMessage"><span class="notice-copy"><span class="notice-channel">Telegram</span><strong>'+E(storeName().replace(/^주렁주렁\s*/,''))+' 오픈 전 점검</strong><span class="notice-preview">확인이 필요한 기기 <b>'+attention.length+'대</b></span></span></button><button id="closeOpeningNotice" aria-label="알림 닫기">×</button></header><div id="openingNoticeMessage" class="telegram-message"'+(openingNoticeExpanded?'':' hidden')+'><div class="telegram-sender">NEXUS 관제 알림</div><strong>'+E(storeName())+' 오픈 전 점검</strong><p>기기 '+list.length+'대 중 '+(list.length-offline.length)+'대 응답<br>전원 / 통신 확인 '+attention.length+'대</p><div class="telegram-devices">'+attention.map(d=>'<button data-notice-device="'+E(d.id)+'"><span>'+E(d.name)+'</span><b>'+(Number(d.raw.online)!==1?'응답 없음':'배터리 '+Number(d.raw.battery)+'%')+' <span aria-hidden="true">↗</span></b></button>').join('')+'</div><footer><span>매일 09:30 자동 점검 예시</span><time>'+eventToday.slice(5).replace('-','.')+'</time></footer></div>');
}
document.addEventListener('click',event=>{
 if(event.target.closest('#openingNotice')&&!event.target.closest('#closeOpeningNotice,[data-notice-device],a,input,select,textarea'))toggleOpeningMessage();
 if(event.target.closest('#closeOpeningNotice')){openingNoticeDismissed=true;renderOpeningNotice()}
 const hit=event.target.closest('[data-notice-device]');if(hit)locateAlarm({deviceId:hit.dataset.noticeDevice},true);
});
let openingMessageMotion=null;
function toggleOpeningMessage(){
 const panel=$('openingNoticeMessage'),trigger=$('toggleOpeningNotice');if(!panel||!trigger)return;
 const from=panel.hidden?0:panel.getBoundingClientRect().height;
 if(openingMessageMotion){openingMessageMotion.onfinish=null;openingMessageMotion.cancel();openingMessageMotion=null}
 openingNoticeExpanded=!openingNoticeExpanded;trigger.setAttribute('aria-expanded',String(openingNoticeExpanded));
 const expanded=openingNoticeExpanded;
 if(!panel.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){panel.hidden=!expanded;return}
 panel.hidden=false;const to=expanded?panel.getBoundingClientRect().height:0;
 const motion=panel.animate([{height:from+'px',opacity:from?1:0},{height:to+'px',opacity:expanded?1:0}],{duration:280,easing:'cubic-bezier(.22,.7,.2,1)'});
 openingMessageMotion=motion;motion.onfinish=()=>{if(openingMessageMotion!==motion)return;panel.hidden=!expanded;openingMessageMotion=null};
}
function positionRecentHistory(){
 const popup=$('pinPopover'),panel=popup?.querySelector('.recent-history-panel'),host=document.querySelector('.map-panel');if(!panel||!host)return;
 // Layout coordinates are stable while the popup's entry transform animates.
 const width=260,gap=12,popupWidth=popup.offsetWidth||280;
 const hostWidth=host.clientWidth||host.getBoundingClientRect().right-host.getBoundingClientRect().left;
 const popupLeft=host.clientWidth?popup.offsetLeft:popup.getBoundingClientRect().left-host.getBoundingClientRect().left;
 const right=hostWidth-popupLeft-popupWidth>=width+gap,left=popupLeft>=width+gap;
 panel.classList.toggle('history-overlay',!right&&!left);
 panel.style.left=right?(popupWidth+gap)+'px':left?(-width-gap)+'px':'0px';
 panel.style.top='0px';panel.dataset.positioned='true';
}
document.addEventListener('click',event=>{
 const summary=event.target.closest('.pin-recent-events > summary');if(!summary)return;
 event.preventDefault();const details=summary.parentElement;
 if(!details.open)positionRecentHistory();
 details.open=!details.open;
});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.pin-recent-events')&&event.target.open&&event.target.isConnected&&!event.target.querySelector('.recent-history-panel')?.dataset.positioned)positionRecentHistory()},true);
document.addEventListener('click',event=>{const close=event.target.closest('[data-close-recent]');if(close){const details=close.closest('details');details.open=false;details.querySelector('summary').focus()}});


function alarmBatteryTone(id){const raw=selected().find(d=>d.id===id)?.raw;return !raw?'unknown':isCharging(raw)?'high':LiveModel.batteryState(raw.battery).color}
let alarmArrivalSnapshot=null;
function renderAlarmFeed(){
 if(!$('alarmFeed'))return;syncEventDate();
 if(alarmStore!==state.store){alarmEntries=[];alarmSerial=0;alarmStore=state.store;if(!window.StaticDemo?.standalone)for(let i=0;i<7;i++)appendAlarm(true)}
 const eventRows=displayedEvents();
 const arrivalKey=[state.store,eventDay,state.view,alarmTab].join(':');
 const previousArrival=alarmArrivalSnapshot;
 const canAnimateArrival=previousArrival?.key===arrivalKey&&state.view==='overview'&&alarmTab==='events'&&eventDay===eventToday&&!document.hidden&&!alarmPaused;
 const arrivals=canAnimateArrival?eventRows.filter(e=>!previousArrival.ids.has(String(e.id))&&e.stamp>=previousArrival.latest):[];
 const oldStream=$('alarmFeed').querySelector('.alarm-stream'),oldScroll=oldStream?.scrollTop||0;
 const anchor=oldScroll>0?[...oldStream.querySelectorAll('[data-alarm]')].find(n=>n.getBoundingClientRect().bottom>oldStream.getBoundingClientRect().top):null;
 const anchorOffset=anchor?anchor.getBoundingClientRect().top-oldStream.getBoundingClientRect().top:0;
 alarmArrivalSnapshot={key:arrivalKey,ids:new Set(eventRows.map(e=>String(e.id))),latest:Math.max(0,...eventRows.map(e=>e.stamp))};
 setMarkup($('alarmFeed'),'<div class="alarm-controls">'+eventDateControl()+'<span>'+eventRows.length+'건</span><button id="pauseAlarms"'+(eventDay===eventToday?'':' hidden')+' aria-pressed="'+alarmPaused+'" aria-label="'+(alarmPaused?'알림 재생':'알림 일시정지')+'" title="'+(alarmPaused?'재생':'일시정지')+'">'+(alarmPaused?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 19 12 8 19Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>')+'</button></div><div class="alarm-stream">'+(eventRows.length?eventRows.map((entry,i)=>'<button class="alarm-entry '+entry.tone+(entry.resolvedAt?' is-resolved':'')+(entry.id===locatedEventId?' is-located':'')+(i===0?' newest':'')+'" data-alarm="'+entry.id+'"><time>'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(entry.stamp))+'</time><div class="alarm-description"><strong>'+E(entry.title)+'</strong><span class="alarm-device battery-'+alarmBatteryTone(entry.deviceId)+'"><span>'+E(devices.find(d=>d.id===entry.deviceId)?.name||entry.name)+'</span><svg class="device-open" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></span>'+eventComparison(entry,eventRows)+'</div></button>').join(''):'<div class="desk-clear">표시할 기기 이벤트 없음</div>')+'</div>');
 const newStream=$('alarmFeed').querySelector('.alarm-stream');
 if(previousArrival?.key===arrivalKey&&newStream){const nextAnchor=anchor?[...newStream.querySelectorAll('[data-alarm]')].find(n=>n.dataset.alarm===anchor.dataset.alarm):null;newStream.scrollTop=nextAnchor?newStream.scrollTop+nextAnchor.getBoundingClientRect().top-newStream.getBoundingClientRect().top-anchorOffset:oldScroll}
 if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
  const ids=new Set(arrivals.slice(0,4).map(e=>String(e.id)));
  newStream?.querySelectorAll('[data-alarm]').forEach(row=>{if(ids.has(row.dataset.alarm)&&row.animate)row.animate([{opacity:.25,transform:'translateY(-10px)',backgroundColor:'rgba(126,191,208,.18)'},{opacity:1,transform:'translateY(0)',backgroundColor:'rgba(126,191,208,.10)',offset:.35},{opacity:1,transform:'translateY(0)',backgroundColor:'rgba(126,191,208,0)'}],{duration:1100,easing:'cubic-bezier(.22,1,.36,1)'})});
 }
 $('alarmFeed').hidden=alarmTab!=='events';document.querySelector('#responseDesk .desk-incidents').hidden=alarmTab!=='groups';
 document.querySelectorAll('[data-alarm-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.alarmTab===alarmTab);b.setAttribute('aria-selected',String(b.dataset.alarmTab===alarmTab))});
}
document.addEventListener('click',event=>{
 const tab=event.target.closest('[data-alarm-tab]');if(tab){alarmTab=tab.dataset.alarmTab;renderAlarmFeed()}
 if(event.target.closest('#pauseAlarms')){alarmPaused=!alarmPaused;persistentPauseAt=alarmPaused?Date.now():null;renderAlarmFeed()}
 const hit=event.target.closest('[data-alarm]');if(hit){const row=displayedEvents().find(e=>e.id===Number(hit.dataset.alarm));if(row)locateAlarm(row,true)}
});
function tickAlarms(){if(syncEventDate()&&user)renderAlarmFeed();if(!user||document.hidden||state.view!=='overview'||alarmPaused||storeLoading||eventDay!==eventToday||eventCalendarOpen)return;if(!window.StaticDemo?.standalone)appendAlarm();renderAlarmFeed()}
setInterval(tickAlarms,15000);

function statusGroupCards(incidents){
 const stamp=stateSnapshotAt?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(stateSnapshotAt)).replace('-','.'):'';
 const heading='<div class="status-snapshot"><span class="snapshot-dot"></span><time datetime="'+(stateSnapshotAt?new Date(stateSnapshotAt).toISOString():'')+'">'+stamp+' \uAE30\uC900</time></div>';

 if(!incidents.length)return heading+'<div class="status-clear"><span class="status-clear-dot"></span><strong>확인할 상태 없음</strong></div>';
 return heading+incidents.map(item=>'<button class="status-choice '+item.tone+'" data-incident="'+item.id+'"><span><i></i>'+E(item.name)+'</span><b>'+item.affected.length+'<small>대</small><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></b></button>').join('');
}
function renderIncidentContent(){
 const item=currentIncidents().find(x=>x.id===incidentSelection);
 if(!item){$('incidentContent').innerHTML='<div class="status-resolved">현재 해당 상태인 기기가 없습니다.</div>';return}
 const hints={connection:['기기의 전원과 네트워크 연결을 확인하세요.','앱 실행 후 마지막 수신이 갱신되는지 확인하세요.'],battery:['충전기 연결과 배터리 잔량을 확인하세요.'],printer:['용지와 USB 연결을 확인하세요.','테스트 출력으로 동작을 확인하세요.'],camera:['USB 연결과 촬영 화면을 확인하세요.'],qr:['리더 연결 후 QR을 스캔해 입력을 확인하세요.'],unknown:['앱 실행 여부와 마지막 수신을 확인하세요.']};
 const guideOpen=$('incidentContent').querySelector('.status-check-guide')?.open;
 setMarkup($('incidentContent'),'<div class="status-detail-title"><h2>'+E(item.name)+'</h2><span>'+item.affected.length+'<small>대</small></span></div><div class="status-device-list">'+item.affected.map(d=>'<button data-incident-device="'+E(d.id)+'"><span class="status-device-identity"><strong>'+E(d.name)+'</strong><small>'+floorText(d.floor)+'</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button>').join('')+'</div><details class="status-check-guide"><summary>확인할 사항<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><ul>'+(hints[item.id]||[item.action]).map(text=>'<li>'+E(text)+'</li>').join('')+'</ul></details>');
 if(guideOpen)$('incidentContent').querySelector('.status-check-guide').open=true;
}

function renderResponseDesk(){
 const incidents=currentIncidents(),affected=new Set(incidents.flatMap(item=>item.affected.map(d=>d.id))).size;
 setMarkup($('responseDesk'),'<div class="response-title"><span class="signal-orb '+(affected?'attention':'clear')+'"></span><div><small>대응 데스크</small><h2>'+(affected?'확인이 필요합니다':'수집된 이상 없음')+'</h2></div><strong>'+affected+'<small>대</small></strong></div><div class="alarm-tabs" role="tablist"><button data-alarm-tab="events" role="tab">기기 이벤트</button><button data-alarm-tab="groups" role="tab">상태별 정리</button></div><section id="alarmFeed"></section><div class="desk-incidents">'+statusGroupCards(incidents)+'</div>');
 renderDashboard();renderAlarmFeed();if($('incidentDialog').open)renderIncidentContent();
}
document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-locate-device]');if(target){const d=devices.find(x=>x.id===target.dataset.locateDevice);if(!d)return;const p=localPlacements.get(d.id);if(!p)return;for(const modal of document.querySelectorAll('dialog[open]'))modal.close();state.view='overview';state.floor=p.floor;render();openPinPopover(d.id)}
});

function needsInsight(d){if(!opsInsight)return true;if(d.raw._demo)return false;return opsInsight==='version'?LiveModel.versionState(d.raw,versions)!=='same':opsInsight==='schedule'?LiveModel.scheduleState(d.raw,serverSchedule)!=='same':d.floor==null}

let mapMode='plan';
function renderServiceFlow(){
 $('serviceFlow').hidden=mapMode!=='flow';$('floorTabs').hidden=mapMode==='flow';
 document.querySelectorAll('[data-map-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mapMode===mapMode));
 if(mapMode!=='flow')return;
 $('mapEmpty').hidden=true;
 const list=selected().filter(isOperating),groups=[...new Set(list.map(d=>d.screen))],step=list.length>1?620/(list.length-1):0,groupStep=groups.length>1?620/(groups.length-1):0;
 const colors={good:'#5bd9cf',warn:'#efbb78',bad:'#e386a6',unknown:'#788fae'};
 const cy=i=>list.length===1?420:120+i*step,gy=i=>groups.length===1?420:120+i*groupStep;
 const lines=list.map((d,i)=>{const y=cy(i),end=gy(groups.indexOf(d.screen)),highlight=opsSelection===d.id;return '<path class="service-connection '+(d.status==='bad'?'offline':'')+(highlight?' focused':'')+'" stroke="'+colors[d.status]+'" d="M330 '+y+' C480 '+y+' 465 430 650 430 S875 '+end+' 1050 '+end+'"/>'}).join('');
 const nodes=list.map((d,i)=>'<g role="button" tabindex="0" data-flow="'+E(d.id)+'" data-case="'+E(d.id)+'" class="flow-device '+(opsSelection===d.id?'selected':'')+'" aria-label="'+E(d.name)+' 진단'+'"><rect x="50" y="'+(cy(i)-28)+'" width="280" height="56" rx="7"/><circle cx="72" cy="'+cy(i)+'" r="5" fill="'+colors[d.status]+'"/><text x="91" y="'+(cy(i)+6)+'">'+E(d.name.slice(0,16))+'</text></g>').join('');
 const services=groups.map((name,i)=>'<g class="flow-service"><rect x="1050" y="'+(gy(i)-29)+'" width="300" height="58" rx="7"/><text x="1070" y="'+(gy(i)+7)+'">'+E(name.length>14?name.slice(0,14)+'…':name)+'</text><text class="flow-count" x="1324" y="'+(gy(i)+7)+'">'+list.filter(d=>d.screen===name).length+'</text><title>'+E(name)+'</title></g>').join('');
 setMarkup($('serviceFlow'),list.length?'<svg viewBox="0 0 1400 900" class="service-flow" role="group" aria-label="운영 기기와 마지막 수신 화면 연결"><defs><linearGradient id="flowHub" x2="1" y2="1"><stop stop-color="#257bd2"/><stop offset="1" stop-color="#163761"/></linearGradient><radialGradient id="flowGlow"><stop stop-color="#268ec5" stop-opacity=".27"/><stop offset="1" stop-color="#268ec5" stop-opacity="0"/></radialGradient></defs><ellipse cx="690" cy="445" rx="365" ry="360" fill="url(#flowGlow)"/><g class="flow-orbits"><ellipse cx="690" cy="440" rx="275" ry="325"/><ellipse cx="690" cy="440" rx="230" ry="275"/><ellipse cx="690" cy="760" rx="300" ry="35"/></g><text class="flow-col-label" x="50" y="55">운영 기기 / '+list.length+'</text><text class="flow-col-label" x="1050" y="55">마지막 수신 화면</text>'+lines+'<g class="flow-hub"><path d="M595 317 655 280 787 317 727 354Z" fill="#347ec5"/><path d="M727 354 787 317V497L727 534Z" fill="#174573"/><path d="M595 317 727 354V534L595 497Z" fill="url(#flowHub)"/><text x="656" y="413">'+E(storeName().replace(/^주렁주렁\s*/,''))+'</text><text x="656" y="446" class="flow-hub-small">'+list.length+' DEVICES</text><path d="M612 466 709 492" stroke="#78dbf1" stroke-width="3"/></g>'+nodes+services+'<text class="flow-bottom-label" x="700" y="845">기기 선택 → 상태 / 수신 이력</text></svg>':'<div class="empty">운영 기기 없음</div>');
 $('serviceFlow').hidden=mapMode!=='flow';$('mapCanvas').hidden=mapMode==='flow';$('floorTabs').hidden=mapMode==='flow';document.querySelectorAll('[data-map-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mapMode===mapMode));
 document.querySelector('.zone-focus').hidden=mapMode==='flow';
}
let liveSnapshot=[],localPlacements=new Map();
const demoStart=new Date().toISOString();
function isCharging(raw){return raw.charging===true||raw.is_charging===true||['ac','usb','wireless'].includes(raw.power_source)}
function chargeLabel(raw){if(!isCharging(raw))return '';const level=LiveModel.batteryState(raw.battery).level;return level===100?'충전 완료':level!==null?'충전 중':'외부 전원 연결'}
function bolt(label,cls){return '<svg class="'+cls+'" viewBox="0 0 24 24" role="img" aria-label="'+label+'"><title>'+label+'</title><path d="M13 2 4 14h7l-1 8 10-13h-7Z"/></svg>'}
function batteryGauge(value,raw={}){const b=LiveModel.batteryState(value),charging=isCharging(raw),plugged=['ac','usb','wireless'].includes(raw.power_source),label=chargeLabel(raw);return '<span class="battery-gauge '+b.color+(charging?' is-charging':'')+'" aria-label="배터리 '+E(b.label)+'"><span class="battery-shell" aria-hidden="true"><span class="battery-fill" style="width:'+(b.level??0)+'%"></span>'+((charging||plugged)?bolt(label,'charging-bolt'):'')+'</span><span class="battery-percent">'+E(b.label)+'</span></span>'}
function connectionIndicator(raw){const online=Number(raw.online)===1,label=online?'온라인':raw.online===0||raw.online==='0'?'오프라인':'연결 상태 미확인';return '<i class="pin-status-dot '+(online?'is-online':'is-offline')+'" role="img" aria-label="'+label+'" title="'+label+'"></i>'}
function pinCharge(d){if(Number(d.raw.online)!==1||!isCharging(d.raw))return '';const label=chargeLabel(d.raw);return '<g class="pin-charge" role="img" aria-label="'+label+'"><title>'+label+'</title><path d="M19 11 12.5 19H17V25L23.5 17H19Z" fill="#d8f0e3"/></g>'}
function pinTone(d){const b=LiveModel.batteryState(d.raw.battery);if(Number(d.raw.online)===0)return 'empty';if(Number(d.raw.online)===1&&isCharging(d.raw))return 'good';if(b.level===0)return 'empty';if(isCharging(d.raw))return 'good';if(b.level!==null&&b.level<20)return 'bad';if(d.status!=='good')return d.status;if(b.level===null)return 'unknown';return b.level<80?'warn':'good'}
function demoDevices(){return [
 ['demo-otter','DT태블릿01',4,1,'ok','ok','unknown','OX 퀴즈',83],
 ['demo-photo','DT태블릿02',4,1,'ok','error','ok','사진 촬영',48],
 ['demo-lab','DT태블릿03',4,0,'ok','ok','unknown','그림 퀴즈',12],
 ['demo-garden','DT태블릿04',5,0,'ok','ok','unknown','서비스 메뉴',0],
 ['demo-penguin','DT태블릿05',5,1,'ok','ok','no_paper','사진 출력',67]
 ].map(([device_id,label,floor,online,qr_status,camera_status,printer_status,current_screen_label,battery])=>({device_id,label,floor,online,qr_status,camera_status,printer_status,current_screen_label,battery,status:'active',store_id:state.store,power_source:battery===0||battery===12?'battery':'ac',charging:battery>=20&&battery<100,last_seen_at:demoStart,_demo:true}))}
function applySnapshot(raw){stateSnapshotAt=Date.now();liveSnapshot=raw.filter(d=>String(d.store_id)===state.store);devices=[...liveSnapshot,...(demoEnabled&&!window.StaticDemo?.standalone&&isDongtan()?demoDevices():[])].map(d=>normalize(d,stores));}
async function historyForDevice(id){const d=devices.find(d=>d.id===id);if(!d?.raw._demo)return api('/read/history?device_id='+encodeURIComponent(id));return Array.from({length:4},(_,i)=>({ts:new Date(Date.parse(demoStart)-i*30000).toISOString(),payload:{screen:{label:d.screen},device:{qr:d.raw.qr_status,camera:d.raw.camera_status,printer:d.raw.printer_status,battery:d.raw.battery}}}))}
function mapPlacement(d,index){if(d.raw._demo_position){localPlacements.set(d.id,d.raw._demo_position);return d.raw._demo_position}if(!localPlacements.has(d.id)){const presets={'demo-otter':[.12,.4,'4'],'demo-photo':[.43,.47,'4'],'demo-lab':[.69,.69,'4'],'demo-garden':[.32,.32,'5'],'demo-penguin':[.13,.48,'5'],'demo-tools':[.67,.33,'4'],'demo-bank':[.53,.56,'5'],'demo-entry':[.27,.57,'4'],'demo-qr-only':[.39,.3,'4'],'demo-camera-ready':[.69,.39,'5'],'demo-low-charge':[.77,.68,'5'],'demo-idle':[.49,.75,'4'],'demo-signal':[.42,.77,'5']},real=[[.26,.45,'4'],[.67,.33,'4'],[.53,.56,'5']];const [x,y,floor]=presets[d.id]||real[index%real.length];localPlacements.set(d.id,{x,y,floor:['4','5'].includes(d.floor)?d.floor:floor})}return localPlacements.get(d.id)}
const isOperating=d=>d.raw.status==='active';
const needsReview=d=>isOperating(d)&&d.status!=='good';
function nextCheck(d){return d.raw.status==='pending'?'등록 정보 확인':d.status==='bad'?'전원 / 네트워크 확인':d.status==='unknown'?'앱 실행 / 상태 수신 확인':d.raw.printer_status==='no_paper'?'프린터 용지 확인':LiveModel.badHardware(d.raw.printer_status)?'프린터 전원 / USB 연결 확인':LiveModel.badHardware(d.raw.camera_status)?'카메라 연결 / 권한 확인':LiveModel.badHardware(d.raw.qr_status)?'QR 리더 연결 확인':null}
function queueEntry(d){const action=nextCheck(d);return '<button class="queue-row '+d.status+(opsSelection===d.id?' selected':'')+'" data-case="'+E(d.id)+'" aria-pressed="'+(opsSelection===d.id)+'"><div class="queue-row-head"><strong>'+E(d.name)+'</strong><span class="queue-open" aria-hidden="true">↗</span></div><div class="queue-location">'+floorText(d.floor)+(d.raw._demo?' ':'')+batteryGauge(d.raw.battery,d.raw)+'</div><div class="queue-reason">'+E(d.reason)+'</div>'+(action?'<div class="queue-action"><span>확인</span>'+E(action)+'</div>':'')+'</button>'}
const seenText=value=>{if(!value)return '기록 없음';const raw=String(value);if(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)&&Number.isFinite(Date.parse(raw)))return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(raw));return raw.replace('T',' ').replace(/\.\d+$/,'')};
function orderedDevices(list){const rank={bad:0,warn:1,unknown:2,good:3};return [...list].sort((a,b)=>(rank[a.status]-rank[b.status])||(Number(!!a.raw._demo)-Number(!!b.raw._demo))||seenText(b.raw.last_seen_at).localeCompare(seenText(a.raw.last_seen_at))||a.id.localeCompare(b.id))}
function renderOperations(){
 const all=selected(),active=all.filter(isOperating),pending=all.filter(d=>d.raw.status==='pending'),review=active.filter(needsReview);
 const count=s=>active.filter(d=>d.status===s).length;
 $('deviceMatrix').innerHTML='<div class="visual-heading">기기 상태 <span>'+active.length+'</span></div><div class="matrix-cells">'+active.map(d=>'<button class="matrix-cell '+d.status+'" data-mini-device="'+E(d.id)+'" aria-label="'+E(d.name+' '+labels[d.status])+'" title="'+E(d.name+' / '+labels[d.status])+'"><i></i></button>').join('')+'</div><div class="matrix-key"><span><i class="good"></i>정상</span><span><i class="warn"></i>주의</span><span><i class="bad"></i>끊김</span></div>';
 const online=active.filter(d=>Number(d.raw.online)===1),rate=active.length?Math.round(online.length/active.length*100):0;
 $('opsPulse').innerHTML='<div class="pulse-ring" style="--online-rate:'+rate+'%"><div><strong id="pulseRate">'+(active.length?rate+'%':'—')+'</strong><span>온라인</span></div></div><div class="pulse-bars"><div class="pulse-caption"><span>운영 기기 연결</span><b>'+online.length+' <small>/ '+active.length+'</small></b></div>'+[['QR 리더','qr_status'],['카메라','camera_status'],['프린터','printer_status']].map(([name,key])=>{const known=online.filter(d=>d.raw[key]&&!['unknown',''].includes(d.raw[key])),ok=known.filter(d=>d.raw[key]==='ok').length;return '<div class="pulse-bar-row"><span>'+name+'</span><div class="pulse-track"><i style="width:'+(known.length?ok/known.length*100:0)+'%"></i></div><b>'+ok+'/'+known.length+'</b></div>'}).join('')+'<small class="pulse-footnote">장치 정상 / 상태 수집</small></div>';
 $('stats').innerHTML=[['운영 기기',active.length,'active',''],['연결 끊김',count('bad'),'bad','bad'],['장치 이상',count('warn'),'warn','warn'],['상태 미수집',count('unknown'),'unknown','unknown'],['승인 대기',pending.length,'pending','pending']].map(([name,num,q,cls])=>'<button class="stat '+cls+'" data-summary="'+q+'"><span class="stat-label">'+name+'</span><span class="stat-value">'+num+'<small>대</small></span></button>').join('');
 $('scopeSummary').textContent='온라인 '+active.filter(d=>Number(d.raw.online)===1).length+' / '+active.length+'대 / 실기기 '+active.filter(d=>!d.raw._demo).length+' '+active.filter(d=>d.raw._demo).length;
 $('attentionTotal').textContent=review.length;$('activeTotal').textContent=active.length;$('pendingTotal').textContent=pending.length;
 const pool=opsQueue==='attention'?review.filter(d=>!opsStatus||d.status===opsStatus):opsQueue==='active'?active:pending;
 const filtered=orderedDevices(pool.filter(d=>needsInsight(d)&&(d.name+' '+d.id).toLowerCase().includes(opsQuery.toLowerCase())));
 $('queueCount').textContent=(opsStatus?labels[opsStatus]+' / ':'')+filtered.length+'대';
 $('queueHeading').textContent='운영 점검';
 $('queueOverview').innerHTML='<div class="queue-overview-label"><span>확인 필요</span><strong>'+review.length+'<small> / '+active.length+'대</small></strong></div><div class="queue-severity">'+[['bad','연결 끊김'],['warn','장치 이상'],['unknown','미수집']].map(([s,label])=>'<button class="severity-item '+s+(opsStatus===s?' active':'')+'" data-summary="'+s+'" aria-pressed="'+(opsStatus===s)+'"><strong>'+count(s)+'</strong><span>'+label+'</span></button>').join('')+'</div>';
 document.querySelectorAll('[data-queue]').forEach(b=>{b.classList.toggle('active',b.dataset.queue===opsQueue);b.setAttribute('aria-pressed',String(b.dataset.queue===opsQueue))});
 if(!filtered.some(d=>d.id===opsSelection)){opsSelection=filtered[0]?.id||null;opsHistorySequence++;renderDiagnostic();if(opsSelection)loadOpsHistory(opsSelection)}
 $('opsQueue').innerHTML=filtered.length?['bad','warn','unknown','good'].map(s=>{const group=filtered.filter(d=>d.status===s);return group.length?'<section class="queue-group '+s+'"><h3><i></i>'+({bad:'연결 끊김',warn:'장치 이상',unknown:'상태 미수집',good:'이상 보고 없음'})[s]+'<span>'+group.length+'</span></h3>'+group.map(queueEntry).join('')+'</section>':''}).join(''):'<div class="queue-empty"><span class="empty-symbol">'+(opsQuery?'⌕':'✓')+'</span><strong>'+(opsQuery?'검색 결과 없음':opsQueue==='attention'?'확인할 운영 기기 없음':opsQueue==='pending'?'승인 대기 없음':'운영 기기 없음')+'</strong></div>';
 renderDiagnostic();renderMap();renderResponseDesk();
}
function renderDiagnostic(){
 const d=fleetDetailDevice||devices.find(x=>x.id===opsSelection);$('diagnosticScope').textContent=d?({active:'운영 중',pending:'승인 대기'})[d.raw.status]||'등록 상태 미확인':'';
 if(!d){$('diagnosticContent').innerHTML='<div class="empty">기기를 선택하세요.</div>';$('opsHistory').innerHTML='<div class="empty">기기를 선택하세요.</div>';$('historyDevice').textContent='';return}
 const hw=[['QR 리더',d.qr,d.raw.qr_status],['카메라',d.camera,d.raw.camera_status],['프린터',d.printer,d.raw.printer_status]];
 const check=nextCheck(d);
 const icons=['<path d="M3 3h7v7H3zM16 3h7v7h-7zM3 16h7v7H3zM16 16h3v3h-3zM22 16v7h-6M6 6h1M19 6h1M6 19h1"/>','<path d="M4 7h5l2-3h5l2 3h4v15H4z"/><circle cx="13" cy="14" r="4"/>','<path d="M7 9V3h12v6M7 19H3V9h20v10h-4M7 16h12v8H7zM18 12h2"/>'];
 const online=Number(d.raw.online)===1;
 const events=(d.store===state.store?displayedEvents():[]).filter(row=>row.deviceId===d.id).slice(0,5);
 const identity=[['접속 아이디',d.raw.login_account],['브릿지 앱',d.raw.bridge_app_version],['기기 모델',d.raw.device_model]].filter(([,value])=>value);
 $('diagnosticContent').innerHTML='<div class="diagnostic-title"><div class="diagnostic-name"><h3>'+E(d.name)+'</h3>'+connectionIndicator(d.raw)+'</div>'+batteryGauge(d.raw.battery,d.raw)+'</div><div class="diagnostic-location"><span>'+E(d.storeName.replace(/^주렁주렁\s*/,''))+'</span><span>'+floorText(d.floor)+'</span></div><div class="device-scene"><div class="running-screen"><span>현재 화면</span><strong>'+E(online?d.screen:'전원 미상')+'</strong></div></div>'+(check?'<div class="check-next"><small>확인할 사항</small><strong>'+E(check)+'</strong></div>':'')+'<section class="diagnostic-connections"><h4>연결 상태'+(!online?'<small>마지막 수신 기준</small>':'')+'</h4><div class="diagnostic-hardware">'+hw.map(([name,value,raw])=>{const state=!raw||raw==='unknown'?'unknown':['ok','error','no_paper'].includes(raw)?'on':'off';return '<div class="hardware-row"><span>'+name+'</span><b class="connection-badge '+state+'"><i></i>'+(state==='unknown'?'—':state.toUpperCase())+'</b></div>'}).join('')+'</div></section><div class="last-contact"><span>최근 신호 수신 시간</span><time>'+E(seenText(d.raw.last_seen_at))+'</time></div><section class="diagnostic-events"><h4>최근 이벤트</h4><ol>'+events.map(row=>'<li><time>'+exampleEventTime(row.stamp)+'</time><span>'+E(row.title)+'</span></li>').join('')+'</ol>'+(!events.length?'<p>선택한 날짜에 기록된 이벤트가 없습니다.</p>':'')+'</section>'+(identity.length?'<details class="diagnostic-identity"><summary>등록 정보</summary><dl>'+identity.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+E(value)+'</dd></div>').join('')+'</dl></details>':'');
 $('historyDevice').textContent=d.name;
}
async function loadOpsHistory(id){
 const seq=++opsHistorySequence;$('opsHistory').innerHTML='<div class="empty">수신 이력 조회 중…</div>';
 try{const rows=await historyForDevice(id);if(seq!==opsHistorySequence||opsSelection!==id||!user)return;if(!Array.isArray(rows))throw new Error('수신 이력 응답을 확인할 수 없습니다.');
 $('opsHistory').innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>수신 시각</th><th>화면</th><th>QR 리더</th><th>카메라</th><th>프린터</th><th>배터리</th></tr></thead><tbody>'+rows.slice(0,12).map(r=>{let p=r.payload;try{if(typeof p==='string')p=JSON.parse(p)}catch{p=null}const raw=p?.device||{},n=normalize({device_id:id,qr_status:raw.qr,camera_status:raw.camera,printer_status:raw.printer},[]);return '<tr><td>'+E(seenText(r.ts))+'</td><td>'+E(p?.screen?.label||'미수집')+'</td><td>'+E(n.qr)+'</td><td>'+E(n.camera)+'</td><td>'+E(n.printer)+'</td><td>'+batteryGauge(raw.battery,raw)+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">수신 이력 없음</div>';
 }catch(e){if(seq!==opsHistorySequence||!user)return;if(dataFailure(e))return;$('opsHistory').innerHTML='<div class="empty">'+E(e.message)+' <button class="text-button" id="retryHistory">다시 조회</button></div>';$('retryHistory').onclick=()=>loadOpsHistory(id)}
}
async function refreshOperations(){
 if(!user||storeLoading||opsRefreshing)return;opsRefreshing=true;const seq=++opsRefreshSequence,store=state.store;$('refreshData').disabled=true;
 try{const payload=await api('/read/devices?store_id='+encodeURIComponent(store)),raw=LiveModel.deviceList(payload);if(seq!==opsRefreshSequence||!user||store!==state.store)return;lifecycleCounts=payload.counts||{};const previousSelection=opsSelection;applySnapshot(raw);render();$('loadedAt').textContent=new Date().toLocaleTimeString('ko-KR')+' 조회';message('');if($('deviceStatus').open&&opsSelection&&previousSelection===opsSelection)await loadOpsHistory(opsSelection)}catch(e){if(seq!==opsRefreshSequence||!user)return;if(!dataFailure(e)){message('조회 실패 / 마지막 수신값 표시 중');}}finally{opsRefreshing=false;$('refreshData').disabled=false}
}
const chip=d=>(d.raw._demo?'':'')+'<span class="chip '+d.status+'"><i class="dot '+d.status+'"></i>'+labels[d.status]+'</span>';
function message(text){$('dataBanner').textContent=text;$('dataBanner').hidden=!text}
async function api(route,options={}){return StaticDemo.request(route,options)}
function showLogin(text=''){
 fleetDetailDevice=null;
 closePinPopover(false);
 storeSequence++;storeLoading=false;disposeDashboardCharts();
 incidentSelection=null;
 document.body.classList.remove('authenticated');$('loginStatus').textContent=text;
 alarmEntries=[];alarmSerial=0;alarmStore='';eventDay=eventToday;eventCalendarOpen=false;eventArchives.clear();lifecycleCounts={};currentStore=null;opsInsight=null;liveSnapshot=[];localPlacements.clear();opsSelection=null;opsHistorySequence++;opsRefreshSequence++;$('diagnosticContent').replaceChildren();$('opsHistory').replaceChildren();user=null;if($('openingNotice'))$('openingNotice').hidden=true;openingNoticeDismissed=false;devices=[];stores=[];maps=[];positions=[];versions=null;serverSchedule=appliedSchedule=null;mapSequence++;detailSequence++;
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());$('connectionPanel').hidden=false;$('liveContent').hidden=true;$('disconnect').hidden=true;$('accountLabel').textContent='로그인 필요';$('loadedAt').textContent='연결되지 않음';message(text);
}
function dataFailure(e){if(e.status===401){showLogin('인증이 만료되었습니다. 다시 로그인해 주세요.');return true}return false}
const floorText=f=>f==null?'층 미등록':Number(f)<0?'B'+Math.abs(Number(f)):E(f)+'F';
const selected=()=>devices.filter(d=>d.store===state.store);
function render(){
 const inlinePanel=$('fleetDetailWorkspace');if(inlinePanel?.parentElement===$('deviceRows'))$('devicesView').append(inlinePanel);
 if($('openingNotice'))$('openingNotice').hidden=!user||state.view!=='overview'||openingNoticeDismissed;
 if(state.view!=='overview')closePinPopover(false);
 renderBranchMenu();
 const list=state.view==='devices'?managedDevices():selected(),n=s=>list.filter(d=>d.status===s).length;
 $('mapStore').textContent=stores.find(s=>s.id===state.store)?.name||'지점 없음';
 renderOperations();
 if(!renderEnrollmentFleet(list)){
 const filtered=list.filter(d=>isOperating(d)&&(!fleetStoreFilter||d.store===fleetStoreFilter)&&(d.name+' '+d.id+' '+d.screen).toLowerCase().includes(state.query.toLowerCase()));
 
 setMarkup($('deviceRows'),filtered.length?sortFleet(filtered).map(d=>{
  const online=Number(d.raw.online)===1,attention=['bad','warn'].includes(d.status),stamp=seenText(d.raw.last_seen_at),time=stamp.match(/\d{2}:\d{2}:\d{2}/)?.[0]||'기록 없음';
  const status=Number(d.raw.online)===0?'':!online?'연결 미확인':attention?d.reason.replace(/배터리\s*\d+%/g,'').trim():'';
  return '<article class="fleet-device '+(online?'online':'offline')+(attention?' needs-check':'')+'" role="listitem"><button class="fleet-device-open" data-manage-device="'+E(d.id)+'" aria-label="'+E(d.name)+' 상태 보기"><span class="fleet-card-head"><span class="fleet-name">'+connectionIndicator(d.raw)+'<strong>'+E(d.name)+'</strong></span>'+batteryGauge(d.raw.battery,d.raw)+'</span><span class="fleet-screen"><span class="fleet-screen-caption">현재 화면</span><strong>'+E(online?d.screen:'전원 미상')+'</strong><span class="fleet-health"><span class="fleet-health-label">'+E(status)+'</span></span></span></button><div class="fleet-card-actions"><span class="fleet-floor">'+E(d.storeName.replace(/^주렁주렁\s*/,''))+' / '+floorText(d.floor)+'</span>'+(window.StaticDemo?.retireDevice?'<button class="fleet-retire" data-retire-device="'+E(d.id)+'" aria-label="'+E(d.name)+' 삭제"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/></svg>삭제</button>':'')+'</div></article>';
 }).join(''):'<div class="fleet-empty">조건에 맞는 기기가 없습니다.</div>');
 $('tableFoot').textContent='';
 }
 $('scheduleText').textContent=state.view==='devices'?'지점별 설정':appliedSchedule?'매일 '+appliedSchedule.start+' – '+appliedSchedule.end+(appliedSchedule.start>appliedSchedule.end?' (다음 날)':''):'운영시간 미조회 또는 조회 권한 없음';
 $('scheduleOpen').disabled=state.view==='devices'?!stores.length:!appliedSchedule;
 document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
 $('overviewView').hidden=state.view!=='overview';$('devicesView').hidden=state.view!=='devices';$('pageTitle').textContent='NEXUS ITHUB MONITORING MANAGER';
 $('pageSubtitle').textContent=storeName();$('selectedStoreName').textContent=storeName().replace(/^주렁주렁\s*/,'');
 $('store').value=state.store;
 if(state.view!=='overview')disposeDashboardCharts();else resizeDashboard();renderManagedWorkspace();renderScheduleOverview();updateOverlayScroll();
}
function renderMap(){
 const branch=localPlanKey();
 if(!isDongtan()&&!branch){renderRegisteredMap();return}
 $('mapCanvas').classList.remove('registered-map');$('mapCanvas').style.removeProperty('--map-ratio');
 const floor=branch||(state.floor==='5'?'5':'4');state.floor=floor;
 setMarkup($('floorTabs'),(branch?[branch]:['4','5']).map(f=>'<button data-floor="'+f+'" class="'+(f===floor?'active':'')+'">'+(branch?'전체 지도':f+'F')+'</button>').join(''));
 $('mapCanvas').hidden=false;$('mapEmpty').hidden=true;$('planFloor').textContent=branch?storeName():floor+'F';
 const target=$('schematic');if(target.dataset.floor!==floor){markupCache.delete(target);target.dataset.floor=floor;target.replaceChildren($('floorPlan'+floor).content.cloneNode(true));$('zoneHint').textContent='구역 선택';$('selectedZone').textContent='구역을 선택하세요';}
 const active=selected().filter(isOperating),placed=active.map((d,i)=>({d,p:branch?branchPlacement(d,i,branch):mapPlacement(d,i)})).filter(({p})=>p.floor===floor);
 setMarkup($('pins'),placed.map(({d,p})=>'<button class="map-pin '+pinTone(d)+(opsSelection===d.id?' selected':'')+'" data-pin="'+E(d.id)+'" data-case="'+E(d.id)+'" style="left:'+p.x*100+'%;top:'+p.y*100+'%" aria-label="'+E(d.name)+' 임시 위치'+'"><span class="pin-core"><svg class="refined-location-pin" viewBox="0 0 36 48" aria-hidden="true"><path class="refined-pin-body" d="M18 46C15 40 3 28 3 18a15 15 0 0 1 30 0c0 10-12 22-15 28Z"/>'+(Number(d.raw.online)===1&&isCharging(d.raw)&&LiveModel.batteryState(d.raw.battery).level!==null&&LiveModel.batteryState(d.raw.battery).level<100?'<path class="pin-charge-fill" d="M18 46C15 40 3 28 3 18a15 15 0 0 1 30 0c0 10-12 22-15 28Z"/>':'')+'<circle class="refined-pin-inset" cx="18" cy="18" r="9"/><circle class="refined-pin-dot" cx="18" cy="18" r="2.5"/>'+pinCharge(d)+'</svg></span><span class="pin-label">'+E(d.name)+'</span></button>').join(''));
 $('floorSummary').textContent=(branch?'전체 지도':floor+'F')+' / '+placed.length+'대 / 임시 위치';
 
 renderServiceFlow();
 syncPinPopover();
}
function branchPlacement(d,index,branch){
 if(d.raw._demo_position){localPlacements.set(d.id,d.raw._demo_position);return d.raw._demo_position}
 const anchors={Hanam:[[.31,.53],[.16,.46],[.45,.34],[.7,.36],[.83,.61],[.61,.75],[.53,.55],[.22,.73],[.86,.31]],Yeongdeungpo:[[.56,.66],[.3,.72],[.47,.57],[.61,.29],[.78,.56],[.72,.75],[.23,.45],[.38,.32],[.84,.35],[.48,.82],[.65,.49]],Gyeongju:[[.17,.21],[.47,.26],[.88,.2],[.84,.47],[.19,.56],[.28,.78],[.51,.7]]};
 if(!localPlacements.has(d.id)||localPlacements.get(d.id).floor!==branch){const [x,y]=anchors[branch][index%anchors[branch].length];localPlacements.set(d.id,{x,y,floor:branch})}
 return localPlacements.get(d.id);
}
function selectZone(zone){
 const root=zone.closest('.blueprint');root.querySelectorAll('.plan-zone').forEach(x=>{x.classList.toggle('selected',x===zone);x.setAttribute('aria-pressed',String(x===zone))});
 $('selectedZone').textContent=zone.dataset.zone;$('zoneHint').textContent=(localPlanKey()?'전체 지도':state.floor+'F')+' / '+zone.dataset.zone;
}
async function loadMap(){
 const seq=++mapSequence,store=state.store;maps=[];positions=[];mapLoadError='';state.floor=null;
 if(isDongtan()||localPlanKey()){state.floor=localPlanKey()||'4';renderMap();return}
 $('mapCanvas').hidden=true;$('mapEmpty').hidden=false;$('mapEmpty').textContent='지도 조회 중';
 const results=await Promise.allSettled([api('/read/maps?store_id='+encodeURIComponent(store)),api('/read/positions?store_id='+encodeURIComponent(store))]);
 if(seq!==mapSequence||store!==state.store||!user)return;
 const authFailure=results.find(r=>r.status==='rejected'&&r.reason.status===401);if(authFailure){dataFailure(authFailure.reason);return}
 maps=results[0].status==='fulfilled'&&Array.isArray(results[0].value)?results[0].value.filter(m=>String(m.store_id)===store):[];
 positions=results[1].status==='fulfilled'&&Array.isArray(results[1].value)?results[1].value.filter(p=>String(p.store_id)===store):[];
 if(results[0].status==='rejected')mapLoadError='지도를 불러오지 못했습니다.';
 if(results[1].status==='rejected')message('기기 위치 조회 실패');
 state.floor=maps.length?String(maps[0].floor):null;renderMap();
}
function renderRegisteredMap(){
 const floors=[...new Set(maps.map(m=>String(m.floor)))];if(!floors.includes(state.floor))state.floor=floors[0]||null;
 setMarkup($('floorTabs'),floors.map(f=>'<button data-floor="'+E(f)+'" class="'+(f===state.floor?'active':'')+'">'+floorText(f)+'</button>').join(''));
 const map=maps.find(m=>String(m.floor)===state.floor),url=typeof map?.image_url==='string'&&map.image_url.trim()?safeImage(map.image_url):null;$('mapEmpty').hidden=!!url;$('mapEmpty').textContent=mapLoadError||storeName()+' / 등록된 지도 없음';$('mapCanvas').hidden=!url;
 $('mapCanvas').classList.add('registered-map');$('mapCanvas').style.setProperty('--map-ratio',map?.width>0&&map?.height>0?map.width/map.height:1.44);
 if(url){setMarkup($('schematic'),'<img class="registered-floor-image" src="'+E(url)+'" alt="'+E(storeName()+' '+floorText(state.floor))+'" decoding="async" referrerpolicy="no-referrer">');const img=$('schematic').querySelector('img');img.onerror=()=>{$('mapCanvas').hidden=true;$('mapEmpty').hidden=false;$('mapEmpty').textContent='지도 이미지 로드 실패'};delete $('schematic').dataset.floor;}
 else {$('schematic').replaceChildren();delete $('schematic').dataset.floor}
 const list=selected().filter(isOperating).flatMap(d=>{const row=positions.find(p=>p.device_id===d.id),p=position(row);return p&&p.floor===state.floor?[{d,p}]:[]});
 setMarkup($('pins'),list.map(({d,p})=>'<button class="map-pin '+pinTone(d)+'" data-case="'+E(d.id)+'" style="left:'+p.x*100+'%;top:'+p.y*100+'%" aria-label="'+E(d.name)+'"><span class="pin-core"><svg class="refined-location-pin" viewBox="0 0 36 48" aria-hidden="true"><path class="refined-pin-body" d="M18 46C15 40 3 28 3 18a15 15 0 0 1 30 0c0 10-12 22-15 28Z"/>'+(Number(d.raw.online)===1&&isCharging(d.raw)&&LiveModel.batteryState(d.raw.battery).level!==null&&LiveModel.batteryState(d.raw.battery).level<100?'<path class="pin-charge-fill" d="M18 46C15 40 3 28 3 18a15 15 0 0 1 30 0c0 10-12 22-15 28Z"/>':'')+'<circle class="refined-pin-inset" cx="18" cy="18" r="9"/>'+pinCharge(d)+'</svg></span><span class="pin-label">'+E(d.name)+'</span></button>').join(''));
 renderServiceFlow();syncPinPopover();
}
async function switchStore(id){
 if(!user||!stores.some(s=>s.id===id)||id===state.store)return;
 closePinPopover(false);
 const seq=++storeSequence;storeLoading=true;opsRefreshSequence++;opsHistorySequence++;detailSequence++;mapSequence++;
 state.store=id;serverSchedule=null;appliedSchedule=branchSchedules.get(id)||null;localScheduleChanged=branchSchedules.has(id);state.floor=null;state.query='';state.filter='all';mapMode='plan';stateSnapshotAt=null;currentStore=stores.find(s=>s.id===id)?.raw||null;
 devices=[];liveSnapshot=[];maps=[];positions=[];opsSelection=null;opsQuery='';opsInsight=null;lifecycleCounts={};incidentSelection=null;
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();message('지점 조회 중');
 try{const [payload,scheduleResult]=await Promise.all([api('/read/devices?store_id='+encodeURIComponent(id)),user.role==='ADMIN'?api('/read/schedule?store_id='+encodeURIComponent(id)).then(value=>({value}),error=>({error})):Promise.resolve({value:null})]);if(seq!==storeSequence||!user)return;if(scheduleResult.error?.status===401){dataFailure(scheduleResult.error);return}serverSchedule=parseSchedule(scheduleResult.value);appliedSchedule=branchSchedules.get(id)||serverSchedule;localScheduleChanged=branchSchedules.has(id);lifecycleCounts=payload.counts||{};applySnapshot(LiveModel.deviceList(payload));render();message('');await loadMap()}
 catch(e){if(seq===storeSequence&&!dataFailure(e)){message('지점 조회 실패 / 새로고침으로 다시 조회하세요.');render();await loadMap()}}
 finally{if(seq===storeSequence){storeLoading=false;$('refreshData').disabled=false}}
}
async function loadData(){
 message('개발서버에서 기기 정보를 조회하고 있습니다.');$('connectionError').textContent='';
 const storeResponse=user.role==='ADMIN'?await api('/read/stores'):{stores:[{store_id:user.store_id,store_name:user.store_name}]};
 const dongtan=(storeResponse.stores||[]).find(s=>/^(주렁주렁)?동탄점$/.test(String(s.store_name||'').replace(/\s/g,'')));
 const initial=dongtan||(storeResponse.stores||[])[0];if(!initial?.store_id)throw new Error('조회 가능한 지점이 없습니다.');
 currentStore=initial;state.store=String(initial.store_id);stores=(storeResponse.stores||[]).map(s=>({id:String(s.store_id),name:s.store_name,raw:s}));
 const payload=await api('/read/devices?store_id='+encodeURIComponent(state.store));const snapshot=LiveModel.deviceList(payload).filter(d=>String(d.store_id)===state.store);lifecycleCounts=payload.counts||{};
 const results=await Promise.allSettled([Promise.resolve(storeResponse),api('/read/versions'),user.role==='ADMIN'?api('/read/schedule?store_id='+encodeURIComponent(state.store)):Promise.resolve(null)]);
 if(results.some(r=>r.status==='rejected'&&r.reason.status===401))throw Object.assign(new Error('로그인이 만료되었습니다.'),{status:401});
 const sr=results[0];stores=sr.status==='fulfilled'&&Array.isArray(sr.value?.stores)?sr.value.stores.filter(s=>s.store_id!=null).map(s=>({id:String(s.store_id),name:s.store_name||'지점 '+s.store_id,raw:s})):[];
 for(const d of snapshot){const id=String(d.store_id??'');if(!stores.some(s=>s.id===id))stores.push({id,name:id?'지점 '+id:'지점 미등록'})}
 applySnapshot(snapshot);versions=results[1].status==='fulfilled'?results[1].value:null;serverSchedule=results[2].status==='fulfilled'?parseSchedule(results[2].value):null;appliedSchedule=branchSchedules.get(state.store)||(serverSchedule?{...serverSchedule}:null);localScheduleChanged=branchSchedules.has(state.store);
 if(!stores.some(s=>s.id===state.store))state.store=stores.find(s=>s.id===String(user.store_id))?.id||stores[0]?.id||'';
 $('store').innerHTML=stores.map(s=>'<option value="'+E(s.id)+'">'+E(s.name)+'</option>').join('');document.body.classList.add('authenticated');$('connectionPanel').hidden=true;$('liveContent').hidden=false;$('disconnect').hidden=false;$('accountLabel').textContent=(user.username||'로그인 계정')+' / '+user.role;
 $('loadedAt').textContent=new Date().toLocaleTimeString('ko-KR')+' 조회';
 const warnings=results.map((r,i)=>r.status==='rejected'?['지점명','버전','운영시간'][i]+' 조회 실패':'').filter(Boolean);
 message(warnings.length?warnings.join(', '):'');render();await loadMap();
}
function openModal(id){returnFocus=document.activeElement;$(id).showModal()}
async function detail(id){
 const d=devices.find(x=>x.id===id);if(!d)return;const seq=++detailSequence,offline=d.status==='bad';const row=(a,b)=>'<div class="detail-row"><span>'+E(a)+'</span><b>'+E(b??'미수집')+'</b></div>';
 $('detailContent').innerHTML='<h2>'+E(d.name)+'</h2><div class="device-sub">'+E(d.storeName)+' / '+floorText(d.floor)+' / '+E(d.id)+'</div>'+chip(d)+'<div class="device-alert '+(d.status==='good'?'good':'')+'">'+E(d.reason)+'</div><section class="detail-section"><h3>기본 정보'+(offline?' / 마지막 수신값':'')+'</h3>'+row('현재 화면',d.screen)+row('전원',d.power)+('<div class="detail-row"><span>배터리</span><b>'+batteryGauge(d.raw.battery,d.raw)+'</b></div>')+row('마지막 응답',d.seen)+row('등록 상태',({active:'운영중',pending:'승인 대기',retired:'퇴역'})[d.raw.status]||d.raw.status)+row('화면 운영시간',appliedSchedule?appliedSchedule.start+' – '+appliedSchedule.end+(localScheduleChanged?'':''):'미조회')+'</section><section class="detail-section"><h3>주변 장치'+(offline?' / 마지막 수신값':'')+'</h3><div class="hardware-grid">'+[['QR 리더',d.qr],['카메라',d.camera],['프린터',d.printer]].map(([name,s])=>'<div class="hardware">'+name+'<b>'+E(s)+'</b></div>').join('')+'</div></section><details class="detail-section"><summary>앱 버전 및 기술 정보</summary>'+row('운영 앱',d.raw.app)+row('앱 빌드',d.raw.app_build_version_label||d.raw.app_build_version)+row('브릿지 버전',d.raw.bridge_app_version||d.raw.app_version)+row('운영도구 최신',versions?.tools_latest?.display||versions?.tools_latest?.version)+row('브릿지 최신',versions?.bridge_latest?.versionName)+row('단말 ID',d.id)+'</details><section class="detail-section"><h3>최근 수신 이력</h3><div id="historyContent" class="timeline">조회 중…</div></section>';openModal('detail');
 try{const rows=await historyForDevice(id);if(seq!==detailSequence||!user)return;if(!Array.isArray(rows))throw new Error('이력 응답 형식을 확인할 수 없습니다.');$('historyContent').innerHTML=rows.length?rows.slice(0,12).map(r=>{let p=r.payload;if(typeof p==='string'){try{p=JSON.parse(p)}catch{p=null}}return '<p><small>'+E(r.ts||'시각 미수집')+'</small>'+E(p?.screen?.label||p?.current_screen_label||'상태 수신')+'</p>'}).join(''):'수신 이력이 없습니다.'}catch(e){if(seq!==detailSequence)return;if(dataFailure(e))return;$('historyContent').textContent=e.message}
}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.device)detail(b.dataset.device);if(b.dataset.view){state.view=b.dataset.view;render()}if(b.dataset.store!==undefined)switchStore(b.dataset.store);if(b.dataset.floor!==undefined){state.floor=b.dataset.floor;renderMap()}if(b.dataset.filter){state.filter=b.dataset.filter;render()}if(b.dataset.close)$(b.dataset.close).close()});
document.querySelectorAll('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}});d.addEventListener('close',()=>{if(d.id==='detail')detailSequence++;(returnFocus?.isConnected&&returnFocus!==document.body?returnFocus:[...document.querySelectorAll("[data-pin]"),...document.querySelectorAll(".queue-row")].find(b=>(b.dataset.pin||b.dataset.case)===opsSelection))?.focus()})});
$('store').onchange=e=>switchStore(e.target.value);$('search').oninput=e=>{state.query=e.target.value.trim();render()};$('guideOpen').onclick=()=>openModal('guide');
function updateScheduleDuration(){const start=$('startTime').value,end=$('endTime').value,valid=parseSchedule({wake_time:start,sleep_time:end});if(!valid){$('scheduleDuration').textContent='';return}const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),duration=(minutes(end)-minutes(start)+1440)%1440;$('scheduleDuration').textContent='매일 '+Math.floor(duration/60)+'시간'+(duration%60?' '+duration%60+'분':'')+' 운영'+(end<start?' / 다음 날 종료':'')}
$('startTime').oninput=$('endTime').oninput=()=>{$('timeError').textContent='';updateScheduleDuration()};
$('scheduleOpen').onclick=()=>{if(!appliedSchedule)return;$('scheduleTitle').textContent=storeName().replace(/^주렁주렁\s*/,'')+' 화면 운영시간';$('startTime').value=appliedSchedule.start;$('endTime').value=appliedSchedule.end;$('timeError').textContent='';updateScheduleDuration();openModal('schedule')};
$('scheduleForm').onsubmit=e=>{e.preventDefault();const next=parseSchedule({wake_time:$('startTime').value,sleep_time:$('endTime').value});if(!next){$('timeError').textContent='시작과 종료 시간을 확인해 주세요. 같은 시간은 지정할 수 없습니다.';return}if($('scheduleSave').disabled)return;branchSchedules.set(scheduleTarget||state.store,{...next});if((scheduleTarget||state.store)===state.store){appliedSchedule=next;localScheduleChanged=true;}render();indicateScheduleSave(scheduleTarget||state.store);$('schedule').close();$('toast').textContent='운영시간을 저장했습니다.';$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),3500)};
document.querySelector('.brand').onclick=e=>{e.preventDefault();state.view='overview';if(user)render()};
document.addEventListener('click',e=>{const z=e.target.closest('[data-zone]');if(z)selectZone(z)});
document.addEventListener('keydown',e=>{const z=e.target.closest('[data-zone]');if(z&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectZone(z)}});
 $('togglePassword').onclick=()=>{const input=$('loginPassword'),show=input.type==='password';input.type=show?'text':'password';$('togglePassword').setAttribute('aria-pressed',String(show));$('togglePassword').setAttribute('aria-label',show?'비밀번호 숨기기':'비밀번호 표시')};
$('loginForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;$('loginSubmit').disabled=true;$('connectionError').textContent='';try{const result=await api('/session/login',{method:'POST',headers:{'Content-Type':'application/json','X-Concept-Request':'1'},body:JSON.stringify({username:form.elements.username.value,password:form.elements.password.value})});form.elements.password.value='';user=result.user;await loadData()}catch(err){if(!dataFailure(err)){$('connectionError').textContent=err.message;message('에 접속하지 못했습니다.')}}finally{form.elements.password.value='';$('loginSubmit').disabled=false}};
$('disconnect').onclick=async()=>{const button=$('disconnect');button.disabled=true;try{await api('/session/logout',{method:'POST',headers:{'X-Concept-Request':'1'}});showLogin();$('loginPassword').value='';$('connectionError').textContent='';$('loginUsername').focus()}catch(e){message('로그아웃하지 못했습니다. '+e.message)}finally{button.disabled=false}};
$('refreshData').onclick=refreshOperations;
document.addEventListener('click',e=>{const button=e.target.closest('[data-insight]');if(button){opsInsight=button.dataset.insight;opsQueue='active';opsStatus=null;opsQuery='';$('queueSearch').value='';renderOperations()}});
function showDeviceStatus(){closePinPopover(false);for(const id of ['queueDialog','incidentDialog'])if($(id).open)$(id).close();if(!$('deviceStatus').open)openModal('deviceStatus')}
function selectFlowDevice(id){opsQueue='active';opsStatus=null;opsInsight=null;opsQuery='';$('queueSearch').value='';opsSelection=id;renderOperations();loadOpsHistory(id);showDeviceStatus()}
function closePinPopover(restoreFocus=true){
 clearAlarmFocus();
 const id=pinPopoverId;pinPopoverId=null;$('pinPopover').hidden=true;$('pinPopover').replaceChildren();markupCache.delete($('pinPopover'));
 document.querySelectorAll('.map-pin[aria-expanded]').forEach(pin=>pin.setAttribute('aria-expanded','false'));
 if(restoreFocus&&id)[...$('pins').querySelectorAll('.map-pin')].find(pin=>pin.dataset.case===id)?.focus();
}
function syncPinPopover(){
 if(!pinPopoverId)return;
 const pin=[...$('pins').querySelectorAll('.map-pin')].find(p=>p.dataset.case===pinPopoverId),d=selected().find(d=>d.id===pinPopoverId);
 if(!pin||!d||mapMode!=='plan'||state.view!=='overview'){closePinPopover(false);return}
 document.querySelectorAll('.map-pin').forEach(node=>node.classList.toggle('alarm-focused',node===pin));
 const checksOpen=$('pinPopover').querySelector('.pin-title strong')?.textContent===d.name&&$('pinPopover').querySelector('.pin-extra-checks')?.open;
 const popup=$('pinPopover'),recentNode=popup.querySelector('.pin-recent-events'),recentOpen=recentNode?.open&&recentNode.dataset.historyDevice===d.id;popup.hidden=false;pin.setAttribute('aria-expanded','true');
 setMarkup(popup,'<div class="pin-popover-head"><div class="pin-title"><strong>'+E(d.name)+'</strong>'+connectionIndicator(d.raw)+'</div><div class="pin-header-power">'+batteryGauge(d.raw.battery,d.raw)+'</div></div><div class="pin-screen"><span>'+'현재 화면'+'</span><b>'+E(Number(d.raw.online)===1?d.screen:'전원 미상')+'</b>'+'</div><section class="pin-connections" aria-label="연결 장치">'+(Number(d.raw.online)!==1?'<h3><small>마지막 수신 기준</small></h3>':'')+'<ul class="pin-hardware">'+[['QR 리더',d.raw.qr_status],['카메라',d.raw.camera_status],['프린터',d.raw.printer_status]].map(([name,raw])=>{const state=!raw||raw==='unknown'?'unknown':['ok','error','no_paper'].includes(raw)?'on':'off';return '<li><span>'+name+'</span><b class="connection-badge '+state+'"'+(state==='unknown'?' title="미수집" aria-label="미수집"':'')+'><i></i>'+(state==='unknown'?'—':state.toUpperCase())+'</b></li>'}).join('')+'</ul></section>'+'<details class="pin-extra-checks"><summary>설정 및 동작 확인</summary>'+deviceExampleLinks(d)+'</details>'+recentDeviceEvents(d)+'<div class="pin-popover-foot"><span>최근 신호 수신 시간</span><time title="'+E(seenText(d.raw.last_seen_at))+'">'+E(seenText(d.raw.last_seen_at).match(/\d{2}:\d{2}:\d{2}/)?.[0]||'기록 없음')+'</time></div>');
 if(checksOpen)popup.querySelector('.pin-extra-checks').open=true;
 if(recentOpen&&popup.querySelector('.pin-recent-events'))popup.querySelector('.pin-recent-events').replaceWith(recentNode);
 positionPinPopover();
}
function positionPinPopover(){
 if(!pinPopoverId||$('pinPopover').hidden)return;
 const pin=[...$('pins').querySelectorAll('.map-pin')].find(p=>p.dataset.case===pinPopoverId);if(!pin)return;
 const host=document.querySelector('.map-panel').getBoundingClientRect(),anchor=pin.getBoundingClientRect(),popup=$('pinPopover'),width=popup.offsetWidth||268,height=popup.offsetHeight||275;
 const right=anchor.right-host.left+16,left=anchor.left-host.left-width-16;
 const onRight=right+width<=host.width-8||left<8;
 const x=Math.max(8,Math.min(Math.max(8,host.width-width-8),onRight?right:left)),y=Math.max(52,Math.min(Math.max(52,host.height-height-30),anchor.top-host.top-25));
 popup.style.left=x+'px';popup.style.top=y+'px';popup.classList.toggle('anchor-right',onRight);positionRecentHistory();
}
function openPinPopover(id,eventId=null){locatedEventId=eventId;document.querySelectorAll('.alarm-entry').forEach(row=>row.classList.toggle('is-located',eventId!==null&&Number(row.dataset.alarm)===eventId));pinPopoverId=id;syncPinPopover();$('pinPopover').setAttribute('tabindex','-1');$('pinPopover').focus({preventScroll:true})}
document.addEventListener('click',e=>{
 if(pinPopoverId&&!e.target.closest('.map-pin,#pinPopover,[data-alarm],[data-notice-device],[data-status-device],[data-incident-device],[data-dashboard-device]'))closePinPopover(false);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pinPopoverId){e.preventDefault();closePinPopover()}});
document.addEventListener('click',e=>{const mode=e.target.closest('[data-map-mode]');if(mode){mapMode=mode.dataset.mapMode;renderMap()}const node=e.target.closest('[data-flow]');if(node)selectFlowDevice(node.dataset.flow)});
document.addEventListener('click',e=>{const cell=e.target.closest('[data-mini-device]');if(cell)selectFlowDevice(cell.dataset.miniDevice)});
document.addEventListener('keydown',e=>{const node=e.target.closest('[data-flow]');if(node&&['Enter',' '].includes(e.key)){e.preventDefault();selectFlowDevice(node.dataset.flow)}});

$('queueSearch').oninput=e=>{opsQuery=e.target.value.trim();renderOperations()};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.queue||b.dataset.summary){opsInsight=null;const value=b.dataset.queue||b.dataset.summary;opsStatus=['bad','warn','unknown'].includes(value)?value:null;opsQueue=opsStatus?'attention':value;opsQuery='';$('queueSearch').value='';renderOperations()}if(b.dataset.case){opsSelection=b.dataset.case;if(b.classList.contains('map-pin')){opsInsight=null;opsQueue='active';opsStatus=null;opsQuery='';$('queueSearch').value=''}renderOperations();const d=devices.find(x=>x.id===opsSelection),floor=localPlacements.get(d?.id)?.floor||d?.floor;if(['4','5'].includes(floor)){state.floor=floor}renderMap();if(b.classList.contains('map-pin'))openPinPopover(opsSelection);else{loadOpsHistory(opsSelection);showDeviceStatus()}}});
setInterval(()=>{if(!document.hidden)refreshOperations()},30000);
document.addEventListener('click',e=>{
 const issue=e.target.closest('[data-incident]');if(issue){incidentSelection=issue.dataset.incident;renderIncidentContent();openModal('incidentDialog')}
 const device=e.target.closest('[data-incident-device]');if(device){$('incidentDialog').close();locateAlarm({deviceId:device.dataset.incidentDevice},true)}
 if(e.target.closest('[data-summary],[data-insight]')&&!$('queueDialog').open)openModal('queueDialog');
});
// Snapshot charts. They describe received telemetry, never inferred transaction volume.
const dashboardCharts=new Map(),chartOptions=new Map();
function disposeDashboardCharts(){for(const chart of dashboardCharts.values())chart.dispose();dashboardCharts.clear();chartOptions.clear()}
const activityGroups=[['미션 체험',/퀴즈|미션|보물/,'#56c6f0'],['촬영 / 출력',/사진|촬영|출력/,'#9c91f4'],['입장 / 멤버십',/QR|입장|회원|여권|쿠폰/,'#4ed2b5'],['주렁은행',/은행|주화|저축|환전/,'#f2bd72'],['메뉴 / 기타',null,'#728ba9']];
function activityIndex(d){const index=activityGroups.findIndex(([,pattern])=>pattern?.test(d.screen));return index<0?4:index}
function alertAssessment(d,now=new Date()){
 const raw=d.raw,time=raw.last_seen_at;
 const parsed=time?Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(time)?time:String(time).replace(' ','T')+'+09:00'):NaN;
 const age=(now.getTime()-parsed)/60000;
 if(!Number.isFinite(age)||age<0)return {key:'unknown',label:'응답 시각 확인 필요'};
 const valid=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||'');
 const wake=raw.display_wake_time,sleep=raw.display_sleep_time,zone=raw.display_schedule_timezone;
 if(!valid(wake)||!valid(sleep)||wake===sleep||!zone)return {key:'unknown',label:'종료 시간 설정 확인 필요'};
 let parts;try{parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)}catch{return {key:'unknown',label:'시간대 확인 필요'}}
 const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
 const current=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value),start=mins(wake),end=mins(sleep);
 const within=start<end?current>=start&&current<end:current>=start||current<end;
 if(!within)return {key:'sleep',label:'화면 종료 시간 / 알림 제외'};
 if((current-start+1440)%1440<10)return {key:'grace',label:'시작 후 10분 유예'};
 if(age>=5)return {key:'alert',label:'5분 이상 무응답'};
 if(Number(raw.online)!==1)return {key:'unknown',label:'연결값 / 최근 응답 확인 필요'};
 return {key:'fresh',label:'최근 5분 내 응답'};
}
function drawDashboardChart(id,option,onClick){
 if(!window.echarts||state.view!=='overview'||document.hidden)return;
 for(const [key,chart] of dashboardCharts)if(!chart.getDom().isConnected){chart.dispose();dashboardCharts.delete(key);chartOptions.delete(key)}
 const el=$(id);if(!el)return;
 let chart=dashboardCharts.get(id);if(!chart){chart=echarts.init(el,null,{renderer:'svg'});dashboardCharts.set(id,chart)}
 const signature=JSON.stringify(option);if(chartOptions.get(id)!==signature){chart.setOption({animation:false,textStyle:{fontFamily:'Pretendard, sans-serif'},...option},true);chartOptions.set(id,signature)}
 chart.off('click');if(onClick)chart.on('click',onClick);
}
const headerClockFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function updateTodayClock(){if(syncEventDate()&&user)renderAlarmFeed();const now=new Date();$('todayClock').dateTime=now.toISOString();$('todayClock').textContent=headerClockFormat.format(now)}
function hardwareIcons(){const paths=['<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h2v2h3v3h-5z"/>','<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/>','<path d="M7 8V3h10v5M6 17H3V8h18v9h-3M7 14h10v7H7zM17 11h1"/>'];return ['QR 리더','카메라','프린터'].map((name,i)=>'<button data-dashboard="hardware:'+i+'" title="'+name+'" aria-label="'+name+' 상태 상세"><svg viewBox="0 0 24 24" aria-hidden="true">'+paths[i]+'</svg></button>').join('')}
function renderDashboard(){
 renderOpeningNotice();
 const active=selected().filter(isOperating),online=active.filter(d=>Number(d.raw.online)===1),review=active.filter(needsReview),low=online.filter(d=>{const b=LiveModel.batteryState(d.raw.battery);return b.level!=null&&b.level<20}),rate=active.length?Math.round(online.length/active.length*100):0;
 updateTodayClock();
 setMarkup($('executiveSummary'),'<div class="overview-heading"><h2>기기 현황</h2></div><div class="overview-signals"><button class="signal-count service-count" data-dashboard="connection"><span>서비스 운영</span><strong>'+active.length+'<small>대</small></strong></button><button class="signal-count review-count" data-dashboard="attention"><span>확인 필요</span><strong>'+active.filter(d=>['warn','bad'].includes(d.status)).length+'<small>대</small></strong></button></div>');

}
function showDashboardDetail(kind){
 const active=selected().filter(isOperating),online=active.filter(d=>Number(d.raw.online)===1);let title='현황 상세',list=active,extra='';
 if(kind==='connection')title='서비스 운영 기기';
 if(kind.startsWith('service:')){const i=Number(kind.split(':')[1]);title=activityGroups[i][0];list=orderedDevices(active.filter(d=>activityIndex(d)===i));extra='<p class="drill-note">마지막 수신 화면으로 분류했습니다. 확인 필요한 기기가 먼저 표시됩니다.</p>'}
 if(kind==='charging'){title='전원 연결 기기';list=online.filter(d=>isCharging(d.raw))}
 if(kind==='activity'){title='태블릿 활동 분포';list=[];extra='<div class="activity-legend">'+activityGroups.map(([name,,color],i)=>'<button data-dashboard="activity:'+i+'"><i style="background:'+color+'"></i><span>'+name+'</span><b>'+online.filter(d=>activityIndex(d)===i).length+'<small>대</small></b><span>↗</span></button>').join('')+'</div><p class="drill-note">온라인 기기의 마지막 수신 화면 기준</p>'}
 if(kind==='attention'){title='확인 필요한 기기';list=active.filter(d=>['warn','bad'].includes(d.status))}
 if(kind==='power'){title='전원 확인';list=online.filter(d=>{const b=LiveModel.batteryState(d.raw.battery);return b.level!=null&&b.level<20});extra='<p class="drill-note">온라인 기기 기준입니다. AC 연결은 충전 완료 여부를 뜻하지 않습니다.</p>'}
 if(kind==='location'){title='위치 연결 방식';extra='<div class="policy-steps"><h3>미션 기기</h3><p>기기 ↔ 미션 지점 ID 연결 후 CRM 좌표를 지도에 매핑</p><h3>은행 / 쿠폰 / 여권 업무</h3><p>기기 ID에 지점 층 고정 좌표를 등록. 이동형 기기는 위치 확인 시각을 함께 관리</p><h3>현재 </h3><p>핀을 드래그해 임시 배치합니다. 실제 좌표 연동 전이며 새로고침하면 초기화됩니다.</p></div>';list=[]}
 if(kind.startsWith('activity:')){const i=Number(kind.split(':')[1]);title=activityGroups[i][0];list=online.filter(d=>activityIndex(d)===i);extra='<p class="drill-note">마지막 수신 화면을 기준으로 분류합니다. 실제 이용 횟수나 진행 성공 여부는 별도 수집이 필요합니다.</p>'}
 if(kind.startsWith('hardware:')){const parts=kind.split(':'),i=Number(parts[1]),segment=parts[2];title=['QR 리더','카메라','프린터'][i]+' 상태';list=online;if(segment!==undefined){const key=['qr_status','camera_status','printer_status'][i];list=list.filter(d=>{const value=d.raw[key],bucket=!value||value==='unknown'?2:value==='ok'?0:LiveModel.badHardware(value)?1:3;return bucket===Number(segment)});title+=' / '+['정상','이상','미수집','미연결'][Number(segment)]}extra='<p class="drill-note">온라인 태블릿별 보고 상태입니다. 미수집은 미연결이나 정상으로 단정하지 않습니다.</p>'}
 if(kind.startsWith('alert:')){const key=kind.split(':')[1];title={alert:'무응답 후보',sleep:'화면 종료 시간',unknown:'판단 보류'}[key];list=active.filter(d=>!d.raw._demo&&alertAssessment(d).key===key)}
 if(kind==='connection'||kind==='attention'){
  $('dashboardDetailTitle').textContent=title+' '+list.length+'대';
  $('dashboardDetailBody').innerHTML='<p class="summary-device-guide">기기를 선택하면 지도에서 위치와 상태를 확인합니다.</p><div class="summary-device-grid">'+orderedDevices(list).map(d=>'<button class="summary-device" data-dashboard-device="'+E(d.id)+'"><span><strong>'+E(d.name)+'</strong><small>'+E(floorText(d.floor))+'</small></span><em>'+E(kind==='attention'?d.reason:d.screen)+'</em><span>'+batteryGauge(d.raw.battery,d.raw)+'<small>위치 보기 ↗</small></span></button>').join('')+'</div>'+(list.length?'':'<p class="drill-note">해당 기기가 없습니다.</p>');
  if(!$('dashboardDetail').open)openModal('dashboardDetail');return;
 }
 $('dashboardDetailTitle').textContent=title;$('dashboardDetailBody').innerHTML=extra+(list.length?list.map(d=>'<button class="drill-device" data-dashboard-device="'+E(d.id)+'"><div><strong>'+E(d.name)+(d.raw._demo?' <em></em>':'')+'</strong><span>'+E(d.screen)+' / '+E(d.reason)+'</span></div><div>'+batteryGauge(d.raw.battery,d.raw)+'<span>'+E(d.power)+'</span></div><small>응답 '+E(seenText(d.raw.last_seen_at))+'</small>'+(kind.startsWith('hardware:')?'<b>'+E([d.qr,d.camera,d.printer][Number(kind.split(':')[1])])+'</b>':'')+(kind.startsWith('alert:')?'<b>'+E(alertAssessment(d).label)+'</b>':'')+'</button>').join(''):extra?'':'<p class="drill-note">해당 기기가 없습니다.</p>');if(!$('dashboardDetail').open)openModal('dashboardDetail');
}
document.addEventListener('click',event=>{const trigger=event.target.closest('[data-dashboard]');if(trigger)showDashboardDetail(trigger.dataset.dashboard);const device=event.target.closest('[data-dashboard-device]');if(device){$('dashboardDetail').close();locateAlarm({deviceId:device.dataset.dashboardDevice},true)}});
let resizePending=false;
const resizeDashboard=()=>{if(document.hidden||state.view!=='overview'||resizePending)return;resizePending=true;(window.requestAnimationFrame||setTimeout)(()=>{resizePending=false;positionPinPopover();for(const chart of dashboardCharts.values()){const node=chart.getDom();if(node.isConnected&&node.clientWidth&&node.clientHeight&&(chart.getWidth()!==node.clientWidth||chart.getHeight()!==node.clientHeight))chart.resize()}})};
if(window.ResizeObserver)new ResizeObserver(resizeDashboard).observe($('overviewView'));else window.addEventListener('resize',resizeDashboard);
setInterval(()=>{if(!document.hidden&&user)updateTodayClock()},1000);
document.body.classList.toggle('motion-paused',document.hidden);
document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('motion-paused',document.hidden);if(!document.hidden&&user){updateTodayClock();if(state.view==='overview')renderDashboard()}});
function renderBranchMenu(){
 $('branchTitle').textContent=state.view==='overview'?storeName().replace(/^주렁주렁\s*/,'')+' 상황판':'통합 기기관리';$('branchToggle').disabled=state.view!=='overview';if(state.view!=='overview'){$('branchMenu').hidden=true;$('branchToggle').setAttribute('aria-expanded','false')}
 setMarkup($('branchMenu'),stores.map(s=>'<button data-branch="'+E(s.id)+'" aria-current="'+(s.id===state.store?'true':'false')+'">'+E(s.name.replace(/^주렁주렁\s*/,''))+'</button>').join(''));
}
$('branchToggle').onclick=()=>{if(state.view!=='overview')return;const open=$('branchMenu').hidden;$('branchMenu').hidden=!open;$('branchToggle').setAttribute('aria-expanded',String(open));if(open)$('branchMenu').querySelector('button')?.focus()};
document.addEventListener('click',e=>{const option=e.target.closest('[data-branch]');if(option){$('branchMenu').hidden=true;$('branchToggle').setAttribute('aria-expanded','false');switchStore(option.dataset.branch);$('branchToggle').focus()}else if(!e.target.closest('.branch-picker')){$('branchMenu').hidden=true;$('branchToggle').setAttribute('aria-expanded','false')}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('branchMenu').hidden){$('branchMenu').hidden=true;$('branchToggle').setAttribute('aria-expanded','false');$('branchToggle').focus()}});
(async()=>{try{const session=await api('/session');user=session.user;await loadData()}catch(e){if(e.status===401)showLogin();else{showLogin('조회에 실패했습니다. 다시 로그인하거나 새로고침해 주세요.');$('connectionError').textContent=e.message}}finally{document.body.classList.remove('live-loading')}})();

document.addEventListener('click',event=>{const card=event.target.closest('[data-manage-device]');if(card)openManagedDevice(card.dataset.manageDevice)});


function lifecycleRecords(){return window.StaticDemo?.lifecycle?StaticDemo.lifecycle():[]}
function openEnrollment(id){
 const record=lifecycleRecords().find(r=>r.id===id&&r.status==='pending');if(!record){render();return}
 let dialog=$('enrollmentDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='enrollmentDialog';dialog.className='enrollment-dialog';dialog.setAttribute('aria-labelledby','enrollmentTitle');document.body.append(dialog);dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});dialog.addEventListener('close',()=>[...document.querySelectorAll('[data-enroll]')].find(n=>n.dataset.enroll===dialog.dataset.enrollment)?.focus())}
 dialog.dataset.enrollment=id;
 const suggestion=stores.find(s=>s.id===record.suggested_store),name=suggestion?.name.replace(/^주렁주렁\s*/,'')||'미확인';
 dialog.innerHTML='<header><div><span>신규 기기 등록</span><h2 id="enrollmentTitle">기기 승인</h2></div><button type="button" data-enroll-close aria-label="닫기">×</button></header><section class="enrollment-evidence"><strong>'+E(record.model)+'</strong><dl>'+[['접속 ID',record.account],['최초 접수',seenText(record.first_seen)]].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+E(value)+'</dd></div>').join('')+'</dl><details class="enrollment-extra"><summary>추가 정보</summary><dl>'+[['브릿지 앱',record.bridge],['보고된 층',record.reported_floor?floorText(record.reported_floor):'미수신'],['네트워크 IP',record.ip],['최근 수신',seenText(record.last_seen)],['기기 ID',record.id]].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+E(value)+'</dd></div>').join('')+'</dl></details></section><form id="enrollmentForm"><div class="enrollment-field"><label for="enrollStore">배정 지점</label><select id="enrollStore" name="store_id" required><option value="">지점을 선택해 주세요</option>'+stores.map(s=>'<option value="'+E(s.id)+'"'+(s.id===record.suggested_store?' selected':'')+'>'+E(s.name.replace(/^주렁주렁\s*/,''))+'</option>').join('')+'</select><small>접속 아이디는 참고 정보입니다. 실제 설치 지점을 확인해 주세요.</small></div><div class="enrollment-fields"><div class="enrollment-field"><label for="enrollName">기기 이름</label><input id="enrollName" name="label" maxlength="40" required placeholder="예: DT태블릿14" autocomplete="off"></div><div class="enrollment-field"><label for="enrollFloor">층 <small>선택</small></label><input id="enrollFloor" name="floor" type="number" min="-5" max="100" step="1" placeholder="예: 4" value="'+(record.reported_floor??'')+'"></div></div><p id="enrollmentError" role="alert"></p><footer><button type="button" data-enroll-close>취소</button><button type="submit" class="enrollment-submit">승인 및 등록</button></footer></form>';
 dialog.querySelectorAll('[data-enroll-close]').forEach(b=>b.onclick=()=>dialog.close());
 $('enrollStore').onchange=()=>{$('enrollFloor').value=$('enrollStore').value==='3'?'4':$('enrollStore').value?'1':''};
 $('enrollmentForm').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;$('enrollmentError').textContent='';
  try{const approved=StaticDemo.approveEnrollment(record.id,{store_id:form.elements.store_id.value,label:form.elements.label.value,floor:form.elements.floor.value});dialog.close();fleetLifecycle='active';if(fleetStoreFilter)fleetStoreFilter=approved.store_id;state.query='';$('search').value='';if(state.store!==approved.store_id)await switchStore(approved.store_id);else await refreshOperations();focusFleetResult(approved.id||record.id);}
  catch(error){$('enrollmentError').textContent=error.message}finally{button.disabled=false}
 };
 dialog.showModal();$('enrollName').focus();
}
document.addEventListener('click',event=>{const tab=event.target.closest('[data-lifecycle]');if(tab){fleetLifecycle=tab.dataset.lifecycle;state.query='';$('search').value='';render()}const approve=event.target.closest('[data-enroll]');if(approve)openEnrollment(approve.dataset.enroll)});

function enrollmentEvents(){const now=persistentPauseAt??Date.now();return (window.StaticDemo?.lifecycleEvents?StaticDemo.lifecycleEvents():[]).filter(row=>row.store===state.store&&row.stamp<=now&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.stamp))===eventDay)}

function lifecycleActionDialog(){
 let dialog=$('lifecycleAction');if(!dialog){dialog=document.createElement('dialog');dialog.id='lifecycleAction';dialog.className='enrollment-dialog lifecycle-action';dialog.setAttribute('aria-labelledby','lifecycleActionTitle');document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}})}return dialog;
}
function showLifecycleAction(id,kind){
 const d=kind==='retire'?managedDevices().find(d=>d.id===id):null,record=kind==='restore'?lifecycleRecords().find(r=>r.id===id&&r.status==='retired'):null;if(!d&&!record)return;
 const dialog=lifecycleActionDialog(),name=d?.name||record.label;
 const facts=record?'<div class="restore-destination"><span>복구 지점</span><strong>'+E(stores.find(s=>s.id===record.store_id)?.name.replace(/^주렁주렁\s*/,'')||'미지정')+'</strong></div>':'<p class="retire-description">운영중 목록과 지도에서 제외하고 폐기됨으로 이동합니다. 폐기됨에서 다시 되돌릴 수 있습니다.</p>';
 dialog.innerHTML='<header><div><span>'+(record?'폐기된 기기':'운영 기기 삭제')+'</span><h2 id="lifecycleActionTitle">'+E(name)+'</h2></div><button data-lifecycle-close type="button" aria-label="닫기">×</button></header>'+facts+'<p id="lifecycleActionError" role="alert"></p><div class="lifecycle-action-buttons"><button data-lifecycle-close type="button">취소</button><button id="confirmLifecycle" class="'+(record?'restore-action':'retire-action')+'" type="button">'+(record?'운영중으로 되돌리기':'삭제')+'</button></div>';
 dialog.querySelectorAll('[data-lifecycle-close]').forEach(button=>button.onclick=()=>dialog.close());
 $('confirmLifecycle').onclick=async()=>{const button=$('confirmLifecycle');if(button.disabled)return;button.disabled=true;try{if(record){StaticDemo.restoreDevice(id);fleetLifecycle='active';if(fleetStoreFilter)fleetStoreFilter=record.store_id}else StaticDemo.retireDevice(id,d.store);dialog.close();closePinPopover(false);state.query='';$('search').value='';await refreshOperations();if(record)focusFleetResult(id)}catch(error){$('lifecycleActionError').textContent=error.message}finally{button.disabled=false}};
 dialog.showModal();dialog.querySelector('[data-lifecycle-close]').focus();
}
document.addEventListener('click',event=>{const remove=event.target.closest('[data-retire-device]');if(remove)showLifecycleAction(remove.dataset.retireDevice,'retire');const retired=event.target.closest('[data-retired-device]');if(retired)showLifecycleAction(retired.dataset.retiredDevice,'restore')});

let fleetStoreFilter='',fleetSort='newest',fleetDetailDevice=null,scheduleTarget='',scheduleReadSequence=0;
function managedDevices(){return window.StaticDemo?.fleetDevices?StaticDemo.fleetDevices().map(d=>normalize(d,stores)):selected()}
function sortFleet(rows){
 const stamp=r=>{const raw=r.raw||r;return fleetSort==='updated'?Math.max(...[raw.last_seen_at,raw.last_seen,raw.retired_at,raw.approved_at].map(value=>Date.parse(value)||0)):(Date.parse(raw.retired_at||raw.first_seen_at||raw.first_seen)||0)};
 return [...rows].sort((a,b)=>(fleetSort==='oldest'?1:-1)*(stamp(a)-stamp(b))||String(a.id).localeCompare(String(b.id)));
}
function renderEnrollmentFleet(list){
 const records=lifecycleRecords(),pending=records.filter(r=>r.status==='pending'),retired=records.filter(r=>r.status==='retired'),active=list.filter(isOperating);
 const totals={active:active.filter(d=>!fleetStoreFilter||d.store===fleetStoreFilter).length,pending:pending.length,retired:retired.length};
 document.querySelectorAll('[data-lifecycle]').forEach(b=>{b.classList.toggle('active',b.dataset.lifecycle===fleetLifecycle);b.setAttribute('aria-selected',String(b.dataset.lifecycle===fleetLifecycle));b.querySelector('b').textContent=totals[b.dataset.lifecycle]});
 $('deviceRows').classList.toggle('lifecycle-grid',fleetLifecycle!=='active');document.querySelector('.fleet-controls').hidden=fleetLifecycle!=='active';$('fleetScope').hidden=true;$('fleetStoreFilter').hidden=fleetLifecycle!=='active';
 setMarkup($('fleetStoreFilter'),'<option value="">전체 지점</option>'+stores.map(s=>'<option value="'+E(s.id)+'"'+(fleetStoreFilter===s.id?' selected':'')+'>'+E(s.name.replace(/^주렁주렁\s*/,''))+'</option>').join(''));
 if(fleetLifecycle==='active')return false;
 const pool=fleetLifecycle==='pending'?pending:retired,query=state.query.toLowerCase(),filtered=sortFleet(pool.filter(r=>[r.label,r.id,r.account,r.model,r.bridge].join(' ').toLowerCase().includes(query)));
 
 setMarkup($('deviceRows'),filtered.length?filtered.map(renderLifecycleCard).join(''):'<div class="fleet-empty">'+(state.query?'검색 결과가 없습니다.':'표시할 기기가 없습니다.')+'</div>');
 $('tableFoot').textContent='';return true;
}
$('fleetStoreFilter').onchange=e=>{fleetStoreFilter=e.target.value;render()};

$('deviceStatus').addEventListener('close',()=>{fleetDetailDevice=null});
document.addEventListener('click',e=>{const button=e.target.closest('[data-retired-info]');if(button)openManagedDevice(button.dataset.retiredInfo,true)});
async function selectScheduleTarget(id){
 const seq=++scheduleReadSequence;scheduleTarget=id;$('scheduleSave').disabled=true;$('timeError').textContent='';
 $('startTime').value='';$('endTime').value='';updateScheduleDuration();
 try{const schedule=branchSchedules.get(id)||(id===state.store?serverSchedule:null)||parseSchedule(await api('/read/schedule?store_id='+encodeURIComponent(id)));if(seq!==scheduleReadSequence)return;if(!schedule)throw Error('운영시간을 확인할 수 없습니다.');$('startTime').value=schedule.start;$('endTime').value=schedule.end;updateScheduleDuration();$('scheduleSave').disabled=false}
 catch(error){if(seq===scheduleReadSequence)$('timeError').textContent=error.message}
}
$('scheduleStore').onchange=e=>selectScheduleTarget(e.target.value);
$('scheduleOpen').onclick=()=>{
 $('scheduleTitle').textContent='지점별 화면 운영시간';scheduleTarget=fleetStoreFilter||state.store;
 $('scheduleStore').innerHTML=stores.map(s=>'<option value="'+E(s.id)+'"'+(s.id===scheduleTarget?' selected':'')+'>'+E(s.name.replace(/^주렁주렁\s*/,''))+'</option>').join('');
 openModal('schedule');selectScheduleTarget(scheduleTarget);
};

function renderLifecycleCard(record){
 const pending=record.status==='pending',stamp=seenText(pending?record.first_seen:record.retired_at);
 const title=pending?record.model:record.label;
 return '<article class="fleet-device enrollment-card intake-card '+(pending?'intake-pending':'intake-retired')+'" role="listitem"><div class="intake-identity"><h3>'+E(title)+'</h3><p class="enrollment-account"><span class="intake-account-label">접속 ID</span><span>'+E(record.account)+'</span></p></div><div class="enrollment-time"><span>'+(pending?'최초 접수':'폐기')+'</span><time title="'+E(stamp)+'" datetime="'+E(pending?record.first_seen:record.retired_at)+'">'+E(stamp.replace(/^\d{4}-/,'').replace('-','.'))+'</time></div><div class="enrollment-actions">'+(pending?'<button class="enrollment-primary" data-enroll="'+E(record.id)+'" aria-label="'+E(title+' '+record.account+' 승인')+'">승인</button>':'<button class="enrollment-info" data-retired-info="'+E(record.id)+'">상세정보</button><button class="enrollment-primary" data-retired-device="'+E(record.id)+'">되돌리기</button>')+'</div></article>';
}

let fleetDetailScroll=0,fleetDetailReturn=null;
function fleetDeviceRecord(id,retired){
 if(!retired)return managedDevices().find(d=>d.id===id);
 const r=lifecycleRecords().find(r=>r.id===id&&r.status==='retired');
 return r?normalize({...r.last_device,...r.telemetry,device_id:r.id,label:r.label,store_id:r.store_id,floor:r.floor,status:'retired',online:0,last_seen_at:r.last_seen,bridge_app_version:r.bridge,login_account:r.account,device_model:r.model,_retiredAt:r.retired_at},stores):null;
}
function openManagedDevice(id,retired=false){
 if(fleetDetailDevice?.id===id&&!detailMotion?.closing){closeManagedDevice();return}cancelDetailMotion();const d=fleetDeviceRecord(id,retired);if(!d)return;
 fleetDetailScroll=document.scrollingElement?.scrollTop||0;fleetDetailReturn=document.activeElement;
 fleetDetailDevice=d;state.view='devices';closePinPopover(false);
 if($('deviceStatus').open)$('deviceStatus').close();
 fleetDetailDevice=d;render();
 $('fleetDetailTitle').focus({preventScroll:true});
 const panel=$('fleetDetailWorkspace');animateDeviceDetail(panel,false);if(panel?.getBoundingClientRect().height>0&&panel.getBoundingClientRect().bottom>window.innerHeight)panel.scrollIntoView?.({block:'nearest',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function closeManagedDevice(restore=true){
 const panel=$('fleetDetailWorkspace');
 const finish=()=>{fleetDetailDevice=null;$('devicesView').classList.remove('is-inspecting');if(panel)panel.hidden=true;
  document.querySelectorAll('.fleet-device.is-detail-selected').forEach(card=>{card.classList.remove('is-detail-selected');card.querySelectorAll('[aria-expanded]').forEach(button=>button.setAttribute('aria-expanded','false'))});updateOverlayScroll();
  if(restore){const replacement=[...document.querySelectorAll('[data-manage-device],[data-retired-info]')].find(n=>n.dataset.manageDevice===fleetDetailReturn?.dataset.manageDevice&&n.dataset.retiredInfo===fleetDetailReturn?.dataset.retiredInfo);(fleetDetailReturn?.isConnected?fleetDetailReturn:replacement)?.focus({preventScroll:true})}
 };
 if(!restore){cancelDetailMotion();finish();return}if(detailMotion?.closing)return;animateDeviceDetail(panel,true,finish);
}
function fleetDetailEvents(d){
 const now=Date.now(),day=eventDateKey(now),retired=d.raw.status==='retired';
 let pool=managedDevices().filter(x=>x.store===d.store);
 if(retired&&!pool.some(x=>x.id===d.id))pool.push(d);
 const generated=window.DemoEventStore?DemoEventStore.events(d.store,day,now,(i,stamp,id)=>createDeviceEvent(i,stamp,id,pool),resolvedEventPlans(pool)):(d.store===state.store?displayedEvents():[]);
 const ledger=window.StaticDemo?.lifecycleEvents?StaticDemo.lifecycleEvents():[];
 const cutoff=retired?Date.parse(d.raw._retiredAt):now;
 return [...generated,...ledger.filter(row=>row.store===d.store)].filter(row=>row.deviceId===d.id&&row.stamp<=cutoff&&eventDateKey(row.stamp)===day).sort((a,b)=>b.stamp-a.stamp).slice(0,5);
}
function renderManagedWorkspace(){
 const host=$('devicesView');
 if(!fleetDetailDevice||state.view!=='devices'){host.classList.remove('is-inspecting');if($('fleetDetailWorkspace'))$('fleetDetailWorkspace').hidden=true;return}
 const d=fleetDeviceRecord(fleetDetailDevice.id,fleetDetailDevice.raw.status==='retired');
 if(!d){closeManagedDevice(false);return}fleetDetailDevice=d;
 let panel=$('fleetDetailWorkspace');if(!panel){panel=document.createElement('section');panel.id='fleetDetailWorkspace';panel.setAttribute('aria-labelledby','fleetDetailTitle');host.append(panel)}
 panel.hidden=false;host.classList.remove('is-inspecting');
 const retired=d.raw.status==='retired',online=Number(d.raw.online)===1,unknown=d.raw.online==null;
 const status=retired?'폐기됨':online?'온라인':unknown?'연결 미확인':'오프라인';
 const check=retired?'':nextCheck(d),stamp=seenText(d.raw.last_seen_at),events=fleetDetailEvents(d);
 const name=E(d.name),branch=E(d.storeName.replace(/^주렁주렁\s*/,''));
 const identity=[['접속 계정',d.raw.login_account],['기기 모델',d.raw.device_model],['브릿지 앱',d.raw.bridge_app_version],['기기 ID',d.id]].filter(([,value])=>value);
 const identityOpen=panel.querySelector('.fd-identity')?.open;
 const html=
 '<header class="fd-heading"><div><div class="fd-location">'+branch+'<span>'+floorText(d.floor)+'</span></div><div class="fd-title-line"><h2 id="fleetDetailTitle" tabindex="-1">'+name+'</h2><span class="fd-status '+(online?'online':'')+'">'+connectionIndicator(d.raw)+status+'</span></div></div><div class="fd-heading-side">'+batteryGauge(d.raw.battery,d.raw)+'<span>'+(retired?'마지막 기록':'최근 신호 수신')+' <time title="'+E(stamp)+'">'+E(receiptLabel(d.raw.last_seen_at))+'</time></span></div></header>'+
 '<div class="fd-layout"><div class="fd-main"><section class="fd-screen '+(!online?'muted':'')+'"><span class="fd-section-label">'+(retired?'마지막 화면':'현재 화면')+'</span><strong>' +E(retired?(d.raw.current_screen_label||'화면 기록 없음'):online?d.screen:'전원 미상')+'</strong><div class="fd-screen-foot">'+(check?'<span class="fd-guidance"><i></i>'+E(check)+'</span>':retired?'<span>모니터링 종료</span>':'')+'</div></section>'+
 '<section class="fd-peripherals"><header><h3>연결 상태</h3>'+(!online?'<span>마지막 수신 기준</span>':'')+'</header><div class="fd-hardware">'+[['QR 리더','qr_status'],['카메라','camera_status'],['프린터','printer_status']].map(([label,key])=>{const raw=d.raw[key],on=['ok','error','no_paper'].includes(raw),state=on?'on':raw&&raw!=='unknown'?'off':'unknown',fault=['error','no_paper'].includes(raw);return '<div class="fd-port"><span>'+label+'</span><strong class="'+state+'"><i></i>'+(state==='unknown'?'—':state.toUpperCase())+'</strong>'+(fault?'<small>'+E(raw==='no_paper'?'용지 없음':'동작 오류')+'</small>':'')+'</div>'}).join('')+'</div></section></div>'+
 '<section class="fd-events"><header><h3>최근 이벤트</h3><span>'+eventDateKey().slice(5).replace('-','.')+' 오늘</span></header>'+(events.length?'<ol>'+events.map(row=>'<li class="'+(row.tone==='good'?'good':row.tone==='warn'?'warn':'neutral')+'"><time>'+exampleEventTime(row.stamp)+'</time><i></i><span>'+E(row.title)+'</span></li>').join('')+'</ol>':'<div class="fd-empty">오늘 기록된 이벤트가 없습니다.</div>')+'</section></div>'+
 '<footer class="fd-footer"><details class="fd-identity"'+(identityOpen?' open':'')+'><summary>등록 정보 <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><dl>'+identity.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+E(value)+'</dd></div>').join('')+'</dl></details>'+(retired?'<button class="fd-restore" data-retired-device="'+E(d.id)+'">운영중으로 되돌리기</button>':'<div class="fd-actions"><button type="button" class="fd-transfer" data-device-rename="'+E(d.id)+'"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 3.5 4 4M4 12l9-9a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-9 9-5 1 1-5Z"/></svg>기기명 수정</button><button type="button" class="fd-transfer" data-device-transfer="'+E(d.id)+'"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h13m-3-3 3 3-3 3M17 14H4m3-3-3 3 3 3"/></svg>지점 변경</button></div>')+'</footer>';
 setMarkup(panel,html);placeInlineDeviceDetail(panel);
}
document.addEventListener('click',event=>{if(event.target.closest('[data-fleet-back]'))closeManagedDevice();const view=event.target.closest('[data-view]');if(view&&fleetDetailDevice)closeManagedDevice(false)});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&fleetDetailDevice&&!document.querySelector('dialog[open]')){event.preventDefault();closeManagedDevice()}});

const scheduleBaselines=new Map();let scheduleOverviewLoading=false;
function renderScheduleOverview(){
 const host=$('scheduleOverview');if(!host||!user)return;
 setMarkup(host,stores.map(store=>{const hours=branchSchedules.get(store.id)||scheduleBaselines.get(store.id)||(store.id===state.store?serverSchedule:null);return '<div data-schedule-store="'+E(store.id)+'"><span>'+E(store.name.replace(/^주렁주렁\s*/,''))+'</span><strong>'+(hours?E(hours.start)+' <i>—</i> '+E(hours.end):scheduleBaselines.has(store.id)?'조회 불가':'조회 중')+'</strong></div>'}).join(''));
 const missing=stores.filter(s=>!scheduleBaselines.has(s.id));if(!missing.length||scheduleOverviewLoading)return;
 scheduleOverviewLoading=true;
 Promise.all(missing.map(async store=>{try{scheduleBaselines.set(store.id,parseSchedule(await api('/read/schedule?store_id='+encodeURIComponent(store.id))))}catch{scheduleBaselines.set(store.id,null)}})).finally(()=>{scheduleOverviewLoading=false;if(user)renderScheduleOverview()});
}
function placeInlineDeviceDetail(panel){
 const grid=$('deviceRows'),cards=[...grid.querySelectorAll(':scope > .fleet-device')];
 const target=cards.find(card=>[...card.querySelectorAll('[data-manage-device],[data-retired-info]')].some(button=>(button.dataset.manageDevice||button.dataset.retiredInfo)===fleetDetailDevice?.id));
 cards.forEach(card=>{card.classList.toggle('is-detail-selected',card===target);card.querySelectorAll('[data-manage-device],[data-retired-info]').forEach(button=>{button.setAttribute('aria-expanded',String(card===target));button.setAttribute('aria-controls','fleetDetailWorkspace')})});
 if(!target){panel.hidden=true;fleetDetailDevice=null;return}
 const top=target.getBoundingClientRect().top;
 const row=cards.filter(card=>Math.abs(card.getBoundingClientRect().top-top)<2);
 (row.at(-1)||target).after(panel);
}
window.addEventListener('resize',()=>{if(fleetDetailDevice&&$('fleetDetailWorkspace')){const panel=$('fleetDetailWorkspace');panel.remove();placeInlineDeviceDetail(panel)}});
// The thumb overlays the viewport. Native document wheel/touch/keyboard scrolling is retained.
const overlayScroll=document.createElement('div');overlayScroll.id='overlayScroll';overlayScroll.hidden=true;overlayScroll.setAttribute('role','scrollbar');overlayScroll.setAttribute('aria-label','페이지 스크롤');overlayScroll.setAttribute('aria-orientation','vertical');overlayScroll.setAttribute('aria-controls','liveContent');overlayScroll.tabIndex=0;overlayScroll.innerHTML='<span></span>';document.body.append(overlayScroll);document.documentElement.classList.add('overlay-document-scroll');
function updateOverlayScroll(){
 const root=document.scrollingElement||document.documentElement,max=Math.max(0,root.scrollHeight-window.innerHeight);overlayScroll.hidden=max===0||!user;
 const track=Math.max(0,window.innerHeight-88),height=Math.min(track,Math.max(36,track*window.innerHeight/Math.max(1,root.scrollHeight))),top=max?(track-height)*root.scrollTop/max:0;
 overlayScroll.firstElementChild.style.height=height+'px';overlayScroll.firstElementChild.style.transform='translateY('+top+'px)';overlayScroll.setAttribute('aria-valuemin','0');overlayScroll.setAttribute('aria-valuemax',String(max));overlayScroll.setAttribute('aria-valuenow',String(Math.round(root.scrollTop)));
}
let overlayDrag=null;
overlayScroll.addEventListener('pointerdown',event=>{const root=document.scrollingElement||document.documentElement,rect=overlayScroll.getBoundingClientRect(),thumb=overlayScroll.firstElementChild.getBoundingClientRect();overlayDrag=event.target===overlayScroll.firstElementChild?event.clientY-thumb.top:thumb.height/2;overlayScroll.setPointerCapture?.(event.pointerId);event.preventDefault();moveOverlayScroll(event)});
function moveOverlayScroll(event){if(overlayDrag===null)return;const root=document.scrollingElement||document.documentElement,rect=overlayScroll.getBoundingClientRect(),thumb=overlayScroll.firstElementChild.getBoundingClientRect();root.scrollTop=Math.max(0,Math.min(1,(event.clientY-rect.top-overlayDrag)/Math.max(1,rect.height-thumb.height)))*Math.max(0,root.scrollHeight-window.innerHeight);updateOverlayScroll()}
overlayScroll.addEventListener('pointermove',moveOverlayScroll);overlayScroll.addEventListener('pointerup',()=>{overlayDrag=null});overlayScroll.addEventListener('pointercancel',()=>{overlayDrag=null});
overlayScroll.addEventListener('keydown',event=>{const root=document.scrollingElement||document.documentElement,steps={ArrowDown:48,ArrowUp:-48,PageDown:window.innerHeight*.8,PageUp:-window.innerHeight*.8};if(event.key in steps){event.preventDefault();root.scrollTop+=steps[event.key]}else if(event.key==='Home'||event.key==='End'){event.preventDefault();root.scrollTop=event.key==='Home'?0:root.scrollHeight}updateOverlayScroll()});
window.addEventListener('scroll',updateOverlayScroll,{passive:true});window.addEventListener('resize',updateOverlayScroll);if(window.ResizeObserver)new ResizeObserver(updateOverlayScroll).observe(document.body);

let detailMotion=null,detailMotionToken=0;
function cancelDetailMotion(){detailMotionToken++;if(detailMotion){const panel=detailMotion.panel;detailMotion.animation.cancel();panel.classList.remove('detail-animating');detailMotion=null}}
function animateDeviceDetail(panel,closing,done){
 cancelDetailMotion();
 if(!panel||panel.hidden||!panel.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){done?.();return}
 const height=panel.getBoundingClientRect().height;if(!height){done?.();return}
 const style=getComputedStyle(panel),gap=getComputedStyle($('deviceRows')).rowGap;
 const expanded={height:height+'px',paddingTop:style.paddingTop,paddingBottom:style.paddingBottom,borderTopWidth:style.borderTopWidth,borderBottomWidth:style.borderBottomWidth,marginBottom:'0px',opacity:1};
 const collapsed={height:'0px',paddingTop:'0px',paddingBottom:'0px',borderTopWidth:'0px',borderBottomWidth:'0px',marginBottom:'-'+(parseFloat(gap)||0)+'px',opacity:0};
 const token=detailMotionToken;panel.classList.add('detail-animating');
 const animation=panel.animate(closing?[expanded,collapsed]:[collapsed,expanded],{duration:closing?240:280,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});
 detailMotion={panel,animation,closing};
 animation.finished.then(()=>{if(token!==detailMotionToken)return;detailMotion=null;panel.classList.remove('detail-animating');done?.();animation.cancel()},()=>{});
}

document.addEventListener('click',event=>{
 if(!fleetDetailDevice||state.view!=='devices'||!(event.target instanceof Element))return;
 if(event.target.closest('#fleetDetailWorkspace,.fleet-device,dialog,button,a,input,select,textarea,label,summary,#overlayScroll'))return;
 closeManagedDevice();
});

function receiptLabel(value){
 const stamp=seenText(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(stamp))return '기록 없음';
 if(stamp.slice(0,10)===eventDateKey())return stamp.slice(11,19);
 return (stamp.slice(0,4)===eventDateKey().slice(0,4)?stamp.slice(5,10):stamp.slice(0,10)).replaceAll('-','.')+' '+stamp.slice(11,16);
}
function focusFleetResult(id){
 const button=[...document.querySelectorAll('[data-manage-device]')].find(n=>n.dataset.manageDevice===id),card=button?.closest('.fleet-device');if(!card)return;
 card.classList.add('fleet-result-highlight');button.focus({preventScroll:true});if(card.getBoundingClientRect().height>0)card.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 setTimeout(()=>card.classList.remove('fleet-result-highlight'),2200);
}
function indicateScheduleSave(id){const cell=[...document.querySelectorAll('[data-schedule-store]')].find(n=>n.dataset.scheduleStore===id);if(!cell)return;cell.classList.add('schedule-just-saved');setTimeout(()=>cell.classList.remove('schedule-just-saved'),1800)}
document.addEventListener('click',event=>{
 if(!(event.target instanceof Element)||event.target.closest('button,a,input,select,textarea,summary'))return;
 const card=event.target.closest('.fleet-device:not(.enrollment-card)');if(!card||window.getSelection()?.toString())return;
 const trigger=card.querySelector('[data-manage-device]');if(trigger)openManagedDevice(trigger.dataset.manageDevice);
});

function openDeviceTransfer(id){
 const device=StaticDemo.fleetDevices().map(raw=>normalize(raw,stores)).find(d=>d.id===id);if(!device)return;
 let dialog=$('deviceTransfer');if(!dialog){dialog=document.createElement('dialog');dialog.id='deviceTransfer';dialog.className='enrollment-dialog device-transfer';dialog.setAttribute('aria-labelledby','transferTitle');document.body.append(dialog)}
 const branch=device.storeName.replace(/^주렁주렁\s*/,'');
 dialog.innerHTML='<header><div><span>기기 배치</span><h2 id="transferTitle">지점 변경</h2></div><button type="button" data-transfer-close aria-label="닫기">×</button></header><div class="transfer-device"><strong>'+E(device.name)+'</strong><span>'+E(branch)+' / '+floorText(device.floor)+'</span></div><form id="deviceTransferForm"><div class="transfer-fields"><div class="enrollment-field"><label for="transferStore">변경할 지점</label><select id="transferStore" required><option value="">지점 선택</option>'+stores.filter(s=>s.id!==device.store).map(s=>'<option value="'+E(s.id)+'">'+E(s.name.replace(/^주렁주렁\s*/,''))+'</option>').join('')+'</select></div><div class="enrollment-field"><label for="transferFloor">층</label><select id="transferFloor" required disabled><option value="">—</option></select></div></div><p id="transferPreview" class="transfer-preview">지점과 층을 선택해 주세요.</p><p id="transferError" role="alert"></p><footer><button type="button" data-transfer-close>취소</button><button type="submit" class="enrollment-submit" id="transferSubmit" disabled>지점 변경</button></footer></form>';
 const update=()=>{const target=stores.find(s=>s.id===$('transferStore').value);$('transferSubmit').disabled=!target;$('transferPreview').textContent=target?branch+' → '+target.name.replace(/^주렁주렁\s*/,'')+' / '+$('transferFloor').value+'F':'지점과 층을 선택해 주세요.';$('transferError').textContent=''};
 $('transferStore').onchange=()=>{const target=$('transferStore').value;$('transferFloor').disabled=!target;$('transferFloor').innerHTML=target?(target==='3'?[4,5]:[1]).map(f=>'<option value="'+f+'">'+f+'F</option>').join(''):'<option value="">—</option>';update()};
 $('transferFloor').onchange=update;
 dialog.querySelectorAll('[data-transfer-close]').forEach(button=>button.onclick=()=>{dialog.close();document.querySelector('[data-device-transfer]')?.focus({preventScroll:true})});
 $('deviceTransferForm').onsubmit=async event=>{
  event.preventDefault();const button=$('transferSubmit');if(button.disabled)return;button.disabled=true;
  try{const moved=StaticDemo.transferDevice(id,{from_store:device.store,store_id:$('transferStore').value,floor:$('transferFloor').value});dialog.close();cancelDetailMotion();localPlacements.delete(id);fleetLifecycle='active';if(fleetStoreFilter)fleetStoreFilter=moved.store_id;state.query='';$('search').value='';fleetDetailDevice=normalize(moved,stores);if(state.store!==moved.store_id)await switchStore(moved.store_id);else await refreshOperations();focusFleetResult(id);$('toast').textContent='지점을 변경했습니다.';$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2500)}
  catch(error){$('transferError').textContent=error.message;button.disabled=false}
 };
 dialog.showModal();$('transferStore').focus();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-device-transfer]');if(button)openDeviceTransfer(button.dataset.deviceTransfer)});

function openDeviceRename(id){
 const device=managedDevices().find(d=>d.id===id);if(!device)return;
 let dialog=$('deviceRename');if(!dialog){dialog=document.createElement('dialog');dialog.id='deviceRename';dialog.className='enrollment-dialog device-transfer';dialog.setAttribute('aria-labelledby','renameTitle');document.body.append(dialog)}
 dialog.innerHTML='<header><div><h2 id="renameTitle">기기명 수정</h2></div><button type="button" data-rename-close aria-label="닫기">×</button></header><form id="deviceRenameForm"><div class="enrollment-field"><label for="renameLabel">기기명</label><input id="renameLabel" maxlength="40" required autocomplete="off" value="'+E(device.name)+'"></div><p id="renameError" role="alert"></p><footer><button type="button" data-rename-close>취소</button><button type="submit" class="enrollment-submit">저장</button></footer></form>';
 dialog.querySelectorAll('[data-rename-close]').forEach(button=>button.onclick=()=>dialog.close());
 dialog.onclose=()=>document.querySelector('[data-device-rename]')?.focus({preventScroll:true});
 $('deviceRenameForm').onsubmit=async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
  try{const renamed=StaticDemo.renameDevice(id,$('renameLabel').value);dialog.close();fleetDetailDevice=normalize(renamed,stores);state.query='';$('search').value='';await refreshOperations();render();$('toast').textContent='기기명을 수정했습니다.';$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2500);document.querySelector('[data-device-rename]')?.focus({preventScroll:true})}
  catch(error){$('renameError').textContent=error.message;button.disabled=false}
 };
 $('renameLabel').oninput=()=>{$('renameError').textContent=''};dialog.showModal();$('renameLabel').focus();$('renameLabel').select();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-device-rename]');if(button)openDeviceRename(button.dataset.deviceRename)});
