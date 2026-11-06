import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const [vsix,flag]=process.argv.slice(2);
if(!vsix||flag!=='--trusted-publishing')throw new Error('Usage: node scripts/open-vsx-publish.mjs file.vsix --trusted-publishing');
const {publisher,name,version}=JSON.parse(readFileSync('package.json','utf8'));
function publish(){
  return new Promise(resolve=>{
    const env={...process.env};delete env.OVSX_PAT;delete env.OVSX_TOKEN;
    const child=spawn('npx',['--no-install','ovsx','publish',vsix,'--skip-duplicate','--trusted-publishing'],{env,stdio:['ignore','pipe','pipe']});
    let output='';
    const collect=bytes=>{output+=String(bytes);process.stdout.write(bytes);};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>resolve({code:1,output:output+String(error)}));
    child.on('close',code=>resolve({code:code??1,output}));
  });
}
let accepted=false;
for(let attempt=1;attempt<=3;attempt++){
  const result=await publish();
  if(result.code===0||/already published, but currently isn't active/i.test(result.output)){accepted=true;break;}
  if(/unauthori[sz]ed|forbidden|invalid access token|OIDC|trusted publisher/i.test(result.output)||attempt===3)throw new Error('Open VSX publish failed: '+result.output);
  await new Promise(resolve=>setTimeout(resolve,10000*attempt));
}
let active=false;
if(accepted){for(let attempt=0;attempt<20;attempt++){
  try{const response=await fetch(`https://open-vsx.org/api/${publisher}/${name}/${version}`);
    const json=await response.json();if(json.version===version){active=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,15000));
}}
if(active)console.log('Open VSX version confirmed');
else console.log('::warning title=Open VSX::Version not active; verify namespace and registry publication state.');
