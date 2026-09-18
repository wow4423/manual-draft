'use strict';
const viewer=document.getElementById('imageViewer'),photo=document.getElementById('viewerImage'),caption=document.getElementById('viewerCaption');
let opener=null;
document.addEventListener('click',event=>{const link=event.target.closest('.screen-open');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();opener=link;photo.src=link.getAttribute('href');photo.alt=link.querySelector('img').alt;caption.textContent=photo.alt;viewer.showModal();document.body.classList.add('viewing-image')});
document.getElementById('viewerClose').addEventListener('click',()=>viewer.close());
viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.close()});
viewer.addEventListener('close',()=>{document.body.classList.remove('viewing-image');photo.removeAttribute('src');opener?.focus({preventScroll:true})});


// Progressive enhancement: original screenshot pairs remain available without JS.
(()=>{
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 function build(before,after,label,initial=50){
  const host=document.createElement('div');host.className='comparison';
  const stage=document.createElement('div');stage.className='comparison-stage';stage.style.setProperty('--split',initial+'%');
  for(const [src,cls,alt] of [[after,'comparison-after','변경(안)'],[before,'comparison-before','기존']]){const img=document.createElement('img');img.src=src;img.alt=label+' '+alt;img.className=cls;img.draggable=false;img.loading='lazy';stage.append(img)}
  const line=document.createElement('span');line.className='comparison-line';line.setAttribute('aria-hidden','true');line.innerHTML='<span>‹ <i></i> ›</span>';stage.append(line);
  const range=document.createElement('input');range.type='range';range.min='0';range.max='100';range.value=String(initial);range.setAttribute('aria-label',label+' 기존 화면 표시 비율');stage.append(range);
  const badges=document.createElement('div');badges.className='comparison-badges';badges.innerHTML='<span>기존</span><span>변경(안)</span>';
  const update=value=>{range.value=String(value);stage.style.setProperty('--split',range.value+'%');range.setAttribute('aria-valuetext','기존 '+range.value+'%, 변경안 '+(100-Number(range.value))+'%');};
  range.oninput=()=>update(range.value);
  const move=e=>{const rect=stage.getBoundingClientRect();if(rect.width)update(Math.max(0,Math.min(100,Math.round((e.clientX-rect.left)/rect.width*100))))};
  range.addEventListener('pointerdown',e=>{if(e.button!==0)return;range.focus({preventScroll:true});range.setPointerCapture?.(e.pointerId);move(e);e.preventDefault()});
  range.addEventListener('pointermove',e=>{if(range.hasPointerCapture?.(e.pointerId))move(e)});
  range.addEventListener('pointerup',e=>{if(range.hasPointerCapture?.(e.pointerId))range.releasePointerCapture(e.pointerId)});
  host.append(badges,stage);update(initial);return host;
 }
 document.querySelectorAll('.screen-pair').forEach(pair=>{const imgs=pair.querySelectorAll('img');if(imgs.length!==2)return;const h=pair.closest('article').querySelector('h3').textContent;pair.before(build(imgs[0].getAttribute('src'),imgs[1].getAttribute('src'),h));pair.classList.add('comparison-fallback')});
 const progress=document.createElement('div');progress.className='reading-progress';progress.setAttribute('aria-hidden','true');document.body.append(progress);
 let scheduled=false;const track=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{const length=document.documentElement.scrollHeight-innerHeight;progress.style.transform='scaleX('+(length>0?Math.min(1,Math.max(0,scrollY/length)):0)+')';scheduled=false})};
 if(window.requestAnimationFrame){addEventListener('scroll',track,{passive:true});addEventListener('resize',track);track()}
})();

