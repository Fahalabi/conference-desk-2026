/* One offline SVG overview. All coordinates are preprojected through D3 Natural Earth I. */
(() => {
  'use strict';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const personName=p=>[p.firstName,p.lastName].filter(Boolean).join(' ')||'Name not provided';
  window.ConferenceWorld={create({people,onSelect}){
    const data=window.CONFERENCE_MAP,host=document.getElementById('world-map');
    if(!data){host.setAttribute('aria-busy','false');host.querySelector('p').textContent='Map unavailable. Use the country list or filters to explore your participants.';return {update(){}};}
    const $=id=>document.getElementById(id),byCode=new Map(data.countries.map(c=>[c.code,c]));
    const assigned=new Map(people.map(p=>[p.countryCode,p.country]));
    let records=null,summary=new Map(),hovered='',selected='',detailMotion=null;
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    host.innerHTML=`<svg id="attendance-map" viewBox="0 0 1100 550" role="group" aria-label="Interactive world attendance map" aria-describedby="map-description"><desc id="map-description">Orange countries have attending participants. Dim countries have none. Red halos mark countries with priority participants. Focus or hover over a country to read names. Activate it to filter the participant cards. Small countries have location dots.</desc><defs><filter id="priority-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs><g id="map-geometry"><path class="map-graticule" d="${data.graticule}"/>${data.countries.map(c=>`<path d="${c.path}" class="map-country is-dim" data-code="${esc(c.code)}" ${assigned.has(c.code)?`role="button" tabindex="${c.area<75?'-1':'0'}"`:'role="img"'} aria-label="${esc(assigned.get(c.code)||c.name)}"/>`).join('')}<g id="priority-halos" aria-hidden="true" pointer-events="none"></g><g id="small-country-points">${data.countries.filter(c=>c.area<75).map(c=>`<g class="map-point is-dim" data-code="${esc(c.code)}" transform="translate(${c.center})" role="button" tabindex="0" aria-label="${esc(assigned.get(c.code)||c.name)}"><circle class="point-hit" r="8"/><circle class="point-visible" r="3.8"/></g>`).join('')}</g></g></svg>`;
    const svg=$('attendance-map'),details=$('map-details');
    function revealDetails(){
      detailMotion?.cancel();
      if(!reducedMotion.matches&&details.animate)detailMotion=details.animate([{opacity:.5,translate:'0 4px'},{opacity:1,translate:'0 0'}],{duration:180,easing:'cubic-bezier(.22,.8,.25,1)'});
    }
    $('map-country').insertAdjacentHTML('beforeend',data.countries.map(c=>[c.code,assigned.get(c.code)||c.name]).sort((a,b)=>a[1].localeCompare(b[1])).map(([code,country])=>`<option value="${esc(code)}">${esc(country)}</option>`).join(''));
    function overview(){
      if(!records)return;
      const totals=window.ConferenceCore.totals(records,people),urgent=[...summary.values()].filter(c=>c.priority.length),unmapped=people.filter(p=>!byCode.has(p.countryCode)).length;
      details.innerHTML=`<div class="world-overview"><div class="overview-orbit"><span>${totals.attending}</span><small>attending</small></div><h3>Your world of participants</h3><p>Hover or tap a country to see who’s attending.</p>${unmapped?`<p class="unmapped-note">${unmapped} ${unmapped===1?'participant has':'participants have'} no country yet. Their cards are under “Country not provided.”</p>`:''}${urgent.length?`<div class="urgency-note"><span class="red-dot"></span>${totals.priority} priority ${totals.priority===1?'person':'people'} across ${urgent.length} ${urgent.length===1?'country':'countries'}</div><div class="priority-country-list">${urgent.map(g=>`<button data-focus-code="${g.code}"><span>${esc(g.country)}</span><strong>${g.priority.length}</strong></button>`).join('')}</div>`:`<div class="calm-note">${document.body.dataset.workspace==='OV'?'No priority follow-ups in the combined list.':'No priority cards right now.<br>Use the flag on a card to add urgency.'}</div>`}</div>`;
    }
    function show(code){
      if(!code){overview();return;}
      const c=byCode.get(code),g=summary.get(code);if(!c)return;
      const country=g?.country||c.name,attending=g?.attending||[],priority=g?.priority||[];
      const absent=g?g.people.length-attending.length:0;
      details.innerHTML=`<div class="spotlight-heading">${g?`<img src="assets/flags/${code}.svg" alt="">`:'<span class="empty-country-mark">◎</span>'}<div><h3>${esc(country)}</h3><p>${attending.length} attending${absent?` · ${absent} not attending`:''}</p></div></div>${priority.length?`<div class="urgency-note"><i class="red-dot"></i>${priority.length} priority ${priority.length===1?'participant':'participants'}</div>`:''}<div class="spotlight-scroll"><div class="spotlight-label">ATTENDING PARTICIPANTS</div>${attending.length?`<ul class="map-person-list">${attending.map(p=>`<li><span class="person-initial">${esc((p.firstName||'?').slice(0,1))}</span><span>${esc(personName(p))}</span>${records[p.id].priority?'<span class="person-urgent" title="Priority participant" aria-label="Priority">!</span>':''}</li>`).join('')}</ul>`:'<p class="no-attendees">No attending participants from this country in your assigned list.</p>'}${priority.some(p=>!records[p.id].attending)?`<div class="spotlight-label">PRIORITY · NOT ATTENDING</div><ul class="map-person-list">${priority.filter(p=>!records[p.id].attending).map(p=>`<li><span class="person-initial">${esc((p.firstName||'?').slice(0,1))}</span><span>${esc(personName(p))}</span><span class="person-urgent">!</span></li>`).join('')}</ul>`:''}</div>${g?`<button class="button spotlight-action" data-view-country="${esc(code)}">View ${g.people.length===1?'participant':g.people.length+' participants'} <span>↘</span></button>`:''}`;
    }
    function highlight(code){
      host.querySelectorAll('.is-hovered').forEach(el=>el.classList.remove('is-hovered'));
      if(code)host.querySelectorAll(`[data-code="${code}"]`).forEach(el=>el.classList.add('is-hovered'));
    }
    function explore(code){const changed=hovered!==code;hovered=code;highlight(code);show(code||selected);if(changed)revealDetails();}
    function select(code){selected=assigned.has(code)?code:'';hovered='';highlight(code);$('map-country').value=selected;show(code);if(assigned.has(code))onSelect(assigned.get(code));}
    reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)detailMotion?.finish();});
    svg.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const code=e.target.closest('[data-code]')?.dataset.code;if(code&&code!==hovered)explore(code);});
    // Keep the last explored country visible so its names and action stay reachable.
    svg.addEventListener('pointerleave',()=>{highlight(selected);});
    svg.addEventListener('focusin',e=>{const code=e.target.closest('[data-code]')?.dataset.code;if(code)explore(code);});
    svg.addEventListener('click',e=>{const code=e.target.closest('[data-code]')?.dataset.code;if(code){select(code);}});
    svg.addEventListener('keydown',e=>{
      const code=e.target.closest('[data-code]')?.dataset.code;
      if(code&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(code);}
      if(e.key==='Escape'){selected='';hovered='';$('map-country').value='';onSelect('');overview();}
    });
    $('map-country').onchange=e=>{const code=e.target.value;if(code){select(code);}else{selected='';hovered='';onSelect('');overview();}};
    details.addEventListener('click',e=>{const button=e.target.closest('[data-view-country],[data-focus-code]');if(!button)return;const code=button.dataset.viewCountry||button.dataset.focusCode;select(code);if(button.dataset.viewCountry)document.querySelector('.directory').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
    host.setAttribute('aria-busy','false');host.dataset.ready='true';
    return {update(nextRecords,filterCountry,nextPeople=people){
      if(nextPeople!==people){const changed=nextPeople.length!==people.length||nextPeople.some((p,i)=>p.id!==people[i]?.id);people=nextPeople;assigned.clear();people.forEach(p=>assigned.set(p.countryCode,p.country));if(changed){selected='';hovered='';}}
      records=nextRecords;summary=window.ConferenceCore.countrySummary(people,records);
      const active=[...summary.values()].filter(g=>g.attending.length&&byCode.has(g.code)),priority=[...summary.values()].filter(g=>g.priority.length&&byCode.has(g.code));
      $('map-active-count').textContent=active.length;$('map-priority-count').textContent=priority.length;
      for(const node of host.querySelectorAll('[data-code]')){
        const code=node.dataset.code,g=summary.get(code),country=g?.country||byCode.get(code).name;
        if(node.classList.contains('map-point'))node.style.display=g?'':'none';
        node.setAttribute('role',g?'button':'img');
        if(g)node.setAttribute('tabindex',node.classList.contains('map-country')&&byCode.get(code).area<75?'-1':'0');else node.removeAttribute('tabindex');
        node.classList.toggle('has-attendees',!!g?.attending.length);node.classList.toggle('is-dim',!g?.attending.length);node.classList.toggle('has-priority',!!g?.priority.length);node.classList.toggle('is-selected',country===filterCountry);
        node.setAttribute('aria-label',`${country}: ${g?.attending.length||0} attending${g?.priority.length?`, ${g.priority.length} priority`:''}`);
        if(node.getAttribute('role')==='button')node.setAttribute('aria-pressed',String(country===filterCountry));
      }
      $('priority-halos').innerHTML=priority.map(g=>{const c=byCode.get(g.code);return `<g class="priority-halo" data-priority-code="${g.code}"><path d="${c.path}"/><circle cx="${c.center[0]}" cy="${c.center[1]}" r="${c.area<75?18:23}"/></g>`;}).join('');
      selected=[...assigned].find(([,name])=>name===filterCountry)?.[0]||'';$('map-country').value=selected;
      highlight(selected||hovered);
      show(selected||hovered);
    }};
  }};
})();
