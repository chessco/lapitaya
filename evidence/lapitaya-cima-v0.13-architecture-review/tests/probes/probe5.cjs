const R='C:/PitayaCode/LaPitaya';const loadTs=require(R+'/test/load-ts.cjs');
const electron=require.resolve(R+'/node_modules/electron');require.cache[electron]={id:electron,filename:electron,loaded:true,exports:{Notification:class{show(){} static isSupported(){return false}}}};
const {HiveManager}=loadTs('src/main/hive.ts');const {HookServer}=loadTs('src/main/hooks.ts');const {CimaRuntimeService}=loadTs('src/main/cimaRuntime.ts');
const fs=require('fs'),os=require('os'),path=require('path');
(async()=>{
const home=fs.mkdtempSync(path.join(os.tmpdir(),'v13h-'));
const hive=new HiveManager(()=>home);
await hive.ensureAgent({id:'god',name:'El Inge',provider:'claude',cwd:home,isGod:true});
await hive.ensureAgent({id:'valentin-1',name:'V',provider:'claude',cwd:home});
console.log('hasRegisteredTokens after ensureAgent:',hive.hasRegisteredTokens());
const l=new CimaRuntimeService({hiveRoot:()=>hive.root(),godId:()=>'god'});
const s=new HookServer(hive,()=>null,()=>({autoMode:true,notifications:false}),undefined,undefined,undefined,undefined,l);
const r=s.handle({agent_id:'valentin-1',hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{file_path:'src/main/hive.ts'}});
console.log(JSON.stringify(r).slice(0,300));
fs.rmSync(home,{recursive:true,force:true});
})();
