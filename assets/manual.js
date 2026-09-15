(() => {
  const sections = [...document.querySelectorAll('main > [data-section]')];
  const links = [...document.querySelectorAll('.nav-link')];
  const groups = [...document.querySelectorAll('.nav-group')];
  const mobile = document.querySelector('.mobile-nav details');
  let scheduled = false;
  let previousSection;
  function setOpen(group, open) {
    group.querySelector('.nav-toggle').setAttribute('aria-expanded', String(open));
    group.querySelector('.nav-panel').inert = !open;
    group.classList.toggle('is-open', open);
  }
  groups.forEach((group, i) => {
    const button = group.querySelector('.nav-toggle');
    const panel = group.querySelector('.nav-panel');
    panel.id = `nav-panel-${i}`;
    button.setAttribute('aria-controls', panel.id);
    setOpen(group, false);
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      group.parentElement.querySelectorAll('.nav-group').forEach(sibling => setOpen(sibling, sibling === group && open));
    });
  });
  document.documentElement.classList.add('nav-ready');
  function update() {
    scheduled = false;
    const offset = window.innerWidth <= 850 ? 135 : 100;
    let active = sections[0].id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= offset) active = section.id;
    }
    for (const link of links) {
      const target = link.dataset.sectionLink || link.hash?.slice(1);
      if (target === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    if (active !== previousSection) {
      groups.forEach(group => setOpen(group, group.querySelector('.nav-toggle').dataset.sectionLink === active));
      previousSection = active;
    }
  }
  window.addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }, {passive:true});
  window.addEventListener('resize', update);
  document.querySelectorAll('.mobile-nav a').forEach(link => link.addEventListener('click', () => { mobile.open = false; }));
  const disclosureAnimations = new WeakMap();
  document.querySelectorAll('details.exception').forEach(details => {
    const summary = details.querySelector('summary');
    summary.addEventListener('click', event => {
      if (!details.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      event.preventDefault();
      const previous = disclosureAnimations.get(details);
      const opening = previous ? !previous.opening : !details.open;
      const from = details.getBoundingClientRect().height;
      if (previous) previous.animation.cancel();
      details.open = true;
      const to = opening ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height;
      details.style.overflow = 'hidden';
      const animation = details.animate([{height: `${from}px`}, {height: `${to}px`}], {
        duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)'
      });
      disclosureAnimations.set(details, {animation, opening});
      animation.onfinish = () => {
        if (disclosureAnimations.get(details)?.animation !== animation) return;
        details.open = opening;
        details.style.overflow = '';
        disclosureAnimations.delete(details);
      };
    });
  });
  function enhanceVideo(player, video) {
    const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    const playIcon = icon('<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>');
    const pauseIcon = icon('<path d="M9 5v14M16 5v14" stroke-width="3"/>');
    const soundIcon = icon('<path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>');
    const muteIcon = icon('<path d="M11 5 6 9H3v6h3l5 4zM16 9l6 6m0-6-6 6"/>');
    const toolbar = document.createElement('div');
    toolbar.className = 'media-toolbar'; toolbar.hidden = true;
    toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', `${video.getAttribute('aria-label')} 재생 조작`);
    toolbar.innerHTML = `<input class="media-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="영상 재생 위치" disabled><div class="media-toolbar-row"><button type="button" class="media-toggle" aria-label="재생">${playIcon}</button><button type="button" class="media-rewind" aria-label="10초 뒤로">${icon('<path d="M5 8a8 8 0 1 1-1 7M5 3v5h5"/>')}<span>10</span></button><span class="media-time">0:00 / 0:00</span><span class="media-toolbar-space"></span><button type="button" class="media-mute" aria-label="음소거" aria-pressed="false">${soundIcon}</button><label class="media-rate"><span class="sr-only">재생 속도</span><select aria-label="재생 속도"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" class="media-fullscreen" aria-label="전체 화면">${icon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>')}</button></div>`;
    player.append(toolbar);
    const seek = toolbar.querySelector('.media-seek'), toggle = toolbar.querySelector('.media-toggle');
    const mute = toolbar.querySelector('.media-mute'), rate = toolbar.querySelector('select');
    const full = toolbar.querySelector('.media-fullscreen'), time = toolbar.querySelector('.media-time');
    let active = false, failed = false, hideTimer;
    const duration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const format = n => { n = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; };
    function sync() {
      const total = duration(); seek.disabled = !total; seek.max = String(total);
      seek.value = String(Math.min(video.currentTime || 0,total));
      seek.style.setProperty('--played', `${total ? video.currentTime/total*100 : 0}%`);
      seek.setAttribute('aria-valuetext', `${format(video.currentTime)} / ${format(total)}`);
      time.textContent = `${format(video.currentTime)} / ${format(total)}`;
      toggle.innerHTML = video.paused ? playIcon : pauseIcon;
      toggle.setAttribute('aria-label', video.paused ? '재생' : '일시정지');
      mute.innerHTML = video.muted ? muteIcon : soundIcon;
      mute.setAttribute('aria-label', video.muted ? '소리 켜기' : '음소거');
      mute.setAttribute('aria-pressed', String(video.muted)); rate.value = String(video.playbackRate);
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      if (!active || video.paused || toolbar.contains(document.activeElement)) return;
      hideTimer = setTimeout(() => { if (!video.paused && !toolbar.contains(document.activeElement)) {toolbar.classList.add('is-idle');toolbar.inert = true;} }, 2800);
    }
    function reveal() { if (!active) return; toolbar.classList.remove('is-idle');toolbar.inert = false;scheduleHide(); }
    function fallback() { failed = true;active = false;clearTimeout(hideTimer);toolbar.hidden = true;toolbar.inert = true;video.controls = true; }
    async function togglePlay() {
      if (!video.paused) video.pause();
      else try { await video.play(); } catch { fallback(); }
      reveal();sync();
    }
    function moveTo(seconds) { if (duration()) video.currentTime = Math.min(duration(),Math.max(0,seconds));sync();reveal(); }
    toggle.addEventListener('click', togglePlay);
    toolbar.querySelector('.media-rewind').addEventListener('click', () => moveTo(video.currentTime-10));
    seek.addEventListener('input', () => moveTo(Number(seek.value)));
    mute.addEventListener('click', () => {video.muted = !video.muted;sync();reveal();});
    rate.addEventListener('change', () => {video.playbackRate = Number(rate.value);reveal();});
    if (!player.requestFullscreen && !video.webkitEnterFullscreen) full.hidden = true;
    full.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement === player) await document.exitFullscreen();
        else if (player.requestFullscreen) await player.requestFullscreen();
        else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      } catch {
        const message = player.querySelector('.intro-play-error');
        message.textContent = '이 환경에서는 전체 화면을 사용할 수 없습니다.';message.hidden = false;
      }
      reveal();
    });
    document.addEventListener('fullscreenchange', () => { full.setAttribute('aria-label',document.fullscreenElement === player ? '전체 화면 닫기' : '전체 화면');reveal(); });
    video.addEventListener('click', () => {if(active) togglePlay();});
    video.addEventListener('keydown', event => {
      if (!active || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === ' ' || event.key === 'k') {event.preventDefault();togglePlay();}
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault();moveTo(video.currentTime + (event.key === 'ArrowLeft' ? -5 : 5));}
    });
    for(const name of ['timeupdate','loadedmetadata','durationchange','volumechange','ratechange','seeked']) video.addEventListener(name,sync);
    for(const name of ['play','pause','ended']) video.addEventListener(name,()=>{sync();reveal();});
    player.addEventListener('pointermove',reveal);player.addEventListener('pointerdown',reveal);
    player.addEventListener('focusin',reveal);player.addEventListener('focusout',scheduleHide);
    video.addEventListener('error',fallback);
    return {start() {if(failed)return false;active = true;toolbar.hidden = false;video.controls = false;sync();reveal();return true;},fallback};
  }

  document.querySelectorAll('.video-player').forEach(player => {
    const introVideo = player.querySelector('video');
    const introCover = player.querySelector('.video-cover');
    const introError = player.querySelector('.intro-play-error');
    if (!introVideo || !introCover) return;
    const controller = enhanceVideo(player, introVideo);
    introCover.hidden = false;
    introVideo.controls = false;
    const showPlayer = () => {
      const coverFocused = document.activeElement === introCover;
      introCover.hidden = true;
      introVideo.controls = !controller.start();
      introError.hidden = true;
      if (coverFocused) introVideo.focus();
    };
    introVideo.tabIndex = 0;
    introVideo.addEventListener('playing', showPlayer);
    introCover.addEventListener('click', async () => {
      introCover.disabled = true;
      try {
        await introVideo.play();
        showPlayer();
      } catch {
        controller.fallback();
        showPlayer();
        introError.textContent = '재생 버튼을 다시 눌러주세요. 연결이 끊겼다면 페이지를 새로고침해 주세요.';
        introError.hidden = false;
      } finally {
        introCover.disabled = false;
      }
    });
    introVideo.addEventListener('error', () => {
      controller.fallback();
      showPlayer();
      introError.textContent = '영상을 불러오지 못했습니다. 연결을 확인한 뒤 페이지를 새로고침해 주세요.';
      introError.hidden = false;
    });
  });
  document.querySelectorAll('.credential-tip').forEach(tip => {
    const trigger = tip.querySelector('.credential-trigger');
    const bubble = tip.querySelector('.credential-tooltip');
    const show = () => { bubble.hidden = false; trigger.setAttribute('aria-expanded', 'true'); };
    const hide = () => { bubble.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    tip.addEventListener('mouseenter', show);
    tip.addEventListener('mouseleave', () => { if (!tip.contains(document.activeElement)) hide(); });
    tip.addEventListener('focusin', show);
    tip.addEventListener('focusout', event => { if (!tip.contains(event.relatedTarget)) hide(); });
    trigger.addEventListener('click', show);
    tip.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    document.addEventListener('pointerdown', event => { if (!tip.contains(event.target)) hide(); });
  });
  update();
})();
