import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planRetention} from './backup-retention.mjs';
const folder='approved-folder', now=new Date('2026-11-22T22:00:00Z');
const file=(name,createdTime,id='old')=>({id,name,createdTime,parents:[folder],trashed:false});
const receipt={verifiedAt:now.toISOString(),folderId:folder,archiveId:'latest'};
test('only expired exact backup filenames in the approved folder qualify',()=>{
 const files=[file('stylai-auto-20261020T220000Z.7z','2026-10-20T22:00:00Z'),file('personal.7z','2026-10-01T00:00:00Z'),{...file('stylai-auto-20261020T220000Z.7z','2026-10-20T22:00:00Z','other'),parents:['elsewhere']}];
 assert.deepEqual(planRetention(files,receipt,folder,now).map(f=>f.id),['old']);
});
test('preserves the exact 30-day boundary, new files and latest verified archive',()=>{
 assert.deepEqual(planRetention([file('stylai-auto-20261023T220000Z.7z','2026-10-23T22:00:00Z'),file('stylai-auto-20261020T220000Z.7z','2026-10-20T22:00:00Z','latest')],receipt,folder,now),[]);
});
test('refuses deletion without recent verified upload or with a different folder',()=>{
 assert.throws(()=>planRetention([],null,folder,now));
 assert.throws(()=>planRetention([],{...receipt,verifiedAt:'2026-11-20T00:00:00Z'},folder,now));
 assert.throws(()=>planRetention([],receipt,'elsewhere',now));
});
test('invalid dates, paths and trashed files never qualify',()=>{
 assert.deepEqual(planRetention([file('../stylai-auto-20261020T220000Z.7z','2026-10-20T00:00:00Z'),file('stylai-auto-20261020T220000Z.7z','bad'),{...file('stylai-auto-20261020T220000Z.7z','2026-10-20T00:00:00Z'),trashed:true}],receipt,folder,now),[]);
});
test('the two explicitly identified legacy manual files can expire, no other legacy file can',()=>{
 const files=[file('stylai-20261122-104208.7z','2026-10-01T00:00:00Z','1VwqUu3QkglgFlLQzNTNINf86uTr9nIYX'),file('stylai-20261122-104208.7z','2026-10-01T00:00:00Z','unrelated')];
 assert.deepEqual(planRetention(files,receipt,folder,now).map(f=>f.id),['1VwqUu3QkglgFlLQzNTNINf86uTr9nIYX']);
});
test('expired multipart files qualify but every latest verified part is protected',()=>{
 const multipart={...receipt,archiveIds:['latest','latest-part2']};
 assert.deepEqual(planRetention([file('stylai-auto-20261020T220000Z.7z.001','2026-10-20T22:00:00Z','expired'),file('stylai-auto-20261020T220000Z.7z.002','2026-10-20T22:00:00Z','latest-part2')],multipart,folder,now).map(f=>f.id),['expired']);
});