(()=>{
 document.querySelectorAll('.feature-media').forEach((media,index)=>{
  const figures=[...media.querySelectorAll('.screen-figure')];if(figures.length<2)return;
  media.classList.add('feature-gallery');const tabs=document.createElement('div');tabs.className='feature-gallery-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','기능 화면 선택');
  const activate=i=>{figures.forEach((f,j)=>{f.hidden=i!==j;const b=tabs.children[j];b.setAttribute('aria-selected',String(i===j));b.tabIndex=i===j?0:-1});};
  figures.forEach((figure,i)=>{const button=document.createElement('button');button.type='button';button.id='gallery-tab-'+index+'-'+i;figure.id='gallery-panel-'+index+'-'+i;figure.setAttribute('role','tabpanel');figure.setAttribute('aria-labelledby',button.id);button.setAttribute('role','tab');button.setAttribute('aria-controls',figure.id);button.textContent=figure.querySelector('figcaption').textContent;button.onclick=()=>activate(i);button.onkeydown=e=>{let n;if(e.key==='ArrowRight')n=(i+1)%figures.length;else if(e.key==='ArrowLeft')n=(i+figures.length-1)%figures.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=figures.length-1;else return;e.preventDefault();activate(n);tabs.children[n].focus()};tabs.append(button)});
  media.prepend(tabs);activate(0);
 });
})();


(()=>{
 document.querySelectorAll('.plan-disclosure').forEach(details=>{
  const summary=details.querySelector('summary');let animation=null,targetOpen=details.open;
  summary.addEventListener('click',event=>{
   if(!details.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
   event.preventDefault();const from=details.getBoundingClientRect().height;targetOpen=!targetOpen;
   if(animation){animation.onfinish=null;animation.cancel()}
   details.open=true;
   const to=targetOpen?details.getBoundingClientRect().height:summary.getBoundingClientRect().height+2;
   animation=details.animate([{height:from+'px'},{height:to+'px'}],{duration:260,easing:'cubic-bezier(.22,.7,.2,1)'});
   const current=animation;animation.onfinish=()=>{if(animation!==current)return;details.open=targetOpen;animation=null};
  });
  details.addEventListener('toggle',()=>{if(!animation)targetOpen=details.open});
 });
})();


(()=>{
 const nav=document.createElement('aside');nav.className='floating-doc-nav';nav.setAttribute('aria-label','문서 빠른 이동');
 const panel=document.createElement('nav');panel.id='floatingContents';panel.className='floating-contents';panel.hidden=true;panel.setAttribute('aria-label','상세 목차');
 const header=document.createElement('div');header.className='floating-contents-head';header.innerHTML='<strong>목차</strong>';const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','목차 닫기');header.append(dismiss);panel.append(header);
 const links=[];
 document.querySelectorAll('main>section').forEach((section,sectionIndex)=>{
  const group=document.createElement('div');group.className='floating-contents-group';const title=document.createElement('a');title.href='#'+section.id;title.textContent=String(sectionIndex+1).padStart(2,'0')+' '+section.querySelector('h2').textContent;title.className='floating-section';group.append(title);links.push([section,title]);
  section.querySelectorAll('article').forEach((article,index)=>{if(!article.id)article.id='plan-'+section.id+'-'+(index+1);const link=document.createElement('a');link.href='#'+article.id;link.textContent=article.querySelector('h3').textContent.replace(/^\d+\s*/,'');group.append(link);links.push([article,link])});panel.append(group);
 });
 const actions=document.createElement('div');actions.className='floating-doc-actions';const toggle=document.createElement('button');toggle.type='button';toggle.className='floating-toc-toggle';toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded','false');toggle.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1"/></svg>목차';
 const top=document.createElement('a');top.href='#top';top.className='floating-top';top.setAttribute('aria-label','문서 맨 위로 이동');top.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 5-5 5 5M10 5v11"/></svg>TOP';actions.append(toggle,top);nav.append(panel,actions);document.body.append(nav);
 const setOpen=open=>{panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};toggle.onclick=()=>setOpen(panel.hidden);dismiss.onclick=()=>{setOpen(false);toggle.focus()};
 nav.addEventListener('click',e=>{if(e.target.closest('a'))setOpen(false)});document.addEventListener('click',e=>{if(!nav.contains(e.target))setOpen(false)});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){setOpen(false);toggle.focus()}});
 if(window.IntersectionObserver){const visible=new Set();const observer=new IntersectionObserver(entries=>{entries.forEach(e=>e.isIntersecting?visible.add(e.target):visible.delete(e.target));const active=links.filter(([el])=>visible.has(el)).sort(([a],[b])=>Math.abs(a.getBoundingClientRect().top-100)-Math.abs(b.getBoundingClientRect().top-100))[0]?.[1];links.forEach(([,link])=>{if(link===active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current')})},{rootMargin:'-5% 0px -45% 0px',threshold:0});links.forEach(([el])=>observer.observe(el))}
})();

