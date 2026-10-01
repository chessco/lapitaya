const R='C:/PitayaCode/LaPitaya';const loadTs=require(R+'/test/load-ts.cjs');
const electron=require.resolve(R+'/node_modules/electron');require.cache[electron]={id:electron,filename:electron,loaded:true,exports:{}};
const {CimaRuntimeService}=loadTs('src/main/cimaRuntime.ts');
const fs=require('fs'),os=require('os'),p=require('path');
const d=fs.mkdtempSync(p.join(os.tmpdir(),'v13-'));const hive=p.join(d,'hive');fs.mkdirSync(p.join(hive,'lapitaya'),{recursive:true});
const s=new CimaRuntimeService({hiveRoot:()=>hive,godId:()=>'god'});
for (const tool of ['Bash','PowerShell','shell','run_shell_command']) {
  const t=s.recordTrace('a','PostToolUse',tool,{command:'npm test'},'ok');
  console.log(tool.padEnd(20),'trace.kind =',t.kind);
}
const r=s.submit('a',{taskId:'T',phase:'BUILD',verdict:'PASS',evidence:[{type:'test-result',source:'npm test'}]});
console.log('evidence of codex-style shell trace ->', r.verdict, r.violations);
s.recordTrace('b','PostToolUse','shell',{command:'npm test'},'ok');
const r2=s.submit('b',{taskId:'T2',phase:'BUILD',verdict:'PASS',evidence:[{type:'test-result',source:'npm test'}]});
console.log('agent with ONLY shell/run_shell_command traces ->', r2.verdict, r2.violations);
