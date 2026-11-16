'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const React=Module.createRequire(require.resolve('react-dom/package.json'))('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file){const full=path.resolve(__dirname,'../src',file),code=require('@babel/core').transformFileSync(full,{configFile:false,babelrc:false,presets:[require.resolve('@babel/preset-react')],plugins:[require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
 const mod=new Module(full,module);mod.filename=full;mod.paths=Module._nodeModulePaths(path.dirname(full));const original=mod.require.bind(mod);mod.require=name=>name==='react'?React:name.endsWith('.css')?{}:original(name);mod._compile(code,full);return mod.exports;}
test('actual bug-history component starts unknown with no repair, resend or deletion controls',()=>{
 const Component=load('SignupBugHistory.js').default,html=renderToStaticMarkup(React.createElement(Component,{attemptId:'signup_'+'a'.repeat(32)}));
 assert.match(html,/Bug history for this signup/);assert.match(html,/No automatic repair/);assert.match(html,/History is not loaded/);assert.doesNotMatch(html,/No captured reports|Resend|Buy number|Delete history/);
});
test('actual maintenance component and notices use Toronto time and do not promise application health',()=>{
 const {default:Component,MaintenanceNotice}=load('ProviderMaintenance.js'),initial=renderToStaticMarkup(React.createElement(Component));
 assert.match(initial,/availability is not verified/);assert.doesNotMatch(initial,/All systems operational/);
 const notice={title:'Synthetic <script>',kind:'maintenance',status:'scheduled',start:'2026-11-18T02:00:00Z',end:'2026-11-18T03:00:00Z',components:['Administration'],description:'Provider report only',updatedAt:'2026-11-16T10:00:00Z',sourceUrl:'https://status.render.com/incidents/fixture1'};
 const html=renderToStaticMarkup(React.createElement(MaintenanceNotice,{notice}));assert.match(html,/Nov 17, 2026, 9:00 p.m. EST/);assert.match(html,/not proof/i);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<button|Resend|Retry purchase/);
});
