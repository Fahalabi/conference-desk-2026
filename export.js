/* Offline XLSX export: inline-string worksheets inside a standard, uncompressed ZIP.
   Text stays text (including phone numbers and strings beginning with =, + or @). */
(() => {
  'use strict';
  const encoder=new TextEncoder();
  const xml=value=>String(value??'').replace(/_x([0-9a-f]{4})_/gi,'_x005F_x$1_')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,c=>'_x'+c.charCodeAt(0).toString(16).padStart(4,'0')+'_')
    .replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const crcTable=Array.from({length:256},(_,i)=>{for(let bit=0;bit<8;bit++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
  function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function zip(files){
    const local=[],central=[];let offset=0,centralSize=0;
    for(const [filename,content] of Object.entries(files)){
      const name=encoder.encode(filename),data=encoder.encode(content),crc=crc32(data);
      const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,33,true);
      h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);
      const entry=new Uint8Array(46+name.length),c=new DataView(entry.buffer);
      c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(14,33,true);
      c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);entry.set(name,46);
      local.push(header,data);central.push(entry);offset+=header.length+data.length;centralSize+=entry.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob([...local,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  const column=index=>{let result='';for(index++;index;index=Math.floor((index-1)/26))result=String.fromCharCode(65+(index-1)%26)+result;return result;};
  function cell(value,row,index,style=2){
    const ref=column(index)+row;
    return typeof value==='number'?`<c r="${ref}" s="${style}"><v>${value}</v></c>`:`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }
  function sheet(headers,rows,widths,noteSheet=false){
    const last=column(headers.length-1)+(rows.length+1);
    return declaration+`<worksheet xmlns="${ns}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData><row r="1" ht="32" customHeight="1">${headers.map((h,i)=>cell(h,1,i,1)).join('')}</row>${rows.map((r,index)=>`<row r="${index+2}" ht="${noteSheet?64:36}" customHeight="1">${r.values.map((v,i)=>cell(v,index+2,i,r.styles?.[i]||r.style||2)).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  }
  const styles=declaration+`<styleSheet xmlns="${ns}"><fonts count="4"><font><sz val="11"/><color rgb="FF413D3A"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF347446"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFB43F45"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFBB5817"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE5E1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6EC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBF0EF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6">${[[0,0],[1,2],[0,0],[3,3],[2,4],[0,5]].map(([font,fill])=>`<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  function workbook(people,records){
    const ordered=[...people].sort((a,b)=>a.country.localeCompare(b.country)||a.lastName.localeCompare(b.lastName)||a.firstName.localeCompare(b.firstName)),participants=[],notes=[];
    for(const p of ordered){
      const r=records[p.id],required=r.visaRequired===false?['flight','hotel']:['visa','flight','hotel'],complete=required.filter(k=>r[k]).length,owner=(p.owners||['FH']).join(', ');
      participants.push({values:[p.country,p.firstName,p.lastName,p.email,p.phones.join('\n'),p.organization,r.attending?'Attending':'Not attending',r.priority?'Priority':'Normal',r.visaRequired===false?'Not required':r.visa?'Completed':'Pending',r.flight?'Completed':'Pending',r.hotel?'Completed':'Pending',complete,r.notes.length,r.notes.filter(n=>!n.done).length,owner,r.visaRequired===false?'Not required':'Required',p.sourceStatus?.visa||'',p.sourceStatus?.flight||'',p.sourceStatus?.remarks||'',p.contactReview||''],style:r.priority?3:2,styles:{6:r.attending?4:3,7:r.priority?3:2,8:r.visa||r.visaRequired===false?4:5,9:r.flight?4:5,10:r.hotel?4:5}});
      for(const n of r.notes)notes.push({values:[p.country,p.firstName,p.lastName,p.email,n.text,n.done?'Completed':'Open',n.createdAt,n.updatedAt,n.reviewed?'Reviewed':'Not reviewed',owner],styles:{5:n.done?4:5}});
      if(r.draft)notes.push({values:[p.country,p.firstName,p.lastName,p.email,r.draft,'Draft','','','',owner],style:5});
    }
    const relns='http://schemas.openxmlformats.org/package/2006/relationships',docrel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    return zip({
      '[Content_Types].xml':declaration+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      '_rels/.rels':declaration+`<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${docrel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml':declaration+`<workbook xmlns="${ns}" xmlns:r="${docrel}"><bookViews><workbookView/></bookViews><sheets><sheet name="Participants" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':declaration+`<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${docrel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${docrel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${docrel}/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml':styles,
      'xl/worksheets/sheet1.xml':sheet(['Country','First name','Last name','Email','Phone numbers','Organization','Attendance','Priority','Visa','Flight','Hotel','Completed arrangements','Total notes','Open notes','Owner','Visa requirement','Source visa status','Source flight status','Source remarks','Contact review'],participants,[24,21,24,38,25,42,19,14,16,16,16,22,14,14,12,19,20,25,50,45]),
      'xl/worksheets/sheet2.xml':sheet(['Country','First name','Last name','Email','Note','Status','Created (UTC)','Updated (UTC)','Review','Owner'],notes,[24,21,24,38,85,16,29,29,18,12],true)
    });
  }
  window.ConferenceExport={workbook};
})();
