(function (root) {
  'use strict';
  const DATASET = 'publishers-2026-farok';
  const fields = ['attending', 'priority', 'visa', 'flight', 'hotel'];
  function initialRecords(people) {
    return Object.fromEntries(people.map(p => [p.id, {attending:p.attending, priority:false, visaRequired:p.visaRequired!==false, visa:false, flight:false, hotel:false, notes:[], draft:''}]));
  }
  function owners(person){return person.owners||['FH'];}
  function scopePeople(people,workspace){return workspace==='PR'?people:people.filter(p=>owners(p).includes(workspace));}
  function validateAddedParticipants(value=[]){
    if(!Array.isArray(value)||value.length>5000)throw new Error('Invalid added participant list.');
    const seen=new Set();
    return value.map(p=>{
      if(!p||typeof p.id!=='string'||!/^added-[a-z0-9-]{8,80}$/.test(p.id)||seen.has(p.id))throw new Error('Invalid new participant ID.');
      seen.add(p.id);
      if(!['firstName','lastName','email','organization','country','countryCode'].every(k=>typeof p[k]==='string'&&p[k].length<=500)||!Array.isArray(p.phones)||p.phones.length>10||p.phones.some(v=>typeof v!=='string'||v.length>100)||!Array.isArray(p.owners)||p.owners.length!==1||!['FH','SM'].includes(p.owners[0])||typeof p.attending!=='boolean'||typeof p.visaRequired!=='boolean')throw new Error('Invalid participant details.');
      if(p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))throw new Error('Enter a valid email address or leave it blank.');
      if((p.countryCode&&!/^[a-z]{2}$/.test(p.countryCode))||!!p.countryCode!==!!p.country)throw new Error('Choose a country or leave it blank.');
      if(![p.firstName,p.lastName,p.email,p.organization,p.country,...p.phones].some(s=>s.trim()))throw new Error('Enter at least one detail to identify this card.');
      return {id:p.id,...Object.fromEntries(['firstName','lastName','email','organization','country','countryCode'].map(k=>[k,p[k].trim()])),phones:p.phones.map(s=>s.trim()).filter(Boolean),owners:[...p.owners],attending:p.attending,visaRequired:p.visaRequired,added:true};
    });
  }
  function mergePeople(people,added=[]){
    const result=[...people];
    for(const p of validateAddedParticipants(added)){
      const existing=result.find(x=>x.id===p.id);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(p))throw new Error('This participant ID already exists with different details.');}
      else result.push(p);
    }
    return result;
  }
  function restoreRecords(incoming,people,current=initialRecords(people)){
    if(Object.keys(incoming||{}).length===people.length)return validateRecords(incoming,people);
    const ids=new Set(Object.keys(incoming||{})),base=people.filter(p=>!p.added),legacy=scopePeople(base,'FH');
    const subset=people.filter(p=>ids.has(p.id));
    if(!ids.size||subset.length!==ids.size||(!base.every(p=>ids.has(p.id))&&!legacy.every(p=>ids.has(p.id))))throw new Error('This backup belongs to a different participant list.');
    return {...current,...validateRecords(incoming,subset)};
  }
  function validateRecords(records, people) {
    if (!records || Array.isArray(records) || typeof records !== 'object') throw new Error('The backup has no participant records.');
    const ids = people.map(p => p.id);
    if (Object.keys(records).length !== ids.length || ids.some(id => !Object.hasOwn(records,id))) throw new Error('This backup belongs to a different participant list.');
    const result = {};
    for (const id of ids) {
      const r = records[id];
      if (!r || fields.some(k => typeof r[k] !== 'boolean') || ('visaRequired' in r&&typeof r.visaRequired!=='boolean') || !Array.isArray(r.notes) || r.notes.length > 2000 || typeof r.draft !== 'string' || r.draft.length > 20000) throw new Error('The backup contains an invalid participant record.');
      const seen = new Set();
      for (const n of r.notes) {
        if (!n || typeof n.id !== 'string' || !n.id || seen.has(n.id) || typeof n.text !== 'string' || n.text.length > 20000 || typeof n.done !== 'boolean' || ('reviewed' in n&&typeof n.reviewed!=='boolean') || typeof n.createdAt !== 'string' || typeof n.updatedAt !== 'string') throw new Error('The backup contains an invalid note.');
        seen.add(n.id);
      }
      result[id] = { ...Object.fromEntries(fields.map(k => [k,r[k]])), visaRequired:r.visaRequired??(people.find(p=>p.id===id).visaRequired!==false), draft:r.draft, notes:r.notes.map(n => ({id:n.id,text:n.text,done:n.done,reviewed:n.reviewed||false,createdAt:n.createdAt,updatedAt:n.updatedAt})) };
    }
    return result;
  }
  function apply(records, op, people) {
    if(op.workspace==='PR'&&!((op.kind==='set'&&['visa','flight','hotel'].includes(op.field))||op.kind==='noteStatus'))throw new Error('PR can update completion and note review only.');
    if (op.kind === 'restore') {
      const merged=mergePeople(people,op.addedParticipants||[]);
      const restored=restoreRecords(op.records,merged,{...initialRecords(merged),...records});
      people.splice(0,people.length,...merged);return restored;
    }
    if (!Object.hasOwn(records,op.person)) throw new Error('Unknown participant.');
    const r=records[op.person];
    if (op.kind === 'set') {
      if (!([...fields,'visaRequired'].includes(op.field) && typeof op.value === 'boolean') && !(op.field === 'draft' && typeof op.value === 'string' && op.value.length <= 20000)) throw new Error('Invalid field update.');
      r[op.field]=op.value;
    } else if (op.kind === 'note') {
      const i=r.notes.findIndex(n=>n.id===op.note.id);
      if(i<0) r.notes.push({...op.note}); else r.notes[i]={...op.note};
    } else if (op.kind === 'noteText') {
      const note=r.notes.find(n=>n.id===op.noteId);
      if(!note||typeof op.text!=='string'||op.text.length>20000)throw new Error('Invalid note text.');
      note.text=op.text;note.updatedAt=op.updatedAt;
    } else if (op.kind === 'noteStatus') {
      const note=r.notes.find(n=>n.id===op.noteId);
      if(!note||!['done','reviewed'].includes(op.field)||typeof op.value!=='boolean')throw new Error('Invalid note status.');
      note[op.field]=op.value;note.updatedAt=op.updatedAt;
    } else if (op.kind === 'deleteNote') r.notes=r.notes.filter(n=>n.id!==op.noteId);
    else throw new Error('Unknown update.');
    return records;
  }
  function normalize(s) {return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();}
  function matches(p,r,f) {
    const q=normalize(f.search||'').trim();
    if(q&&!normalize([p.firstName,p.lastName,p.email,p.organization,p.country,...p.phones,...r.notes.map(n=>n.text)].join(' ')).includes(q))return false;
    if(f.country&&(f.country==='__missing__'?!!p.country:p.country!==f.country))return false;
    if(f.attendance==='attending'&&!r.attending || f.attendance==='not-attending'&&r.attending)return false;
    if(f.priority==='priority'&&!r.priority || f.priority==='normal'&&r.priority)return false;
    const required=r.visaRequired===false?['flight','hotel']:['visa','flight','hotel'],complete=required.every(k=>r[k]);
    if(f.completion==='complete'&&!complete || f.completion==='pending'&&complete)return false;
    for(const key of ['visa','flight','hotel'])if(f.completion===key+'-pending'&&(r[key]||!required.includes(key)))return false;
    return true;
  }
  function totals(records,people) {
    const all=people?people.map(p=>records[p.id]):Object.values(records), attending=all.filter(r=>r.attending);
    return {total:all.length,attending:attending.length,notAttending:all.length-attending.length,priority:all.filter(r=>r.priority).length,
      visaRequired:attending.filter(r=>r.visaRequired!==false).length,visa:attending.filter(r=>r.visaRequired!==false&&r.visa).length,flight:attending.filter(r=>r.flight).length,hotel:attending.filter(r=>r.hotel).length};
  }
  function countrySummary(people,records){
    const groups=new Map();
    for(const person of people){
      const code=person.countryCode;
      if(!code)continue;
      if(!groups.has(code))groups.set(code,{code,country:person.country,people:[],attending:[],priority:[]});
      const group=groups.get(code),record=records[person.id];group.people.push(person);
      if(record.attending)group.attending.push(person);
      if(record.priority)group.priority.push(person);
    }
    return groups;
  }
  const api={DATASET,initialRecords,validateRecords,restoreRecords,validateAddedParticipants,mergePeople,owners,scopePeople,apply,matches,totals,countrySummary};
  if(typeof module!=='undefined')module.exports=api;else root.ConferenceCore=api;
})(typeof window!=='undefined'?window:globalThis);
