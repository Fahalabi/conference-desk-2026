const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
const people=[{id:'a',firstName:'Mélody',lastName:'Test',email:'a',organization:'Org',country:'France',phones:[],attending:true},{id:'b',firstName:'Other',lastName:'Guest',email:'b',organization:'Org2',country:'Canada',phones:['1234567'],attending:false}];
test('Shared views preserve legacy records and waive unneeded visa completion',()=>{
 const roster=people.map((p,i)=>({...p,owners:[i?'SM':'FH'],visaRequired:!i,attending:true}));
 const records=C.initialRecords(roster);records.b.flight=true;records.b.hotel=true;
 assert.equal(C.scopePeople(roster,'PR').length,2);assert.equal(C.scopePeople(roster,'SM')[0].id,'b');
 assert(C.matches(roster[1],records.b,{completion:'complete'}));assert(!C.matches(roster[1],records.b,{completion:'visa-pending'}));
 assert.equal(C.totals(records,roster).visaRequired,1);
 const restored=C.restoreRecords({a:{...records.a,draft:'legacy draft'}},roster,records);
 assert.equal(restored.a.draft,'legacy draft');assert(restored.b.flight);
});
test('PR can review a note without editing its text or participant details',()=>{
 const records=C.initialRecords(people);records.a.notes=[{id:'n',text:'Original',done:false,reviewed:false,createdAt:'date',updatedAt:'date'}];
 assert.throws(()=>C.apply(records,{workspace:'PR',kind:'set',person:'a',field:'attending',value:false},people));
 C.apply(records,{workspace:'PR',kind:'noteStatus',person:'a',noteId:'n',field:'reviewed',value:true,updatedAt:'review'},people);
 C.apply(records,{workspace:'FH',kind:'noteText',person:'a',noteId:'n',text:'Updated',updatedAt:'edit'},people);
 assert(records.a.notes[0].reviewed);assert.equal(records.a.notes[0].text,'Updated');
});
test('Totals exclude non-attending people without destroying completed work',()=>{
 const r=C.initialRecords(people);r.a.visa=true;r.b.flight=true;
 assert.equal(C.totals(r).visa,1);assert.equal(C.totals(r).flight,0);
 C.apply(r,{kind:'set',person:'b',field:'attending',value:true},people);
 assert.equal(C.totals(r).flight,1);assert.equal(C.totals(r).attending,2);
});
test('Filters combine and accent-insensitive search includes notes',()=>{
 const r=C.initialRecords(people);r.a.priority=true;r.a.notes=[{text:'Urgent follow-up'}];
 assert(C.matches(people[0],r.a,{search:'melody',priority:'priority',country:'France'}));
 assert(C.matches(people[0],r.a,{search:'follow-up'}));
 assert(!C.matches(people[0],r.a,{attendance:'not-attending'}));
 assert(!C.matches(people[0],r.a,{completion:'complete'}));
 r.a.visa=true;assert(!C.matches(people[0],r.a,{completion:'visa-pending'}));
});
test('Invalid backups cannot remove participants or coerce boolean statuses',()=>{
 const r=C.initialRecords(people);assert.deepEqual(C.validateRecords(r,people),r);
 delete r.b;assert.throws(()=>C.validateRecords(r,people));
 const bad=C.initialRecords(people);bad.a.visa='yes';assert.throws(()=>C.validateRecords(bad,people));
});
test('Note changes do not affect arrangement completion counts',()=>{
 const r=C.initialRecords(people);const note={id:'n',text:'Call',done:true,createdAt:'2026-09-22',updatedAt:'2026-09-22'};
 C.apply(r,{kind:'note',person:'a',note},people);assert.equal(C.totals(r).visa,0);
 C.apply(r,{kind:'note',person:'a',note:{...note,text:'Changed'}},people);assert.equal(r.a.notes.length,1);
 C.apply(r,{kind:'deleteNote',person:'a',noteId:'n'},people);assert.equal(r.a.notes.length,0);
});
test('Map country counts use attendance while urgency includes non-attendees',()=>{
 const peopleWithCodes=people.map((p,i)=>({...p,countryCode:i?'ca':'fr'}));
 const records=C.initialRecords(peopleWithCodes);records.b.priority=true;
 const summary=C.countrySummary(peopleWithCodes,records);
 assert.equal(summary.get('ca').attending.length,0);
 assert.equal(summary.get('ca').priority.length,1);
 assert.equal(summary.get('fr').attending.length,1);
 records.a.attending=false;
 assert.equal(C.countrySummary(peopleWithCodes,records).get('fr').attending.length,0);
});
test('Map has unique country codes and coverage for every participant',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const context=vm.createContext({window:{}});
 const participantFile=fs.existsSync(path.join(__dirname,'..','participants.js'))?'participants.js':'participants.example.js';
 for(const file of [participantFile,'map-data.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
 const map=context.window.CONFERENCE_MAP.countries,codes=new Set(map.map(c=>c.code));
 assert.equal(map.length,codes.size);
 for(const p of context.window.CONFERENCE_DATA.participants)assert(codes.has(p.countryCode),p.countryCode);
 const country=code=>map.find(c=>c.code===code);
 assert(country('ki').area<500,'Small island geometry must not cover the world');
 assert(map.every(c=>c.area<1100*550/3),'No feature has an inverted world-spanning ring');
 assert(country('br').center[0]<550 && country('br').center[1]>275,'Brazil in western/southern map');
 assert(country('cn').center[0]>550 && country('cn').center[1]<275,'China in eastern/northern map');
 assert(country('au').center[0]>550 && country('au').center[1]>275,'Australia in eastern/southern map');
});
