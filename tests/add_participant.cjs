// Integration checks use invented contacts and a separate temporary server.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),temp=path.join(__dirname,'.tmp','add-'+Date.now()),site=path.join(temp,'site'),url='http://127.0.0.1:8890';
const python=process.env.DASHBOARD_PYTHON||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
let server,browser;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const healthy=()=>new Promise(resolve=>{const r=http.get(url+'/api/state',res=>{res.resume();resolve(res.statusCode===200)});r.on('error',()=>resolve(false));});
const seed=[{id:'fixture-fh',firstName:'Original',lastName:'FH',email:'',phones:[],organization:'',country:'Brazil',countryCode:'br',owners:['FH'],attending:true},{id:'fixture-sm',firstName:'Original',lastName:'SM',email:'',phones:[],organization:'',country:'Canada',countryCode:'ca',owners:['SM'],attending:true}];
async function start(){server=spawn(python,['-X','utf8',path.join(site,'server.py'),'--port','8890'],{cwd:site,windowsHide:true,stdio:['ignore','pipe','pipe']});let err='';server.stderr.on('data',b=>err+=b);for(let i=0;i<50;i++){if(await healthy())return;await pause(100);}throw Error(err||'Server did not start');}
async function stop(){const current=server;server=null;await new Promise(r=>{current.once('exit',r);current.kill();});}
(async()=>{
 await fs.mkdir(site,{recursive:true});
 for(const file of ['app.js','core.js','map.js','map-data.js','export.js','index.html','styles.css','liquid.css','server.py','favicon.svg'])await fs.copyFile(path.join(root,file),path.join(site,file));
 await fs.cp(path.join(root,'assets'),path.join(site,'assets'),{recursive:true});
 await fs.writeFile(path.join(site,'participants.js'),'window.CONFERENCE_DATA = '+JSON.stringify({participants:seed})+';');await start();
 browser=await chromium.launch({headless:true,executablePath:process.env.DASHBOARD_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage(),pr=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));pr.on('pageerror',e=>errors.push(e.message));
 const ready=async p=>p.getByText('Saved to this computer',{exact:true}).waitFor();
 const switchTo=async ws=>{await page.locator('#workspace-button').click();await page.locator('[data-workspace="'+ws+'"]').click();};
 const pick=async(id,value)=>{await page.locator('#'+id+'-trigger').click();await page.locator('#'+id+'-options [data-value="'+value+'"]').click();};
 await page.goto(url+'/?workspace=FH');await ready(page);await pr.goto(url+'/?workspace=PR');await ready(pr);
 assert(!(await pr.locator('#add-participant').isVisible()));assert.equal(await page.locator('.card').count(),1);
 assert.equal(await page.locator('.map-controls').count(),0);assert.equal(await pr.locator('.map-controls').count(),0);
 await page.locator('.map-country[data-code="br"]').hover();assert((await page.locator('#map-details').textContent()).includes('Original FH'));
 await page.locator('.map-country[data-code="br"]').click();assert.equal(await page.locator('#filter-country').inputValue(),'Brazil');await page.locator('#clear-filters').click();
 await page.bringToFront();await page.locator('#add-participant').click();await page.locator('#save-participant').click();
 assert((await page.locator('#participant-form-error').textContent()).includes('at least one detail'));
 await page.locator('#new-first-name').fill('New guest');await page.locator('#new-last-name').fill('Trial');
 await page.locator('#new-email').fill('trial@example.test');await page.locator('#new-phone').fill('+123 456 789');await page.locator('#new-organization').fill('Example House');
 await page.locator('#new-country-trigger').click();const search=page.locator('#new-country-popup input');await search.fill('Iceland');await page.keyboard.press('Enter');
 assert.equal(await page.locator('#new-country').inputValue(),'is');assert.equal(await page.evaluate(()=>document.activeElement.id),'new-country-trigger');
 await page.locator('#new-visa-required').click();await page.locator('#new-priority').check();await page.locator('.new-card-extra summary').click();await page.locator('#new-flight').check();await page.locator('#new-note').fill('Confirm arrival. متابعة');
 await page.screenshot({path:path.join(temp,'add-form-desktop.png')});
 await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('.card').count(),2);const added=page.locator('.card').filter({hasText:'New guest Trial'}),id=await added.getAttribute('data-person');assert(id.startsWith('added-'));
 assert((await added.textContent()).includes('Example House'));assert(await added.locator('[data-field="flight"]').isChecked());assert(await added.locator('[data-field="visa"]').isDisabled());
 assert(await page.locator('.map-country[data-code="is"]').evaluate(e=>e.classList.contains('has-attendees')));assert.equal(await page.locator('#map-active-count').textContent(),'2');
 await pick('filter-country','Iceland');assert.equal(await page.locator('.card').count(),1);await page.locator('.notes summary').click();assert.equal(await page.locator('[data-action="note-text"]').inputValue(),'Confirm arrival. متابعة');
 const exportWait=page.waitForEvent('download');await page.locator('#export-data').click();await (await exportWait).saveAs(path.join(temp,'export.xlsx'));
 await page.locator('#saving-help').click();const backupWait=page.waitForEvent('download');await page.locator('#help-export').click();const backup=path.join(temp,'backup.json');await (await backupWait).saveAs(backup);await page.locator('#help-dialog .close').click();
 const savedBackup=JSON.parse(await fs.readFile(backup,'utf8'));assert.equal(savedBackup.addedParticipants.length,1);assert.equal(savedBackup.addedParticipants[0].email,'trial@example.test');
 await pr.bringToFront();await pr.waitForFunction(()=>document.getElementById('stat-total').textContent==='3');
 const prCard=pr.locator('[data-person="'+id+'"]');assert(await prCard.locator('[data-action="visa-required"]').isDisabled());await prCard.locator('[data-field="hotel"]').check();await prCard.locator('.notes summary').click();await prCard.locator('[data-action="note-reviewed"]').check();await ready(pr);
 await page.bringToFront();await page.waitForFunction(id=>document.querySelector('[data-person="'+id+'"] [data-field="hotel"]').checked,id);assert(await added.locator('[data-action="note-reviewed"]').isChecked());
 // A duplicate email is rejected without replacing the form or adding another card.
 await page.locator('#add-participant').click();await page.locator('#new-email').fill('TRIAL@example.test');await page.locator('#save-participant').click();assert((await page.locator('#participant-form-error').textContent()).includes('already exists'));await page.locator('#cancel-participant').click();
 await switchTo('SM');assert.equal(await page.locator('.map-controls').count(),0);await page.locator('#add-participant').click();await page.locator('#new-first-name').fill('Only a name');await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('.card').count(),2);assert(await page.getByRole('heading',{name:'Country not provided',exact:true}).isVisible());
 await pick('filter-country','__missing__');assert.equal(await page.locator('.card').count(),1);assert((await page.locator('.card').textContent()).includes('Email not provided'));assert.equal(await page.locator('#map-active-count').textContent(),'1');
 await page.reload();await ready(page);assert.equal(await page.locator('.card').count(),2);
 // A new tiny country gets an interactive point, even if absent from the initial seed.
 await page.locator('#add-participant').click();await page.locator('#new-organization').fill('Tiny-country fixture');await pick('new-country','mc');await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});
 assert(await page.locator('.map-point[data-code="mc"]').isVisible());
 // Network loss after the write must be safe to retry with the same operation ID.
 await page.locator('#add-participant').click();await page.locator('#new-first-name').fill('Retry guest');
 await page.route('**/api/actions',async route=>{await route.fetch();await route.abort('failed');},{times:1});
 await page.locator('#save-participant').click();await page.locator('#participant-form-error').waitFor();assert.equal(await page.locator('#new-first-name').inputValue(),'Retry guest');
 await page.locator('#save-participant').click();await page.locator('#participant-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('.card').filter({hasText:'Retry guest'}).count(),1);
 // Mobile: dialog and keyboard country search remain within the viewport.
 await page.setViewportSize({width:390,height:844});await page.locator('#add-participant').click();await page.locator('#new-first-name').fill('Mobile fixture');await page.locator('#new-country-trigger').click();await page.locator('#new-country-popup input').fill('Japan');
 const bounds=await page.locator('#new-country-popup').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391);await page.keyboard.press('Enter');
 await page.screenshot({path:path.join(temp,'add-form-mobile.png')});await page.keyboard.press('Escape');assert(!(await page.locator('#participant-dialog').isVisible()));
 const before=JSON.parse(await fs.readFile(path.join(site,'data/progress.json'),'utf8'));assert.equal(before.addedParticipants.length,4);
 await stop();await start();await page.reload();await ready(page);assert.equal(await page.locator('.card').count(),4);
 assert.equal((await fs.readFile(path.join(site,'participants.js'),'utf8')).includes('Retry guest'),false,'New contacts belong in private progress, not source files');
 const after=JSON.parse(await fs.readFile(path.join(site,'data/progress.json'),'utf8'));assert.deepEqual(after,before);
 for(const [version,count] of [['1',1],['2',2],['3',6]]){const response=await context.request.get(url+'/api/state',{headers:{'X-Conference-Roster':version}});assert.equal(Object.keys((await response.json()).records).length,count);}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['optional details','duplicate email prevention','FH and SM creation','PR synchronization and restrictions','new country filters and map points','initial note and status','backup data','Excel export download','reload and server restart','safe ambiguous retry','legacy clients','mobile and keyboard dialog'],artifacts:temp}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await stop();});
