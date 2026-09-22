/* No remote requests, trackers, or third-party runtime dependencies. */
(() => {
  'use strict';
  const C=window.ConferenceCore, people=window.CONFERENCE_DATA.participants;
  const byId=new Map(people.map(p=>[p.id,p]));
  const CACHE='conference-desk:publishers-2026-farok:v1';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid=()=>crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
  const name=p=>[p.firstName,p.lastName].filter(Boolean).join(' ')||'Name not provided';
  const flag=p=>`<img src="assets/flags/${p.countryCode}.svg" alt="" loading="lazy">`;
  const countries=[...new Set(people.map(p=>p.country))].sort((a,b)=>a.localeCompare(b));
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
    const id=select.id,searchable=id==='map-country'||id==='filter-country';
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
    trigger.setAttribute('aria-controls',searchable?panel.id:list.id);document.body.append(panel);
    const options=[...select.options].map((option,index)=>{
      const node=document.createElement('div');node.id=id+'-option-'+index;node.className='select-option';node.setAttribute('role','option');node.dataset.value=option.value;
      const country=people.find(p=>id==='map-country'?p.countryCode===option.value:p.country===option.value);
      const icon=searchable?(country?flag(country):'<span class="select-world" aria-hidden="true">◎</span>'):'';
      node.innerHTML=`${icon}<span class="select-option-label">${esc(option.textContent)}</span><svg class="select-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>`;
      list.append(node);return {node,value:option.value,text:option.textContent,country};
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
      activePicker?.close();opened=true;activePicker=view;filtered=options;
      if(search)search.value='';options.forEach(o=>o.node.hidden=false);empty.hidden=true;sync();
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
      const query=normalize(search.value.trim());filtered=options.filter(o=>normalize(o.text).includes(query));
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
    try{localStorage.setItem(CACHE,JSON.stringify({schemaVersion:1,datasetId:C.DATASET,records,pending,lastBackup}));storageFailed=false;}
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
    try{return await fetch(path,{cache:'no-store',...options,signal:controller.signal});}finally{clearTimeout(timeout);}
  }
  async function flush() {
    if(!backend||saving||!pending.length||fatal)return;
    saving=true;status();
    const batch=pending.slice(0,500);
    try{
      const response=await api('api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Conference-Client':'local-dashboard'},body:JSON.stringify({datasetId:C.DATASET,operations:batch})});
      const saved=await response.json();if(!response.ok)throw new Error(saved.error||'Could not save the progress file.');
      const acknowledged=new Set(batch.map(o=>o.id));pending=pending.filter(o=>!acknowledged.has(o.id));
      records=C.validateRecords(saved.records,people);for(const op of pending)records=C.apply(records,op,people);
      cache();status();
    }catch(error){
      $('save-status').className='save-status pending';$('save-status').lastElementChild.textContent=storageFailed?'Changes need a backup':'Saved in browser · file update pending';
      $('save-error').hidden=false;$('save-error').textContent=`The local progress file could not be updated. ${storageFailed?'Export a backup now.':'Your changes remain in this browser and will retry automatically.'} ${error.message}`;
    }finally{saving=false;}
    if(pending.length)setTimeout(flush,2500);
  }
  function change(operations,render=true) {
    if(!ready||fatal)return;
    for(const action of operations){const op={...action,id:uid()};records=C.apply(records,op,people);pending.push(op);}
    // Local-only deployments need no server queue; their authoritative state is the browser cache.
    if(!backend)pending=[];
    cache();status();if(render)renderAll();
    clearTimeout(saveTimer);saveTimer=setTimeout(flush,250);
  }
  function setField(person,field,value,render=true){change([{kind:'set',person,field,value}],render);}
  function renderStats(){
    const t=C.totals(records);
    $('stat-total').textContent=t.total;$('nav-total').textContent=t.total;$('nav-priority').textContent=t.priority;$('nav-absent').textContent=t.notAttending;
    $('stat-attendance').textContent=`${t.attending} attending · ${t.notAttending} not attending`;
    document.querySelectorAll('.attending-total').forEach(el=>el.textContent=t.attending);
    for(const key of ['visa','flight','hotel']){$('stat-'+key).textContent=t[key];$('meter-'+key).style.width=(t.attending?t[key]/t.attending*100:0)+'%';$('remaining-'+key).textContent=`${t.attending-t[key]} remaining`;}
  }
  function noteHtml(p,n){
    return `<div class="note-row ${n.done?'completed':''}" data-note="${esc(n.id)}"><input type="checkbox" data-action="note-done" ${n.done?'checked':''} aria-label="Mark note complete for ${esc(name(p))}"><div class="note-main"><textarea data-action="note-text" aria-label="Edit note for ${esc(name(p))}" maxlength="20000">${esc(n.text)}</textarea><span class="note-time">${esc(new Date(n.createdAt).toLocaleDateString(undefined,{day:'numeric',month:'short'}))}</span></div><button class="note-delete" data-action="note-delete" aria-label="Delete note for ${esc(name(p))}" title="Delete note">×</button></div>`;
  }
  function cardHtml(p){
    const r=records[p.id], fullName=name(p), done=['visa','flight','hotel'].filter(k=>r[k]).length;
    return `<article class="card ${r.priority?'priority':''} ${r.attending?'':'not-attending'}" data-person="${esc(p.id)}" aria-label="${esc(fullName)}"><div class="card-body"><div class="card-top"><div><h4 class="person-name">${esc(fullName)}</h4><div class="organization">${esc(p.organization)}</div></div><button class="priority-button" data-action="priority" aria-pressed="${r.priority}" aria-label="Priority for ${esc(fullName)}" title="${r.priority?'Remove priority':'Mark as priority'}">⚑</button></div>
      <div class="card-country">${flag(p)}<span>${esc(p.country)}</span></div>
      <div class="contact-line"><svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="4" width="14" height="10" rx="2"/><path d="m3 5 6 5 6-5"/></svg><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></div>
      <div class="contact-line"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 2h3l1 4-2 1c1 3 2 4 5 5l1-2 4 1v3c0 2-3 2-5 1C6 13 3 9 2 5c0-2 0-3 2-3Z"/></svg><span class="contact-phones">${p.phones.length?p.phones.map(phone=>`<a href="tel:${esc(phone.replace(/[^+\d]/g,''))}">${esc(phone)}</a>`).join(''):'<span class="missing">Phone not provided</span>'}</span></div>
      <div class="attendance-row"><button class="attendance ${r.attending?'':'off'}" data-action="attendance" aria-pressed="${r.attending}" aria-label="Attendance for ${esc(fullName)}: ${r.attending?'attending':'not attending'}" title="Click to change attendance"><i></i>${r.attending?'Attending':'Not attending'}<span aria-hidden="true">⌄</span></button><span class="completion-count ${done===3?'done':''}">${done}/3 complete</span></div>
      <div class="arrangements">${[['visa','Visa'],['flight','Flight'],['hotel','Hotel']].map(([key,label])=>`<label class="arrangement"><input type="checkbox" data-action="arrangement" data-field="${key}" ${r[key]?'checked':''} aria-label="${label} complete for ${esc(fullName)}"><span>${label}</span></label>`).join('')}</div></div>
      <details class="notes" ${expanded.has(p.id)?'open':''}><summary><span>Notes <span class="note-count">${r.notes.length?`(${r.notes.length})`:''}${r.draft?' · draft':''}</span></span><span class="chevron" aria-hidden="true">⌄</span></summary><div class="notes-content"><div class="note-list">${r.notes.length?r.notes.map(n=>noteHtml(p,n)).join(''):'<p class="note-empty">Keep the details you want to remember.</p>'}</div><div class="note-compose"><textarea data-action="draft" placeholder="Add a note or follow-up…" aria-label="New note for ${esc(fullName)}" maxlength="20000">${esc(r.draft)}</textarea><div class="compose-bottom"><span>Draft saves automatically</span><button class="button" data-action="add-note">+ Add note</button></div></div></div></details></article>`;
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
        section=element(`<section class="country-group"><div class="group-heading"><img class="flag" src="assets/flags/${group[0].countryCode}.svg" alt=""><h3>${esc(country)}</h3><span class="group-count"></span><span class="group-rule"></span></div><div class="cards"></div></section>`);
        groupViews.set(country,section);
      }
      const label=`${group.length} ${group.length===1?'participant':'participants'}`,count=section.querySelector('.group-count');
      if(count.textContent!==label)count.textContent=label;
      const cards=group.map(p=>{
        const key=JSON.stringify([records[p.id],expanded.has(p.id)]);let view=cardViews.get(p.id);
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
    renderStats();
    renderDrawer();
    const mapState=JSON.stringify([filters.country,...people.map(p=>[records[p.id].attending,records[p.id].priority])]);
    if(mapState!==lastMapState){world?.update(records,filters.country);lastMapState=mapState;}
    const visible=people.filter(p=>C.matches(p,records[p.id],filters));
    $('result-count').textContent=visible.length;
    $('filter-summary').textContent=`${visible.length} of ${people.length} participants · ${filters.country||'Grouped by country'} · Alphabetical order`;
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
    const group=people.filter(p=>drawerPanel==='priority'?records[p.id].priority:drawerPanel==='not-attending'?!records[p.id].attending:true);
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
    const p=byId.get(button.dataset.jumpPerson);Object.keys(filters).forEach(k=>filters[k]='');filters.search=p.email;$('search').value=p.email;
    closeDrawer();renderAll();const card=$('participants').querySelector('.card');
    if(card){card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});}
  };
  function downloadBackup(prefix='conference-progress') {
    const data={schemaVersion:1,datasetId:C.DATASET,exportedAt:new Date().toISOString(),records};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    lastBackup=data.exportedAt;cache();toast('Backup download started. Keep it somewhere safe.');
  }
  $('country-nav').innerHTML=`<button class="country-link active" data-country="" aria-pressed="true">All countries <span class="country-count">124</span></button>`+countries.map(c=>{const group=people.filter(p=>p.country===c);return `<button class="country-link" data-country="${esc(c)}" aria-pressed="false">${flag(group[0])}<span>${esc(c)}</span><span class="country-count">${group.length}</span></button>`;}).join('');
  $('filter-country').insertAdjacentHTML('beforeend',countries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(''));
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
    const b=e.target.closest('button[data-action]');if(!b||!ready)return;
    const id=b.closest('[data-person]').dataset.person,r=records[id],action=b.dataset.action;
    if(action==='priority')setField(id,'priority',!r.priority);
    if(action==='attendance')setField(id,'attending',!r.attending);
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
    const el=e.target,id=el.closest('[data-person]')?.dataset.person;if(!id||!ready)return;
    if(el.dataset.action==='arrangement')setField(id,el.dataset.field,el.checked);
    if(el.dataset.action==='note-done'){
      const n=records[id].notes.find(n=>n.id===el.closest('[data-note]').dataset.note);
      change([{kind:'note',person:id,note:{...n,done:el.checked,updatedAt:new Date().toISOString()}}]);
    }
  });
  $('participants').addEventListener('input',e=>{
    const el=e.target,id=el.closest('[data-person]')?.dataset.person;if(!id||!ready)return;
    if(el.dataset.action==='draft')setField(id,'draft',el.value,false);
    if(el.dataset.action==='note-text'){
      const n=records[id].notes.find(n=>n.id===el.closest('[data-note]').dataset.note);
      change([{kind:'note',person:id,note:{...n,text:el.value,updatedAt:new Date().toISOString()}}],false);
    }
  });
  $('participants').addEventListener('keydown',e=>{if(e.target.dataset.action==='draft'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.target.closest('.note-compose').querySelector('button').click();}});
  $('export-data').onclick=()=>{
    if(!ready||fatal){toast('Wait for your saved progress to load before exporting.');return;}
    try{
      const url=URL.createObjectURL(window.ConferenceExport.workbook(people,records)),a=document.createElement('a');
      a.href=url;a.download=`conference-participants-${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
      toast(`Excel export started · All ${people.length} participants, notes and drafts included.`);
    }catch{toast('Excel export could not be created. Please try again.');}
  };
  $('help-export').onclick=()=>downloadBackup();
  $('restore-backup').onclick=()=>$('backup-file').click();
  $('backup-file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>12000000)throw new Error('Backup is too large.');const value=JSON.parse(await file.text());if(value.datasetId!==C.DATASET||value.schemaVersion!==1)throw new Error('This is not a Conference Desk backup for your participant list.');incomingBackup=C.validateRecords(value.records,people);$('restore-summary').textContent=`This backup contains ${Object.values(incomingBackup).reduce((sum,r)=>sum+r.notes.length,0)} notes and progress for ${people.length} participants.`;$('confirm-dialog').showModal();}
    catch(error){toast('Backup could not be loaded: '+error.message);}finally{e.target.value='';}
  };
  $('cancel-restore').onclick=()=>{$('confirm-dialog').close();incomingBackup=null;};
  $('confirm-restore').onclick=()=>{if(!incomingBackup)return;downloadBackup('before-restore');fatal=false;ready=true;change([{kind:'restore',records:incomingBackup}]);incomingBackup=null;$('confirm-dialog').close();toast('Progress restored.');};
  $('saving-help').onclick=()=>{$('storage-explanation').textContent=backend?'This local version saves to your browser and to a progress file on this computer. The indicator at the top confirms when the file is saved.':'This version saves in this browser on this device. Clearing site data removes that browser copy. Export backups regularly. A GitHub Pages version will also use browser storage until a shared database is added.';$('help-dialog').showModal();};
  window.addEventListener('pagehide',()=>{cache();if(!fatal&&backend&&pending.length)fetch('api/actions',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Conference-Client':'local-dashboard'},body:JSON.stringify({datasetId:C.DATASET,operations:pending.slice(0,500)})}).catch(()=>{});});
  window.addEventListener('online',flush);
  window.addEventListener('focus',async()=>{if(!ready||!backend||pending.length||saving||fatal)return;try{const response=await api('api/state');if(response.ok){const saved=await response.json();if(pending.length||saving)return;records=C.validateRecords(saved.records,people);cache();renderAll();status();}}catch{}});
  window.addEventListener('storage',e=>{if(e.key!==CACHE||backend||pending.length||!e.newValue)return;try{const saved=JSON.parse(e.newValue);records=C.validateRecords(saved.records,people);renderAll();}catch{}});
  async function init(){
    let cached=null;
    try{const raw=localStorage.getItem(CACHE);if(raw){cached=JSON.parse(raw);records=C.validateRecords(cached.records,people);pending=Array.isArray(cached.pending)?cached.pending:[];lastBackup=cached.lastBackup;}}
    catch{cacheDamaged=true;}
    if(location.protocol!=='file:'){
      try{
        const response=await api('api/state');
        if(response.ok){const saved=await response.json();if(saved.datasetId!==C.DATASET)throw new Error('Unexpected save service.');backend=true;const base=C.validateRecords(saved.records,people);
          // Recover an existing browser copy if a new, empty local progress directory is used.
          if(saved.revision===0&&cached&&!cacheDamaged&&JSON.stringify(records)!==JSON.stringify(C.initialRecords(people))){pending=[{id:uid(),kind:'restore',records}];}
          records=base;for(const op of pending)records=C.apply(records,op,people);cacheDamaged=false;
        }else if(response.status!==404){throw new Error('The local save service is not available.');}
      }catch(error){
        // An unavailable local save service must never be mistaken for a clean deployment.
        if(location.hostname==='127.0.0.1'||location.hostname==='localhost'){
          fatal=true;$('save-error').hidden=false;$('save-error').textContent='Could not load the local progress file. Restart the dashboard launcher and reload this page. Existing progress has not been replaced.';
        }
      }
    }
    if(cacheDamaged){fatal=true;$('save-error').hidden=false;$('save-error').textContent='The saved browser copy could not be read. Restore a backup to continue. The existing copy has not been overwritten.';}
    ready=!fatal;renderAll();$('participants').setAttribute('aria-busy','false');
    if(fatal)$('participants').querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
    if(!fatal)cache();status();flush();
  }
  init();
})();
