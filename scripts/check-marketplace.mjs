const version=process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Expected semver version');
const body={filters:[{criteria:[{filterType:7,value:'armotusitio.orquestivo'}]}],flags:1};
let found=false;
for(let attempt=1;attempt<=60;attempt++){
  try{
    const response=await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json;api-version=3.0-preview.1'},body:JSON.stringify(body)
    });
    if(!response.ok) throw new Error('HTTP '+response.status);
    const data=await response.json();
    if((data.results?.[0]?.extensions?.[0]?.versions ?? []).some(v=>v.version===version)){found=true;break;}
  }catch(error){console.error(error instanceof Error?error.message:String(error));}
  await new Promise(resolve=>setTimeout(resolve,15000));
}
if(!found){console.error('Marketplace version '+version+' not visible');process.exitCode=1;}
else console.log('Marketplace version '+version+' confirmed');
