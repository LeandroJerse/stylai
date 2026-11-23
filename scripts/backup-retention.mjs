import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function planRetention(files, receipt, folder, now = new Date()) {
 const verified = Date.parse(receipt?.verifiedAt);
 if (!receipt?.archiveId || receipt.folderId !== folder || !Number.isFinite(verified) || verified > now.getTime() || now.getTime()-verified > 86400000) throw Error('Recent verified upload in this folder required');
 const cutoff=now.getTime()-30*86400000;
 const legacy = new Map([['1VwqUu3QkglgFlLQzNTNINf86uTr9nIYX','stylai-20261122-104208.7z'],['1JHicNF7lGUQDgqaOsXrg0ehJD0WLaByw','stylai-20261122-104208.7z.sha256']]);
 return files.filter(file=> file.id && file.id!==receipt.archiveId && !receipt.archiveIds?.includes(file.id) && file.id!==receipt.checksumId && !file.trashed && file.parents?.length===1 && file.parents[0]===folder && (/^stylai-auto-\d{8}T\d{6}Z\.7z(?:\.\d{3}|\.sha256)?$/.test(file.name) || legacy.get(file.id)===file.name) && Number.isFinite(Date.parse(file.createdTime)) && Date.parse(file.createdTime)<cutoff);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const input=JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
 console.log(JSON.stringify(planRetention(input.files,input.receipt,input.folderId),null,2));
}
