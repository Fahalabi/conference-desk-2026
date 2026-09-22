/* No remote requests, trackers, or third-party runtime dependencies. */
(() => {
  'use strict';
  const C=window.ConferenceCore,seedPeople=window.CONFERENCE_DATA.participants;
  let people=[...seedPeople],participantEdits={},savedUpdatedAt=null;
  const byId=new Map(people.map(p=>[p.id,p]));
  const CACHE='conference-desk:publishers-2026-farok:v1';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid=()=>crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
  const name=p=>[p.firstName,p.lastName].filter(Boolean).join(' ')||'Name not provided';
  const flag=p=>p.countryCode?`<img src="assets/flags/${p.countryCode}.svg" alt="" loading="lazy">`:'<span class="country-unknown" aria-hidden="true">◎</span>';
  const countryName=p=>p.country||'Country not provided';
  const countryCatalog=(window.CONFERENCE_MAP?.countries||[]).filter(c=>/^[a-z]{2}$/.test(c.code)).map(c=>({countryCode:c.code,country:seedPeople.find(p=>p.countryCode===c.code)?.country||c.name})).sort((a,b)=>a.country.localeCompare(b.country));
  const allCountries=countryCatalog.map(p=>p.country);
  const workspaces={FH:window.CONFERENCE_DATA.workspaces?.FH||'FH workspace',OV:'Participants · View only'};
  let workspace=new URL(location.href).searchParams.get('workspace')||'FH';if(workspace==='PR')workspace='OV';if(!workspaces[workspace])workspace='FH';
  let scopedPeople=C.scopePeople(people,workspace),countries=[...new Set(scopedPeople.map(p=>p.country))].sort((a,b)=>a.localeCompare(b)),serverRevision=-1,refreshing=false;
  let records=C.initialRecords(people), pending=[], backend=false, ready=false, saving=false, saveTimer, toastTimer, lastBackup=null, storageFailed=false, cacheDamaged=false, fatal=false;
  const expanded=new Set();
  const filters={search:'',country:'',attendance:'',priority:'',completion:''};
  let incomingBackup=null,drawerPanel='',drawerVisible=false,drawerMotion=null,lastMapState='';
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const easing='cubic-bezier(.22,.8,.25,1)';
  const cardViews=new Map(),groupViews=new Map(),noteMotions=new WeakMap();
  const animations=new Set();
  let visibleIds=new Set();
  function animate(node,frames,duration=240){
    if(reducedMotion.matches||!node.animate)return null;
    const animation=node.animate(frames,{duration,easing});animations.add(animation);
    const release=()=>animations.delete(animation);
    animation.addEventListener('finish',release,{once:true});animation.addEventListener('cancel',release,{once:true});
    return animation;
  }
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)for(const animation of [...animations])animation.finish();});
  const world=window.ConferenceWorld?.create({people,onSelect:country=>{
    filters.country=country;filters.search='';filters.attendance='';filters.priority='';filters.completion='';
    $('search').value='';renderAll();
  }});

  // One themed picker for every select. The hidden native value remains the
  // source of truth, so map selection, reset and existing filters stay in sync.
  let activePicker=null;
  const pickerViews=[];
  function enhanceSelect(select){
    const original=select.parentElement,label=original.querySelector('span');
    const shell=document.createElement('div');shell.className=original.className+' glass-select';
    original.replaceWith(shell);shell.append(...original.childNodes);
    const id=select.id,searchable=['map-country','filter-country','new-country'].includes(id);
    label.id=id+'-label';select.hidden=true;select.tabIndex=-1;
    const trigger=document.createElement('button');trigger.type='button';trigger.id=id+'-trigger';trigger.className='select-trigger';
    trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup',searchable?'dialog':'listbox');
    trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-labelledby',label.id+' '+id+'-value');
    trigger.innerHTML=`<span class="select-value" id="${id}-value"></span><svg class="select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>`;
    shell.append(trigger);
    const panel=document.createElement('div');panel.className='select-popover';panel.id=id+'-popup';panel.hidden=true;
    // A top-layer popover avoids clipping by the map's translucent containers.
    const topLayer=typeof panel.showPopover==='function';if(topLayer)panel.setAttribute('popover','manual');
    if(searchable){panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby',label.id);}
    panel.innerHTML=searchable?`<div class="select-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" role="combobox" aria-label="Search countries" aria-autocomplete="list" aria-expanded="true" autocomplete="off" spellcheck="false" placeholder="Find a country…"></div>`:'';
    const list=document.createElement('div');list.className='select-options';list.id=id+'-options';list.setAttribute('role','listbox');list.setAttribute('aria-labelledby',label.id);panel.append(list);
    const empty=document.createElement('p');empty.className='select-no-results';empty.textContent='No countries found';empty.setAttribute('role','status');empty.hidden=true;panel.append(empty);
    const search=panel.querySelector('input');search?.setAttribute('aria-controls',list.id);
    trigger.setAttribute('aria-controls',searchable?panel.id:list.id);(select.closest('dialog')||document.body).append(panel);
    const options=[...select.options].map((option,index)=>{
      const node=document.createElement('div');node.id=id+'-option-'+index;node.className='select-option';node.setAttribute('role','option');node.dataset.value=option.value;
      const country=countryCatalog.find(p=>id==='map-country'||id==='new-country'?p.countryCode===option.value:p.country===option.value);
      const icon=searchable?(country?flag(country):'<span class="select-world" aria-hidden="true">◎</span>'):'';
      node.innerHTML=`${icon}<span class="select-option-label">${esc(option.textContent)}</span><svg class="select-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>`;
      list.append(node);return {node,value:option.value,text:option.textContent,country,source:option};
    });
    let opened=false,filtered=options,active=-1,typeahead='',typeTimer,positionFrame=0;
    const controller=search||trigger;
    function setActive(index,scroll=true){
      active=index;
      options.forEach(o=>o.node.classList.toggle('is-active',o===filtered[active]));
      const option=filtered[active];
      if(option){controller.setAttribute('aria-activedescendant',option.node.id);if(scroll)option.node.scrollIntoView({block:'nearest'});}
      else controller.removeAttribute('aria-activedescendant');
    }
    function sync(){
      const current=options.find(o=>o.value===select.value)||options[0];
      if(!current)return;
      const value=trigger.querySelector('.select-value');
      if(value.dataset.value!==current.value){value.dataset.value=current.value;value.innerHTML=`${searchable&&current.country?flag(current.country):''}<span>${esc(current.text)}</span>`;}
      trigger.disabled=select.disabled;
      options.forEach(o=>{const selected=o.value===select.value;o.node.setAttribute('aria-selected',String(selected));o.node.classList.toggle('is-selected',selected);});
    }
    function position(){
      if(!opened)return;
      const rect=shell.getBoundingClientRect(),viewport=window.visualViewport;
      const leftEdge=viewport?.offsetLeft||0,topEdge=viewport?.offsetTop||0;
      const width=viewport?.width||innerWidth,height=viewport?.height||innerHeight,gap=8,gutter=12;
      const menuWidth=Math.min(Math.max(rect.width,searchable?280:238),width-gutter*2);
      panel.style.width=menuWidth+'px';panel.style.left=Math.max(leftEdge+gutter,Math.min(rect.left,leftEdge+width-menuWidth-gutter))+'px';
      const below=topEdge+height-rect.bottom-gap-gutter,above=rect.top-topEdge-gap-gutter;
      const up=below<Math.min(320,panel.scrollHeight)&&above>below;
      const available=Math.max(80,up?above:below);panel.style.maxHeight=Math.min(400,available)+'px';
      const menuHeight=panel.getBoundingClientRect().height;
      panel.style.top=Math.max(topEdge+gutter,Math.min(up?rect.top-gap-menuHeight:rect.bottom+gap,topEdge+height-menuHeight-gutter))+'px';
      panel.dataset.side=up?'above':'below';
    }
    function close(restoreFocus=false){
      if(!opened)return;opened=false;
      trigger.setAttribute('aria-expanded','false');controller.removeAttribute('aria-activedescendant');shell.classList.remove('is-open');
      if(restoreFocus)trigger.focus({preventScroll:true});
      if(topLayer)panel.hidePopover();panel.hidden=true;
      if(activePicker===view)activePicker=null;
      clearTimeout(typeTimer);typeahead='';
    }
    function open(){
      if(opened||trigger.disabled)return;
      activePicker?.close();opened=true;activePicker=view;filtered=options.filter(o=>!o.source.hidden);
      if(search)search.value='';options.forEach(o=>o.node.hidden=o.source.hidden);empty.hidden=true;sync();
      trigger.setAttribute('aria-expanded','true');shell.classList.add('is-open');panel.hidden=false;
      if(topLayer)panel.showPopover();position();
      controller.focus({preventScroll:true});setActive(Math.max(0,filtered.findIndex(o=>o.value===select.value)));
      animate(panel,[{opacity:0,translate:panel.dataset.side==='above'?'0 5px':'0 -5px',scale:'.985'},{opacity:1,translate:'0 0',scale:'1'}],180);
    }
    function commit(option){
      if(!option)return;const changed=select.value!==option.value;select.value=option.value;close(true);sync();
      if(changed)select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    function keydown(e){
      if(e.isComposing||e.ctrlKey||e.metaKey)return;
      if(e.key==='Escape'&&opened){e.preventDefault();e.stopPropagation();close(true);return;}
      if(e.key==='Tab'&&opened){close(true);return;}
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){
        e.preventDefault();if(!opened){open();return;}
        setActive(Math.max(0,Math.min(filtered.length-1,active+(e.key==='ArrowDown'?1:-1))));return;
      }
      if(e.key==='Enter'||(e.key===' '&&e.target===trigger)){
        e.preventDefault();if(opened)commit(filtered[active]);else open();return;
      }
      if(e.target===trigger&&(e.key==='Home'||e.key==='End')){e.preventDefault();open();setActive(e.key==='Home'?0:filtered.length-1);return;}
      if(e.target===trigger&&e.key.length===1&&!e.altKey){
        e.preventDefault();open();
        if(search){search.value=e.key;search.dispatchEvent(new Event('input'));return;}
        clearTimeout(typeTimer);typeahead+=e.key.toLocaleLowerCase();typeTimer=setTimeout(()=>typeahead='',600);
        const index=filtered.findIndex(o=>o.text.toLocaleLowerCase().startsWith(typeahead));if(index>=0)setActive(index);
      }
    }
    trigger.onclick=()=>opened?close():open();trigger.addEventListener('keydown',keydown);search?.addEventListener('keydown',keydown);
    search?.addEventListener('input',()=>{
      const normalize=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
      const query=normalize(search.value.trim());filtered=options.filter(o=>!o.source.hidden&&normalize(o.text).includes(query));
      options.forEach(o=>o.node.hidden=!filtered.includes(o));empty.hidden=filtered.length>0;
      setActive(filtered.length?0:-1,false);list.scrollTop=0;position();
    });
    // Keep focus on the combobox while clicking a list option; touch can still scroll.
    list.addEventListener('mousedown',e=>e.preventDefault());
    list.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;const node=e.target.closest('.select-option');if(node){const index=filtered.findIndex(o=>o.node===node);if(index!==active)setActive(index,false);}});
    list.addEventListener('click',e=>commit(options.find(o=>o.node===e.target.closest('.select-option'))));
    document.addEventListener('pointerdown',e=>{if(opened&&!shell.contains(e.target)&&!panel.contains(e.target))close();},true);
    const blur=e=>{if(opened&&!shell.contains(e.relatedTarget)&&!panel.contains(e.relatedTarget))close();};
    shell.addEventListener('focusout',blur);panel.addEventListener('focusout',blur);
    const reposition=e=>{if(!opened||(e.target instanceof Node&&panel.contains(e.target)))return;cancelAnimationFrame(positionFrame);positionFrame=requestAnimationFrame(position);};
    window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
    window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);
    select.addEventListener('change',sync);
    const view={sync,close};sync();return view;
  }

  function cache() {
    if(fatal)return;
    try{localStorage.setItem(CACHE,JSON.stringify({schemaVersion:1,datasetId:C.DATASET,addedParticipants:people.filter(p=>p.added),participantEdits,records,pending,lastBackup}));storageFailed=false;}
    catch{storageFailed=true;}
  }
  function status() {
    const warning=$('save-error');
    if(fatal){$('save-status').className='save-status failed';$('save-status').lastElementChild.textContent='Saved progress needs attention';return;}
    let label=backend?'Saved to this computer':'Saved in this browser';
    let level='';
    warning.hidden=true;
    if(backend&&pending.length){label='Saving changes…';level='pending';}
    if(storageFailed){warning.hidden=false;warning.textContent=backend&&!pending.length?'Browser storage is unavailable. Your progress is saved in the local progress file.':'Browser storage is unavailable. Export a backup now to protect your changes.';level='failed';}
    if(backend&&pending.length&&window.navigator.onLine===false){label='Waiting to save to file';}
    $('save-status').className='save-status '+level;
    $('save-status').lastElementChild.textContent=label;
  }
  function toast(message,undo) {
    const node=$('toast');node.textContent=message;node.hidden=false;
    if(undo){const b=document.createElement('button');b.className='button';b.style.marginLeft='12px';b.textContent='Undo';b.onclick=()=>{undo();node.hidden=true;};node.append(b);}
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,undo?10000:4000);
  }
  async function api(path,options={}) {
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
    try{return await fetch(path,{cache:'no-store',...options,headers:{...options.headers,'X-Conference-Roster':'3'},signal:controller.signal});}finally{clearTimeout(timeout);}
  }
  function syncRoster(){
    people.sort((a,b)=>(a.country||'\uffff').localeCompare(b.country||'\uffff')||name(a).localeCompare(name(b)));
    byId.clear();people.forEach(p=>byId.set(p.id,p));updateWorkspace();
  }
  function adoptSaved(saved){
    const next=C.mergePeople(seedPeople,saved.addedParticipants||[],saved.participantEdits||{}),nextRecords=C.validateRecords(saved.records,next);
    participantEdits=saved.participantEdits||{};savedUpdatedAt=saved.updatedAt;
    people=next;records=nextRecords;
    for(const op of pending){records=C.apply(records,op,people);if(op.kind==='restore')participantEdits={...participantEdits,...Object.fromEntries(Object.entries(op.participantEdits||{}).filter(([id])=>C.owners(people.find(p=>p.id===id)||{}).includes('FH')))};}
    syncRoster();serverRevision=saved.revision;
  }
  async function flush() {
    if(!backend||saving||!pending.length||fatal)return;
    saving=true;status();
    const batch=pending.slice(0,500);
    try{
      const response=await api('api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Conference-Client':'local-dashboard'},body:JSON.stringify({datasetId:C.DATASET,operations:batch})});
      const saved=await response.json();if(!response.ok)throw new Error(saved.error||'Could not save the progress file.');
      const acknowledged=new Set(batch.map(o=>o.id));pending=pending.filter(o=>!acknowledged.has(o.id));
      adoptSaved(saved);cache();renderAll();status();
    }catch(error){
      $('save-status').className='save-status pending';$('save-status').lastElementChild.textContent=storageFailed?'Changes need a backup':'Saved in browser · file update pending';
      $('save-error').hidden=false;$('save-error').textContent=`The local progress file could not be updated. ${storageFailed?'Export a backup now.':'Your changes remain in this browser and will retry automatically.'} ${error.message}`;
    }finally{saving=false;}
    if(pending.length)setTimeout(flush,2500);
  }
  function change(operations,render=true) {
    if(!ready||fatal||workspace!=='FH')return;
    for(const action of operations){const op={...action,id:uid(),workspace};records=C.apply(records,op,people);pending.push(op);}
    for(const op of operations)if(op.kind==='restore'){participantEdits={...participantEdits,...Object.fromEntries(Object.entries(op.participantEdits||{}).filter(([id])=>C.owners(people.find(p=>p.id===id)||{}).includes('FH')))};syncRoster();}
    // Local-only deployments need no server queue; their authoritative state is the browser cache.
    if(!backend)pending=[];
    cache();status();if(render)renderAll();
    clearTimeout(saveTimer);saveTimer=setTimeout(flush,250);
  }
  function setField(person,field,value,render=true){change([{kind:'set',person,field,value}],render);}
  function renderStats(){
    const t=C.totals(records,scopedPeople);
    $('stat-total').textContent=t.total;$('nav-total').textContent=t.total;$('nav-priority').textContent=t.priority;$('nav-absent').textContent=t.notAttending;
    $('stat-attendance').textContent=`${t.attending} attending · ${t.notAttending} not attending`;
    document.querySelectorAll('.attending-total').forEach(el=>el.textContent=t.attending);
    $('visa-total').textContent=t.visaRequired;
    for(const key of ['visa','flight','hotel']){const total=key==='visa'?t.visaRequired:t.attending;$('stat-'+key).textContent=t[key];$('meter-'+key).style.width=(total?t[key]/total*100:0)+'%';$('remaining-'+key).textContent=`${total-t[key]} remaining`;}
  }
  function renderReports(){
    if(workspace!=='OV')return;
    const all=C.totals(records,people),ready=list=>list.filter(p=>{const r=records[p.id];return r.attending&&(r.visaRequired===false||r.visa)&&r.flight&&r.hotel;}).length;
    const names=[...new Set(people.map(p=>p.country))].sort((a,b)=>(a||'\uffff').localeCompare(b||'\uffff'));
    const missing=people.filter(p=>!p.country).length;
    $('report-countries').textContent=names.filter(Boolean).length;
    $('report-unassigned').textContent=missing?`${missing} ${missing===1?'participant has':'participants have'} no country yet`:'Across both guest lists';
    $('report-priority').textContent=all.priority;$('report-ready').textContent=ready(people);$('report-waived').textContent=all.attending-all.visaRequired;
    $('report-country-count').textContent=names.length+' groups';
    const rows=names.map(country=>{const list=people.filter(p=>p.country===country),t=C.totals(records,list);return `<tr><th scope="row">${esc(country||'Country not provided')}</th><td>${t.total}</td><td>${t.attending}</td><td>${t.notAttending}</td><td>${t.priority}</td><td>${t.visa} / ${t.visaRequired}</td><td>${t.flight} / ${t.attending}</td><td>${t.hotel} / ${t.attending}</td><td>${ready(list)}</td></tr>`;}).join('');
    if($('country-report-body').innerHTML!==rows)$('country-report-body').innerHTML=rows;
    $('report-updated').textContent='Reports cover the full combined list, independent of the card filters.'+(savedUpdatedAt?' Last saved '+new Date(savedUpdatedAt).toLocaleString()+'.':'');
  }
  function noteHtml(p,n){
    return `<div class="note-row ${n.done?'completed':''}" data-note="${esc(n.id)}"><input type="checkbox" data-action="note-done" ${n.done?'checked':''} aria-label="Mark note complete for ${esc(name(p))}"><div class="note-main"><textarea data-action="note-text" aria-label="Edit note for ${esc(name(p))}" ${workspace==='OV'?'readonly':''} maxlength="20000">${esc(n.text)}</textarea><div class="note-footer"><span class="note-time">${esc(new Date(n.createdAt).toLocaleDateString(undefined,{day:'numeric',month:'short'}))}${n.done?' · Done':''}</span><label class="note-reviewed"><input type="checkbox" data-action="note-reviewed" ${n.reviewed?'checked':''} aria-label="Mark note reviewed for ${esc(name(p))}">Reviewed</label></div></div><button class="note-delete" data-action="note-delete" ${workspace==='OV'?'hidden':''} aria-label="Delete note for ${esc(name(p))}" title="Delete note">×</button></div>`;
  }
  function cardHtml(p){
    if(workspace==='OV')return `<article class="participant-mini" data-person="${esc(p.id)}" aria-label="${esc(name(p))}"><h4 class="person-name">${esc(name(p))}</h4><p class="organization">${esc(p.organization||'Organization not provided')}</p><div class="mini-country">${flag(p)}<span>${esc(countryName(p))}</span></div></article>`;
    const r=records[p.id], fullName=name(p),required=r.visaRequired?['visa','flight','hotel']:['flight','hotel'],done=required.filter(k=>r[k]).length,pr=workspace==='OV';
    const source=p.sourceStatus,reference=source?[source.visa&&'Visa: '+source.visa,source.flight&&'Flight: '+source.flight,source.remarks].filter(Boolean).join(' · '):'';
    return `<article class="card ${r.priority?'priority':''} ${r.attending?'':'not-attending'}" data-person="${esc(p.id)}" aria-label="${esc(fullName)}"><div class="card-body"><div class="card-top"><div><h4 class="person-name">${esc(fullName)}</h4><div class="organization">${esc(p.organization||'Organization not provided')}</div></div><div class="card-actions"><button class="edit-participant" data-action="edit-person" aria-label="Edit details for ${esc(fullName)}" title="Edit participant details"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4 4 4M4 13l9-9a2 2 0 0 1 3 3l-9 9-4 1 1-4Z"/></svg><span>Edit</span></button><button class="visa-requirement ${r.visaRequired?'required':'waived'}" data-action="visa-required" aria-pressed="${r.visaRequired}" aria-label="Visa requirement for ${esc(fullName)}: ${r.visaRequired?'required':'not required'}" ${pr?'disabled':''}><i></i>${r.visaRequired?'Visa required':'Not required'}</button><button class="priority-button" data-action="priority" aria-pressed="${r.priority}" aria-label="Priority for ${esc(fullName)}" ${pr?'disabled':''} title="${r.priority?'Remove priority':'Mark as priority'}">⚑</button></div></div>
      <div class="card-country">${flag(p)}<span>${esc(countryName(p))}</span><span class="owner-tag">${C.owners(p).map(esc).join(' · ')}</span></div>
      ${p.contactReview?`<p class="contact-review">${esc(p.contactReview)}</p>`:''}
      <div class="contact-line"><svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="4" width="14" height="10" rx="2"/><path d="m3 5 6 5 6-5"/></svg>${p.email?`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`:'<span class="missing">Email not provided</span>'}</div>
      <div class="contact-line"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 2h3l1 4-2 1c1 3 2 4 5 5l1-2 4 1v3c0 2-3 2-5 1C6 13 3 9 2 5c0-2 0-3 2-3Z"/></svg><span class="contact-phones">${p.phones.length?p.phones.map(phone=>`<a href="tel:${esc(phone.replace(/[^+\d]/g,''))}">${esc(phone)}</a>`).join(''):'<span class="missing">Phone not provided</span>'}</span></div>
      <div class="attendance-row"><button class="attendance ${r.attending?'':'off'}" data-action="attendance" ${pr?'disabled':''} aria-pressed="${r.attending}" aria-label="Attendance for ${esc(fullName)}: ${r.attending?'attending':'not attending'}" title="Click to change attendance"><i></i>${r.attending?'Attending':'Not attending'}<span aria-hidden="true">⌄</span></button><span class="completion-count ${done===required.length?'done':''}">${done}/${required.length} complete</span></div>
      <div class="arrangements">${[['visa','Visa'],['flight','Flight'],['hotel','Hotel']].map(([key,label])=>`<label class="arrangement"><input type="checkbox" data-action="arrangement" data-field="${key}" ${r[key]?'checked':''} ${key==='visa'&&!r.visaRequired?'disabled':''} aria-label="${label} complete for ${esc(fullName)}"><span>${key==='visa'&&!r.visaRequired?'Visa · N/A':label}</span></label>`).join('')}</div></div>
      <details class="notes" ${expanded.has(p.id)?'open':''}><summary><span>Notes <span class="note-count">${r.notes.length?`(${r.notes.length})`:''}${r.draft?' · draft':''}</span></span><span class="chevron" aria-hidden="true">⌄</span></summary><div class="notes-content">${reference?`<div class="source-reference"><strong>From the working list</strong><p>${esc(reference)}</p></div>`:''}<div class="note-list">${r.notes.length?r.notes.map(n=>noteHtml(p,n)).join(''):'<p class="note-empty">No follow-up notes yet.</p>'}</div><div class="note-compose" ${pr?'hidden':''}><textarea data-action="draft" placeholder="Add a note or follow-up…" aria-label="New note for ${esc(fullName)}" maxlength="20000">${esc(r.draft)}</textarea><div class="compose-bottom"><span>Draft saves automatically</span><button class="button" data-action="add-note">+ Add note</button></div></div>${pr&&r.draft?`<p class="shared-draft"><strong>Draft</strong> ${esc(r.draft)}</p>`:''}</div></details></article>`;
  }
  function element(html){const template=document.createElement('template');template.innerHTML=html;return template.content.firstElementChild;}
  // Preserve existing controls and their focus/caret instead of replacing every card.
  function patchNode(current,next){
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName||
      (current.nodeType===1&&current.getAttribute('data-note')!==next.getAttribute('data-note'))){current.replaceWith(next);return;}
    if(current.nodeType===3){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
    if(current.nodeType!==1)return;
    const movingNotes=noteMotions.has(current);
    for(const attribute of [...current.attributes]){
      if(movingNotes&&['open','style'].includes(attribute.name))continue;
      if(!next.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
    }
    for(const attribute of next.attributes){
      if(movingNotes&&attribute.name==='open')continue;
      if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
    }
    if(current instanceof HTMLInputElement&&current.checked!==next.checked)current.checked=next.checked;
    if(current instanceof HTMLTextAreaElement){if(current.value!==next.value)current.value=next.value;return;}
    const oldChildren=[...current.childNodes],newChildren=[...next.childNodes];
    for(let i=0;i<Math.max(oldChildren.length,newChildren.length);i++){
      if(!oldChildren[i])current.append(newChildren[i]);
      else if(!newChildren[i])oldChildren[i].remove();
      else patchNode(oldChildren[i],newChildren[i]);
    }
  }
  function orderChildren(parent,nodes){
    let cursor=parent.firstChild;
    for(const node of nodes){if(node===cursor)cursor=cursor.nextSibling;else parent.insertBefore(node,cursor);}
    while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
  }
  function renderDirectory(visible){
    const groups=[],entering=[],nextIds=new Set(visible.map(p=>p.id));
    for(const country of countries){
      const group=visible.filter(p=>p.country===country);if(!group.length)continue;
      let section=groupViews.get(country);
      if(!section){
        section=element(`<section class="country-group"><div class="group-heading">${flag(group[0])}<h3>${esc(country||'Country not provided')}</h3><span class="group-count"></span><span class="group-rule"></span></div><div class="cards"></div></section>`);
        groupViews.set(country,section);
      }
      const label=`${group.length} ${group.length===1?'participant':'participants'}`,count=section.querySelector('.group-count');
      if(count.textContent!==label)count.textContent=label;
      const cards=group.map(p=>{
        const key=JSON.stringify([p,records[p.id],expanded.has(p.id),workspace]);let view=cardViews.get(p.id);
        if(!view){view={node:element(cardHtml(p)),key};cardViews.set(p.id,view);}
        else if(view.key!==key){patchNode(view.node,element(cardHtml(p)));view.key=key;}
        if(!visibleIds.has(p.id))entering.push(view.node);
        return view.node;
      });
      orderChildren(section.querySelector('.cards'),cards);groups.push(section);
    }
    orderChildren($('participants'),groups);visibleIds=nextIds;
    // Only animate cards that actually enter the visible viewport, never all 124.
    if(!reducedMotion.matches){let count=0;for(const node of entering){const rect=node.getBoundingClientRect();if(rect.bottom>0&&rect.top<innerHeight){animate(node,[{opacity:0,translate:'0 7px'},{opacity:1,translate:'0 0'}],200);if(++count===12)break;}}}
  }
  function renderAll(){
    renderStats();renderReports();
    renderDrawer();
    $('add-participant').disabled=!ready||fatal;
    const mapState=JSON.stringify([workspace,filters.country,...scopedPeople.map(p=>[p.id,p.firstName,p.lastName,p.organization,p.country,p.countryCode,records[p.id].attending,records[p.id].priority])]);
    if(mapState!==lastMapState){world?.update(records,filters.country,scopedPeople);lastMapState=mapState;}
    const visible=scopedPeople.filter(p=>C.matches(workspace==='OV'?{...p,email:'',phones:[]}:p,workspace==='OV'?{...records[p.id],notes:[]}:records[p.id],filters));
    $('result-count').textContent=visible.length;
    $('filter-summary').textContent=`${visible.length} of ${scopedPeople.length} participants · ${filters.country==='__missing__'?'Country not provided':filters.country||'Grouped by country'} · ${workspace==='OV'?'View only':workspace}`;
    renderDirectory(visible);
    $('empty').hidden=visible.length!==0;
    document.querySelectorAll('.country-link').forEach(b=>{b.classList.toggle('active',b.dataset.country===filters.country);b.setAttribute('aria-pressed',String(b.dataset.country===filters.country));});
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='priority'?filters.priority==='priority':b.dataset.view==='not-attending'?filters.attendance==='not-attending':!filters.priority&&!filters.attendance));
    for(const key of ['country','attendance','priority','completion'])$('filter-'+key).value=filters[key];
    pickerViews.forEach(picker=>picker.sync());
    if(fatal)$('participants').querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  }
  function reset(){Object.keys(filters).forEach(k=>filters[k]='');$('search').value='';renderAll();}
  function renderDrawer(){
    const labels={all:'All participants',priority:'Priority','not-attending':'Not attending',countries:'All countries'};
    const drawer=$('nav-drawer'),opening=!!drawerPanel;
    if(opening!==drawerVisible){
      const style=drawerMotion?.playState==='running'?getComputedStyle(drawer):null;
      const interrupted=style?{opacity:style.opacity,transform:style.transform}:null;
      drawerVisible=opening;drawerMotion?.cancel();drawerMotion=null;
      drawer.inert=!opening;drawer.setAttribute('aria-hidden',String(!opening));
      if(opening){drawer.hidden=false;drawerMotion=animate(drawer,[interrupted||{opacity:0,transform:'translateX(-12px) scale(.985)'},{opacity:1,transform:'translateX(0) scale(1)'}],320);}
      else{
        drawerMotion=animate(drawer,[interrupted||{opacity:1,transform:'translateX(0) scale(1)'},{opacity:0,transform:'translateX(-8px) scale(.99)'}],170);
        if(drawerMotion)drawerMotion.onfinish=()=>{if(!drawerPanel)drawer.hidden=true;};else drawer.hidden=true;
      }
    }
    document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.panel===drawerPanel)));
    if(!drawerPanel)return;
    $('nav-drawer-title').textContent=labels[drawerPanel];
    $('country-nav').hidden=drawerPanel!=='countries';$('drawer-people').hidden=drawerPanel==='countries';
    if(drawerPanel==='countries'){$('drawer-count').textContent=`${countries.length} countries · Choose a group to view its cards`;return;}
    const group=scopedPeople.filter(p=>drawerPanel==='priority'?records[p.id].priority:drawerPanel==='not-attending'?!records[p.id].attending:true);
    $('drawer-count').textContent=`${group.length} ${group.length===1?'participant':'participants'} · Select a person to open their card`;
    $('drawer-people').innerHTML=group.length?group.map(p=>`<button class="drawer-person" data-jump-person="${esc(p.id)}">${flag(p)}<span><strong>${esc(name(p))}</strong><small>${esc(p.country)}</small></span>${records[p.id].priority?'<i class="red-dot" aria-label="Priority"></i>':''}</button>`).join(''):'<p class="drawer-empty">No participants in this view yet.</p>';
  }
  function closeDrawer(restoreFocus=false){
    const previous=drawerPanel;drawerPanel='';renderDrawer();
    if(restoreFocus&&previous)document.querySelector(`[data-panel="${previous}"]`).focus();
  }
  $('close-drawer').onclick=()=>closeDrawer(true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawerPanel){e.preventDefault();closeDrawer(true);}});
  document.addEventListener('pointerdown',e=>{if(drawerPanel&&!e.target.closest('.sidebar,#nav-drawer'))closeDrawer();});
  $('drawer-people').onclick=e=>{
    const button=e.target.closest('[data-jump-person]');if(!button)return;
    const p=byId.get(button.dataset.jumpPerson);Object.keys(filters).forEach(k=>filters[k]='');filters.search=(workspace==='FH'?p.email:'')||[p.firstName,p.lastName].filter(Boolean).join(' ')||p.organization||p.phones[0]||p.country;$('search').value=filters.search;
    closeDrawer();renderAll();const card=cardViews.get(p.id)?.node;
    if(card){card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});}
  };
  function downloadBackup(prefix='conference-progress') {
    if(workspace!=='FH')return;
    const data={schemaVersion:1,datasetId:C.DATASET,exportedAt:new Date().toISOString(),addedParticipants:people.filter(p=>p.added),participantEdits,records};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    lastBackup=data.exportedAt;cache();toast('Backup download started. Keep it somewhere safe.');
  }
  $('country-nav').innerHTML=`<button class="country-link active" data-country="" aria-pressed="true">All countries <span class="country-count">${people.length}</span></button>`+[...countryCatalog,{country:'Country not provided',countryCode:''}].map(p=>`<button class="country-link" data-country="${esc(p.countryCode?p.country:'__missing__')}" aria-pressed="false">${flag(p)}<span>${esc(p.country)}</span><span class="country-count">0</span></button>`).join('');
  $('filter-country').insertAdjacentHTML('beforeend',allCountries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')+'<option value="__missing__">Country not provided</option>');
  $('new-country').insertAdjacentHTML('beforeend',countryCatalog.map(p=>`<option value="${p.countryCode}">${esc(p.country)}</option>`).join(''));
  $('country-nav').addEventListener('click',e=>{const b=e.target.closest('[data-country]');if(!b)return;Object.keys(filters).forEach(k=>filters[k]='');$('search').value='';filters.country=b.dataset.country;closeDrawer(true);renderAll();document.querySelector('.directory').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
  document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>{
    if(drawerPanel===b.dataset.panel){closeDrawer();return;}
    drawerPanel=b.dataset.panel;
    if(b.dataset.view){Object.keys(filters).forEach(k=>filters[k]='');$('search').value='';if(b.dataset.view==='priority')filters.priority='priority';if(b.dataset.view==='not-attending')filters.attendance='not-attending';}
    renderAll();
  });
  $('search').addEventListener('input',e=>{filters.search=e.target.value;renderAll();});
  for(const key of ['country','attendance','priority','completion'])$('filter-'+key).onchange=e=>{filters[key]=e.target.value;renderAll();};
  document.querySelectorAll('select').forEach(select=>pickerViews.push(enhanceSelect(select)));
  $('clear-filters').onclick=reset;$('empty-reset').onclick=reset;
  let creating=false,creationAttempt=null,newOwner='FH',editingPerson=null,editingPrevious=null;
  const participantDialog=$('participant-dialog'),participantForm=$('participant-form');
  function lockNewFields(locked){
    participantForm.querySelectorAll('input,textarea,select,#new-attending,#new-visa-required').forEach(el=>el.disabled=locked);
    if(!locked)$('new-visa').disabled=$('new-visa-required').getAttribute('aria-pressed')!=='true';
    pickerViews.forEach(p=>p.sync());
  }
  participantForm.addEventListener('input',()=>{if(!creationAttempt)$('participant-form-error').hidden=true;});
  function newToggle(button,on,label,offLabel,kind){
    button.setAttribute('aria-pressed',String(on));button.innerHTML=`<i></i>${on?label:offLabel}`;
    if(kind==='visa'){button.classList.toggle('required',on);button.classList.toggle('waived',!on);$('new-visa').disabled=!on;if(!on)$('new-visa').checked=false;}
    else button.classList.toggle('off',!on);
  }
  $('new-attending').onclick=()=>newToggle($('new-attending'),$('new-attending').getAttribute('aria-pressed')!=='true','Attending','Not attending');
  $('new-visa-required').onclick=()=>newToggle($('new-visa-required'),$('new-visa-required').getAttribute('aria-pressed')!=='true','Visa required','Not required','visa');
  $('add-participant').onclick=()=>{
    if(!ready||fatal||workspace==='OV')return;
    activePicker?.close();closeDrawer();closeWorkspace();newOwner='FH';creationAttempt=null;editingPerson=null;editingPrevious=null;
    $('participant-dialog-title').innerHTML='Add a participant<span>.</span>';participantDialog.querySelector('.new-card-settings').hidden=false;participantDialog.querySelector('.new-card-extra').hidden=false;
    participantForm.reset();lockNewFields(false);participantDialog.querySelector('details').open=false;$('save-participant').textContent='Add participant';
    newToggle($('new-attending'),true,'Attending','Not attending');newToggle($('new-visa-required'),true,'Visa required','Not required','visa');
    $('new-workspace-label').textContent='NEW CARD · '+workspaces[newOwner];$('participant-form-error').hidden=true;
    pickerViews.forEach(p=>p.sync());participantDialog.showModal();
    animate(participantDialog,[{opacity:0,translate:'0 12px',scale:'.975'},{opacity:1,translate:'0 0',scale:'1'}],240);
    $('new-first-name').focus();
  };
  function openEdit(id){
    if(workspace!=='FH'||!ready||fatal)return;
    const p=byId.get(id);if(!p||!C.owners(p).includes('FH'))return;
    activePicker?.close();closeDrawer();closeWorkspace();editingPerson=id;editingPrevious=C.detailsOf(p);creationAttempt=null;newOwner='FH';
    participantForm.reset();lockNewFields(false);
    for(const [field,key] of [['first-name','firstName'],['last-name','lastName'],['email','email'],['organization','organization'],['country','countryCode']])$('new-'+field).value=p[key]||'';
    $('new-phone').value=p.phones.join('\n');
    $('participant-dialog-title').innerHTML='Edit participant<span>.</span>';$('new-workspace-label').textContent='EDIT DETAILS · FH';
    participantDialog.querySelector('.new-card-settings').hidden=true;participantDialog.querySelector('.new-card-extra').hidden=true;
    $('save-participant').textContent='Save changes';$('participant-form-error').hidden=true;pickerViews.forEach(p=>p.sync());participantDialog.showModal();$('new-first-name').focus();
  }
  function closeParticipant(){if(creating)return;activePicker?.close();participantDialog.close();(editingPerson?cardViews.get(editingPerson)?.node.querySelector('[data-action="edit-person"]'):$('add-participant'))?.focus({preventScroll:true});}
  $('close-participant').onclick=closeParticipant;$('cancel-participant').onclick=closeParticipant;
  participantDialog.addEventListener('cancel',e=>{e.preventDefault();if(activePicker)activePicker.close(true);else closeParticipant();});
  participantForm.addEventListener('submit',async e=>{
    e.preventDefault();if(creating||workspace==='OV'||fatal||!ready)return;
    $('participant-form-error').hidden=true;
    try{
      if(!creationAttempt){
        const country=countryCatalog.find(p=>p.countryCode===$('new-country').value);
        const participant=C.validateAddedParticipants([{id:'added-'+uid(),firstName:$('new-first-name').value.trim(),lastName:$('new-last-name').value.trim(),email:$('new-email').value.trim(),organization:$('new-organization').value.trim(),country:country?.country||'',countryCode:country?.countryCode||'',phones:$('new-phone').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),owners:[newOwner],attending:$('new-attending').getAttribute('aria-pressed')==='true',visaRequired:$('new-visa-required').getAttribute('aria-pressed')==='true'}])[0];
        if(participant.email&&(!editingPerson||participant.email.toLocaleLowerCase()!==byId.get(editingPerson).email?.toLocaleLowerCase())&&people.some(p=>p.id!==editingPerson&&p.email?.toLocaleLowerCase()===participant.email.toLocaleLowerCase()))throw new Error('A participant with this email already exists in the saved list.');
        creationAttempt=editingPerson?{id:uid(),workspace:'FH',kind:'editParticipant',person:editingPerson,details:C.detailsOf(participant),previous:editingPrevious}:{id:uid(),workspace:newOwner,kind:'addParticipant',participant,priority:$('new-priority').checked,visa:$('new-visa').checked,flight:$('new-flight').checked,hotel:$('new-hotel').checked,note:$('new-note').value.trim()};
      }
      creating=true;participantForm.inert=true;$('save-participant').textContent='Saving…';
      const operation=creationAttempt;
      if(backend){
        await flush();if(pending.length||saving){creationAttempt=null;throw new Error('Earlier changes are still saving. Please try again in a moment.');}
        const response=await api('api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Conference-Client':'local-dashboard'},body:JSON.stringify({datasetId:C.DATASET,operations:[operation]})});
        const saved=await response.json();if(!response.ok){if(response.status===400)creationAttempt=null;throw new Error(saved.error||'Could not save the new card.');}
        adoptSaved(saved);
      }else if(operation.kind==='editParticipant'){
        const next=people.map(p=>({...p}));C.apply(records,operation,next);const edits={...participantEdits,[operation.person]:operation.details};
        localStorage.setItem(CACHE,JSON.stringify({schemaVersion:1,datasetId:C.DATASET,addedParticipants:next.filter(p=>p.added),participantEdits:edits,records,pending:[],lastBackup}));
        participantEdits=edits;people=next;syncRoster();
      }else{
        const next=C.mergePeople(people,[operation.participant]),initial=C.initialRecords([operation.participant])[operation.participant.id],time=new Date().toISOString();
        for(const k of ['priority','visa','flight','hotel'])initial[k]=operation[k];
        if(operation.note)initial.notes=[{id:operation.participant.id+'-note',text:operation.note,done:false,reviewed:false,createdAt:time,updatedAt:time}];
        // Do not report a new card as saved unless the browser accepted the complete copy.
        localStorage.setItem(CACHE,JSON.stringify({schemaVersion:1,datasetId:C.DATASET,addedParticipants:next.filter(p=>p.added),participantEdits,records:{...records,[operation.participant.id]:initial},pending:[],lastBackup}));
        people=next;records[operation.participant.id]=initial;syncRoster();
      }
      cache();status();creating=false;participantForm.inert=false;closeParticipant();reset();
      const card=cardViews.get(operation.person||operation.participant.id)?.node;
      if(card){card.tabIndex=-1;card.scrollIntoView({behavior:reducedMotion.matches?'auto':'smooth',block:'center'});card.focus({preventScroll:true});}
      creationAttempt=null;toast(operation.kind==='editParticipant'?'Participant details updated. Notes and progress kept.':'Participant added to FH and the overview.');
    }catch(error){lockNewFields(!!creationAttempt);$('participant-form-error').textContent=error.message+(creationAttempt?' Your details are kept. Retry saving to confirm this same card.':'');$('participant-form-error').hidden=false;}
    finally{creating=false;participantForm.inert=false;$('save-participant').textContent=creationAttempt?'Retry saving':editingPerson?'Save changes':'Add participant';}
  });
  $('participants').addEventListener('toggle',e=>{if(e.target.matches('details')&&!noteMotions.has(e.target)){const id=e.target.closest('[data-person]').dataset.person;if(e.target.open)expanded.add(id);else expanded.delete(id);}},true);
  $('participants').addEventListener('click',e=>{
    const summary=e.target.closest('summary');if(!summary)return;
    const details=summary.closest('details.notes');if(!details)return;e.preventDefault();
    const previous=noteMotions.get(details),opening=previous?!previous.opening:!details.open,id=details.closest('[data-person]').dataset.person;
    const start=details.getBoundingClientRect().height;previous?.animation.cancel();
    if(opening)expanded.add(id);else expanded.delete(id);
    details.style.height='';details.style.overflow='';
    if(reducedMotion.matches){noteMotions.delete(details);details.open=opening;return;}
    details.open=true;
    const end=opening?details.getBoundingClientRect().height:summary.getBoundingClientRect().height+1;
    details.style.overflow='hidden';
    const animation=animate(details,[{height:start+'px'},{height:end+'px'}],opening?310:230);
    if(!animation){details.open=opening;details.style.overflow='';return;}
    noteMotions.set(details,{animation,opening});
    animation.onfinish=()=>{if(noteMotions.get(details)?.animation!==animation)return;details.open=opening;details.style.height='';details.style.overflow='';noteMotions.delete(details);};
  });
  $('participants').addEventListener('click',e=>{
    const b=e.target.closest('button[data-action]');if(!b||!ready||workspace==='OV')return;
    const id=b.closest('[data-person]').dataset.person,r=records[id],action=b.dataset.action;
    if(action==='edit-person'){openEdit(id);return;}
    if(action==='priority')setField(id,'priority',!r.priority);
    if(action==='attendance')setField(id,'attending',!r.attending);
    if(action==='visa-required')setField(id,'visaRequired',!r.visaRequired);
    if(action==='add-note'){
      const text=r.draft.trim();if(!text){toast('Write a note first.');return;}expanded.add(id);
      const date=new Date().toISOString();change([{kind:'note',person:id,note:{id:uid(),text,done:false,createdAt:date,updatedAt:date}},{kind:'set',person:id,field:'draft',value:''}]);
    }
    if(action==='note-delete'){
      const nid=b.closest('[data-note]').dataset.note,note={...r.notes.find(n=>n.id===nid)};
      change([{kind:'deleteNote',person:id,noteId:nid}]);toast('Note removed.',()=>change([{kind:'note',person:id,note}]));
    }
  });
  $('participants').addEventListener('change',e=>{
    const el=e.target,id=el.closest('[data-person]')?.dataset.person;if(!id||!ready||workspace!=='FH')return;
    if(el.dataset.action==='arrangement')setField(id,el.dataset.field,el.checked);
    if(['note-done','note-reviewed'].includes(el.dataset.action)){
      const n=records[id].notes.find(n=>n.id===el.closest('[data-note]').dataset.note);
      change([{kind:'noteStatus',person:id,noteId:n.id,field:el.dataset.action==='note-done'?'done':'reviewed',value:el.checked,updatedAt:new Date().toISOString()}]);
    }
  });
  $('participants').addEventListener('input',e=>{
    const el=e.target,id=el.closest('[data-person]')?.dataset.person;if(!id||!ready||workspace==='OV')return;
    if(el.dataset.action==='draft')setField(id,'draft',el.value,false);
    if(el.dataset.action==='note-text'){
      const n=records[id].notes.find(n=>n.id===el.closest('[data-note]').dataset.note);
      change([{kind:'noteText',person:id,noteId:n.id,text:el.value,updatedAt:new Date().toISOString()}],false);
    }
  });
  $('participants').addEventListener('keydown',e=>{if(e.target.dataset.action==='draft'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.target.closest('.note-compose').querySelector('button').click();}});
  $('export-data').onclick=()=>{
    if(workspace!=='FH')return;
    if(!ready||fatal){toast('Wait for your saved progress to load before exporting.');return;}
    try{
      const url=URL.createObjectURL(window.ConferenceExport.workbook(scopedPeople,records)),a=document.createElement('a');
      a.href=url;a.download=`conference-${workspace}-participants-${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
      toast(`Excel export started · All ${scopedPeople.length} participants in ${workspace}, notes and drafts included.`);
    }catch{toast('Excel export could not be created. Please try again.');}
  };
  $('help-export').onclick=()=>downloadBackup();
  $('restore-backup').onclick=()=>$('backup-file').click();
  $('backup-file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(workspace==='OV')throw new Error('Switch to FH to restore a backup.');if(file.size>12000000)throw new Error('Backup is too large.');const value=JSON.parse(await file.text());if(value.datasetId!==C.DATASET||value.schemaVersion!==1)throw new Error('This is not a Conference Desk backup for your participant list.');const added=[...new Map([...people.filter(p=>p.added),...(value.addedParticipants||[])].map(p=>[p.id,p])).values()];const merged=C.mergePeople(seedPeople,added,{...participantEdits,...value.participantEdits});C.restoreRecords(value.records,merged,{...C.initialRecords(merged),...records});incomingBackup={records:value.records,addedParticipants:value.addedParticipants||[],participantEdits:value.participantEdits||{}};$('restore-summary').textContent=`This backup will restore FH records and saved contact edits. Archived guest records will be preserved.`;$('confirm-dialog').showModal();}
    catch(error){toast('Backup could not be loaded: '+error.message);}finally{e.target.value='';}
  };
  $('cancel-restore').onclick=()=>{$('confirm-dialog').close();incomingBackup=null;};
  $('confirm-restore').onclick=()=>{if(!incomingBackup)return;downloadBackup('before-restore');fatal=false;ready=true;change([{kind:'restore',...incomingBackup}]);incomingBackup=null;$('confirm-dialog').close();toast('Progress restored.');};
  $('saving-help').onclick=()=>{$('storage-explanation').textContent=backend?'This local version saves to your browser and to a progress file on this computer. The indicator at the top confirms when the file is saved.':'This version saves in this browser on this device. Clearing site data removes that browser copy. Export backups regularly. A GitHub Pages version will also use browser storage until a shared database is added.';$('help-dialog').showModal();};
  window.addEventListener('pagehide',()=>{cache();if(!fatal&&backend&&pending.length)fetch('api/actions',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Conference-Client':'local-dashboard'},body:JSON.stringify({datasetId:C.DATASET,operations:pending.slice(0,500)})}).catch(()=>{});});
  window.addEventListener('online',flush);
  async function refreshShared(){
    if(!ready||!backend||pending.length||saving||creating||fatal||refreshing||document.hidden)return;
    refreshing=true;
    try{const response=await api('api/state');if(response.ok){const saved=await response.json();if(pending.length||saving||saved.revision===serverRevision)return;adoptSaved(saved);cache();renderAll();status();}}catch{}finally{refreshing=false;}
  }
  window.addEventListener('focus',refreshShared);document.addEventListener('visibilitychange',refreshShared);setInterval(refreshShared,2000);
  window.addEventListener('storage',e=>{if(e.key!==CACHE||backend||pending.length||!e.newValue)return;try{const saved=JSON.parse(e.newValue);adoptSaved(saved);renderAll();}catch{}});
  async function init(){
    let cached=null;
    try{const raw=localStorage.getItem(CACHE);if(raw){cached=JSON.parse(raw);participantEdits=cached.participantEdits||{};people=C.mergePeople(seedPeople,cached.addedParticipants||[],participantEdits);records=C.restoreRecords(cached.records,people);pending=Array.isArray(cached.pending)?cached.pending:[];lastBackup=cached.lastBackup;}}
    catch{cacheDamaged=true;}
    if(location.protocol!=='file:'){
      try{
        const response=await api('api/state');
        if(response.ok){const saved=await response.json();if(saved.datasetId!==C.DATASET)throw new Error('Unexpected save service.');backend=true;serverRevision=saved.revision;const cachedRecords=records,cachedAdded=people.filter(p=>p.added);
          // Recover an existing browser copy if a new, empty local progress directory is used.
          if(saved.revision===0&&cached&&!cacheDamaged&&JSON.stringify(records)!==JSON.stringify(C.initialRecords(people))){pending=[{id:uid(),kind:'restore',workspace:'FH',records:cachedRecords,addedParticipants:cachedAdded,participantEdits}];}
          adoptSaved(saved);cacheDamaged=false;
        }else if(response.status!==404){throw new Error('The local save service is not available.');}
      }catch(error){
        // An unavailable local save service must never be mistaken for a clean deployment.
        if(location.hostname==='127.0.0.1'||location.hostname==='localhost'){
          fatal=true;$('save-error').hidden=false;$('save-error').textContent='Could not load the local progress file. Restart the dashboard launcher and reload this page. Existing progress has not been replaced.';
        }
      }
    }
    if(cacheDamaged){fatal=true;$('save-error').hidden=false;$('save-error').textContent='The saved browser copy could not be read. Restore a backup to continue. The existing copy has not been overwritten.';}
    ready=!fatal;syncRoster();renderAll();$('participants').setAttribute('aria-busy','false');
    if(fatal)$('participants').querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
    if(!fatal)cache();status();flush();
  }
  function updateWorkspace(){
    scopedPeople=C.scopePeople(people,workspace);countries=[...new Set(scopedPeople.map(p=>p.country))].sort((a,b)=>a.localeCompare(b));
    const countrySet=new Set(countries),codeSet=new Set(scopedPeople.map(p=>p.countryCode));
    for(const option of $('filter-country').options)option.hidden=!!option.value&&!countrySet.has(option.value==='__missing__'?'':option.value);
    for(const option of $('map-country').options)option.hidden=!!option.value&&!codeSet.has(option.value);
    document.querySelectorAll('.country-link').forEach(b=>{const country=b.dataset.country,count=country?scopedPeople.filter(p=>p.country===(country==='__missing__'?'':country)).length:scopedPeople.length;b.hidden=!count;b.querySelector('.country-count').textContent=count;});
    $('workspace-avatar').textContent=workspace==='OV'?'◉':'FH';$('workspace-button').setAttribute('aria-label','Switch workspace: '+workspaces[workspace]);
    $('workspace-name').textContent=workspaces[workspace];$('workspace-intro').textContent=workspace==='OV'?'Both guest lists together. Names, organizations and countries at a glance.':workspaces[workspace]+'’s participants, arrangements, and follow-up notes.';
    $('workspace-footer').textContent=workspaces[workspace]+' · Participant list';$('restore-backup').hidden=workspace==='OV';$('add-participant').hidden=workspace==='OV';
    $('workspace-policy').hidden=workspace!=='OV';document.body.dataset.workspace=workspace;
    for(const id of ['export-data','saving-help','help-export'])$(id).hidden=workspace==='OV';
    $('overview-reports').hidden=workspace!=='OV';$('page-title').innerHTML=workspace==='OV'?'Participant overview<span>.</span>':'Participant dashboard<span>.</span>';
    $('directory-label').textContent=workspace==='OV'?'All participants':'Your participants';$('total-label').textContent=workspace==='OV'?'ALL PARTICIPANTS':'YOUR PARTICIPANTS';
    $('search').placeholder=workspace==='OV'?'Search name, organization or country…':'Search name, email, organization or notes…';
    document.querySelectorAll('#workspace-menu [data-workspace]').forEach(b=>{b.setAttribute('aria-checked',String(b.dataset.workspace===workspace));b.querySelector('strong').textContent=workspaces[b.dataset.workspace];b.querySelector('.workspace-count').textContent=C.scopePeople(people,b.dataset.workspace).length+' participants';});
    document.title='Conference Desk · '+(workspace==='OV'?'View only':workspace);
  }
  function closeWorkspace(restore=false){$('workspace-menu').hidden=true;$('workspace-button').setAttribute('aria-expanded','false');if(restore)$('workspace-button').focus();}
  $('workspace-button').onclick=()=>{const opening=$('workspace-menu').hidden;activePicker?.close();closeDrawer();$('workspace-menu').hidden=!opening;$('workspace-button').setAttribute('aria-expanded',String(opening));if(opening){animate($('workspace-menu'),[{opacity:0,translate:'-5px 6px',scale:'.98'},{opacity:1,translate:'0 0',scale:'1'}],200);$('workspace-menu').querySelector('[aria-checked="true"]').focus();}};
  $('workspace-menu').onclick=e=>{const b=e.target.closest('[data-workspace]');if(!b)return;workspace=b.dataset.workspace;activePicker?.close();closeWorkspace(true);closeDrawer();Object.keys(filters).forEach(k=>filters[k]='');$('search').value='';expanded.clear();updateWorkspace();const url=new URL(location.href);url.searchParams.set('workspace',workspace);history.replaceState(null,'',url);renderAll();flush();refreshShared();};
  $('workspace-menu').addEventListener('keydown',e=>{const buttons=[...$('workspace-menu').querySelectorAll('[data-workspace]')],i=buttons.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();closeWorkspace(true);}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}if(e.key==='Tab')closeWorkspace(true);});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#workspace-button,#workspace-menu'))closeWorkspace();});
  updateWorkspace();init();
})();
