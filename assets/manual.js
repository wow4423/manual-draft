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
  update();
})();
