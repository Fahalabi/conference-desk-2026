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
  let incomingBackup=null,drawerPanel='';
  const world=window.ConferenceWorld?.create({people,onSelect:country=>{
    filters.country=country;filters.search='';filters.attendance='';filters.priority='';filters.completion='';
    $('search').value='';renderAll();
  }});

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
  function renderAll(){
    renderStats();
    renderDrawer();
    world?.update(records,filters.country);
    const visible=people.filter(p=>C.matches(p,records[p.id],filters));
    $('result-count').textContent=visible.length;
    $('filter-summary').textContent=`${visible.length} of ${people.length} participants · ${filters.country||'Grouped by country'} · Alphabetical order`;
    $('participants').innerHTML=countries.map(country=>{
      const group=visible.filter(p=>p.country===country);if(!group.length)return '';
      return `<section class="country-group"><div class="group-heading"><img class="flag" src="assets/flags/${group[0].countryCode}.svg" alt=""><h3>${esc(country)}</h3><span class="group-count">${group.length} ${group.length===1?'participant':'participants'}</span><span class="group-rule"></span></div><div class="cards">${group.map(cardHtml).join('')}</div></section>`;
    }).join('');
    $('empty').hidden=visible.length!==0;
    document.querySelectorAll('.country-link').forEach(b=>{b.classList.toggle('active',b.dataset.country===filters.country);b.setAttribute('aria-pressed',String(b.dataset.country===filters.country));});
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='priority'?filters.priority==='priority':b.dataset.view==='not-attending'?filters.attendance==='not-attending':!filters.priority&&!filters.attendance));
    for(const key of ['country','attendance','priority','completion'])$('filter-'+key).value=filters[key];
    if(fatal)$('participants').querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  }
  function reset(){Object.keys(filters).forEach(k=>filters[k]='');$('search').value='';renderAll();}
  function renderDrawer(){
    const labels={all:'All participants',priority:'Priority','not-attending':'Not attending',countries:'All countries'};
    $('nav-drawer').hidden=!drawerPanel;
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
  $('clear-filters').onclick=reset;$('empty-reset').onclick=reset;
  $('participants').addEventListener('toggle',e=>{if(e.target.matches('details')){const id=e.target.closest('[data-person]').dataset.person;if(e.target.open)expanded.add(id);else expanded.delete(id);}},true);
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
