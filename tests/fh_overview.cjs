// Only invented participants. Live files are never touched.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),{chromium}=require('playwright'),C=require('../core.js');
const root=path.resolve(__dirname,'..'),temp=path.join(__dirname,'.tmp','overview-'+Date.now()),site=path.join(temp,'site'),url='http://127.0.0.1:8891';
const python=process.env.DASHBOARD_PYTHON||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
let server,browser;const pause=ms=>new Promise(r=>setTimeout(r,ms));
const seed=[
 {id:'fh-original',firstName:'Morgan',lastName:'Guest',email:'morgan@example.test',phones:['+123','+456'],organization:'Paper House',country:'France',countryCode:'fr',owners:['FH'],attending:true,visaRequired:true},
 {id:'fh-absent',firstName:'Taylor',lastName:'Guest',email:'taylor@example.test',phones:[],organization:'Fern Press',country:'Canada',countryCode:'ca',owners:['FH'],attending:false,visaRequired:false},
 {id:'sm-archive',firstName:'Casey',lastName:'Archive',email:'casey@example.test',phones:['+999'],organization:'Amber Editions',country:'Canada',countryCode:'ca',owners:['SM'],attending:true,visaRequired:false}
];
const healthy=()=>new Promise(resolve=>{const r=http.get(url+'/api/state',res=>{res.resume();resolve(res.statusCode===200)});r.on('error',()=>resolve(false));});
async function start(){server=spawn(python,['-X','utf8',path.join(site,'server.py'),'--port','8891'],{cwd:site,windowsHide:true,stdio:['ignore','pipe','pipe']});let err='';server.stderr.on('data',b=>err+=b);for(let i=0;i<70;i++){if(await healthy())return;await pause(100);}throw Error(err||'Server did not start');}
async function stop(){const current=server;server=null;await new Promise(r=>{current.once('exit',r);current.kill();});}
(async()=>{
 await fs.mkdir(path.join(site,'data'),{recursive:true});
 for(const file of ['app.js','core.js','map.js','map-data.js','export.js','index.html','styles.css','liquid.css','server.py','favicon.svg'])await fs.copyFile(path.join(root,file),path.join(site,file));
 await fs.cp(path.join(root,'assets'),path.join(site,'assets'),{recursive:true});
 await fs.writeFile(path.join(site,'participants.js'),'window.CONFERENCE_DATA = '+JSON.stringify({participants:seed})+';');
 const records=C.initialRecords(seed);records['fh-original'].flight=true;records['fh-original'].notes=[{id:'keep-note',text:'Keep this follow-up',done:true,reviewed:true,createdAt:'2026-09-22',updatedAt:'2026-09-22'}];records['sm-archive'].notes=[{id:'archive-note',text:'Private archived note',done:false,reviewed:false,createdAt:'2026-09-22',updatedAt:'2026-09-22'}];
 await fs.writeFile(path.join(site,'data/progress.json'),JSON.stringify({schemaVersion:1,datasetId:C.DATASET,revision:7,updatedAt:'2026-09-22T07:00:00Z',applied:[],addedParticipants:[],records}));await start();
 browser=await chromium.launch({headless:true,executablePath:process.env.DASHBOARD_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),overview=await context.newPage(),errors=[];
 for(const p of [page,overview])p.on('pageerror',e=>errors.push(e.message));
 const ready=async p=>p.getByText('Saved to this computer',{exact:true}).waitFor();
 const pick=async(id,value)=>{await page.locator('#'+id+'-trigger').click();await page.locator('#'+id+'-options [data-value="'+value+'"]').click();};
 const post=op=>context.request.post(url+'/api/actions',{headers:{'X-Conference-Client':'local-dashboard','X-Conference-Roster':'3'},data:{datasetId:C.DATASET,operations:[op]}});
 const snapshot=async()=> (await context.request.get(url+'/api/state',{headers:{'X-Conference-Roster':'3'}})).json();
 await page.goto(url+'/?workspace=FH');await ready(page);await overview.goto(url+'/?workspace=PR');await ready(overview);
 assert.equal(await page.locator('.card').count(),2);assert.equal(await overview.locator('.participant-mini').count(),3);
 assert.equal(await page.locator('[data-workspace="SM"],[data-workspace="PR"]').count(),0);assert.equal(await page.locator('#workspace-menu [data-workspace]').count(),2);
 assert.equal(await overview.locator('#stat-total').textContent(),'3');assert.equal(await overview.locator('#stat-attendance').textContent(),'2 attending · 1 not attending');
 assert.equal(await overview.locator('#report-countries').textContent(),'2');assert.equal(await overview.locator('#report-waived').textContent(),'1');
 for(const id of ['add-participant','export-data','restore-backup','saving-help'])assert(!(await overview.locator('#'+id).isVisible()));
 assert.equal(await overview.locator('.participant-mini input,.participant-mini button,.participant-mini textarea,.participant-mini details').count(),0);
 for(const content of ['morgan@example.test','+999','Private archived note','Keep this follow-up'])assert(!(await overview.locator('body').innerText()).includes(content));
 const first=page.locator('[data-person="fh-original"]');await first.locator('[data-action="edit-person"]').click();
 assert.equal(await page.locator('#new-phone').inputValue(),'+123\n+456');assert(!(await page.locator('.new-card-settings').isVisible()));
 await page.locator('#new-email').fill('CASEY@example.test');await page.locator('#save-participant').click();assert((await page.locator('#participant-form-error').textContent()).includes('already exists'));
 await page.locator('#new-first-name').fill('Mélody');await page.locator('#new-last-name').fill('Updated');await page.locator('#new-email').fill('changed@example.test');await page.locator('#new-organization').fill('New Paper House');await page.locator('#new-phone').fill('+777\n+888');await pick('new-country','jp');
 await page.locator('#participant-dialog').waitFor({state:'visible'});await page.screenshot({animations:'disabled',path:path.join(temp,'edit-desktop.png')});await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});
 assert((await first.textContent()).includes('Mélody Updated'));assert((await first.textContent()).includes('Japan'));assert(await first.locator('[data-field="flight"]').isChecked());
 await first.locator('.notes summary').click();assert.equal(await first.locator('[data-action="note-text"]').inputValue(),'Keep this follow-up');assert(await first.locator('[data-action="note-reviewed"]').isChecked());
 await overview.bringToFront();await overview.waitForFunction(()=>document.querySelector('[data-person="fh-original"]')?.textContent.includes('Mélody Updated'));
 await overview.locator('#search').fill('Amber');assert.equal(await overview.locator('.participant-mini').count(),1);assert.equal(await overview.locator('#stat-total').textContent(),'3');await overview.locator('#clear-filters').click();
 await overview.locator('.country-report summary').click();assert.equal(await overview.locator('#country-report-body tr').count(),2);
 const immutable=await snapshot();for(const workspace of ['OV','PR','SM'])assert.equal((await post({id:crypto.randomUUID(),workspace,kind:'set',person:'fh-original',field:'hotel',value:true})).status(),400);
 assert.equal((await post({id:crypto.randomUUID(),workspace:'FH',kind:'set',person:'sm-archive',field:'hotel',value:true})).status(),400);assert.deepEqual(await snapshot(),immutable);
 // A request whose response is lost remains safe to retry exactly once.
 await page.bringToFront();await first.locator('[data-action="edit-person"]').click();await page.locator('#new-organization').fill('Confirmed Press');
 await page.route('**/api/actions',async route=>{await route.fetch();await route.abort('failed');},{times:1});await page.locator('#save-participant').click();await page.locator('#participant-form-error').waitFor();assert(await page.locator('#new-organization').isDisabled());
 await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});assert((await first.textContent()).includes('Confirmed Press'));
 // Another tab changing details must not be overwritten by a stale form.
 await first.locator('[data-action="edit-person"]').click();const state=await snapshot(),previous=state.participantEdits['fh-original'];
 assert.equal((await post({id:crypto.randomUUID(),workspace:'FH',kind:'editParticipant',person:'fh-original',previous,details:{...previous,organization:'Other tab Press'}})).status(),200);
 await page.locator('#new-organization').fill('Stale form');await page.locator('#save-participant').click();await page.locator('#participant-form-error').waitFor({state:'visible'});assert((await page.locator('#participant-form-error').textContent()).includes('another tab'));await page.locator('#cancel-participant').click();await page.reload();await ready(page);
 // New cards and their later edits are reflected in the overview and backups.
 await page.locator('#add-participant').click();await page.locator('#new-first-name').fill('New guest');await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});
 const addition=page.locator('.card').filter({hasText:'New guest'}),addedId=await addition.getAttribute('data-person');await addition.locator('[data-action="edit-person"]').click();await page.locator('#new-organization').fill('Edited New House');await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});
 await page.locator('#saving-help').click();const download=page.waitForEvent('download');await page.locator('#help-export').click();const backup=path.join(temp,'backup.json');await (await download).saveAs(backup);await page.locator('#help-dialog .close').click();
 const savedBackup=JSON.parse(await fs.readFile(backup,'utf8'));assert.equal(savedBackup.participantEdits[addedId].organization,'Edited New House');assert.equal(savedBackup.participantEdits['fh-original'].email,'changed@example.test');
 const exportWait=page.waitForEvent('download');await page.locator('#export-data').click();await (await exportWait).saveAs(path.join(temp,'export.xlsx'));
 await addition.locator('[data-action="edit-person"]').click();await page.locator('#new-organization').fill('After backup');await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});
 await page.locator('#backup-file').setInputFiles(backup);await page.locator('#confirm-dialog').waitFor();await page.locator('#confirm-restore').click();await ready(page);await page.waitForFunction(id=>document.querySelector('[data-person="'+id+'"]')?.textContent.includes('Edited New House'),addedId);
 const finalState=await snapshot();assert.deepEqual(finalState.records['sm-archive'],records['sm-archive']);assert.equal(finalState.participantEdits[addedId].organization,'Edited New House');
 await overview.bringToFront();await overview.waitForFunction(()=>document.getElementById('stat-total').textContent==='4');await overview.locator('.country-report summary').click();await overview.screenshot({animations:'disabled',path:path.join(temp,'overview-desktop.png'),fullPage:true});
 await overview.setViewportSize({width:390,height:844});await overview.screenshot({animations:'disabled',path:path.join(temp,'overview-mobile.png'),fullPage:true});assert(await overview.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.bringToFront();await page.setViewportSize({width:390,height:844});await first.locator('[data-action="edit-person"]').click();await page.locator('#participant-dialog').waitFor({state:'visible'});await page.screenshot({animations:'disabled',path:path.join(temp,'edit-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.keyboard.press('Escape');
 await stop();await start();await page.reload();await ready(page);assert((await first.textContent()).includes('Other tab Press'));assert.deepEqual((await snapshot()).records,finalState.records);
 await overview.goto(url+'/?workspace=SM');await ready(overview);assert.equal(await overview.locator('body').getAttribute('data-workspace'),'FH');assert.equal(await overview.locator('.map-controls').count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,artifacts:temp,checks:['FH editing','archived data preserved','combined compact overview','numerical reports and filters','read-only operations','email collision','multiple phones','stable IDs and notes','cross-tab synchronization','stale edit protection','ambiguous retry','backup restore','Excel export','restart','mobile']}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await stop();});
