const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('secondary pages are dynamic imports while homepage remains immediately available',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/index.js'),'utf8');
 for(const page of ['AdminDashboard','CustomerDashboard','Signup','ForwardingSetup','TryDemo']) {
  assert.ok(!new RegExp('import '+page+' from').test(source));assert.match(source,new RegExp('const '+page+'=React.lazy'));
 }
 assert.match(source,/import App from/);assert.match(source,/React.Suspense/);assert.match(source,/<RouteBoundary route=\{route\}/);
 for(const route of ['hashchange','popstate','forwarding-setup','demo/first-class-rentals'])assert.ok(source.includes(route));
});
test('timeline uses container-sized cards outside legacy admin metadata styling',()=>{
 const root=path.join(__dirname,'..');
 const admin=fs.readFileSync(path.join(root,'src/AdminDashboard.js'),'utf8');
 const css=fs.readFileSync(path.join(root,'src/components/CallOutcomeTimeline.css'),'utf8');
 assert.match(admin,/<CallOutcomeTimeline call=\{selectedCall\}\/>\s*<div className="admin-call-detail-meta">/);
 assert.ok(css.includes('repeat(auto-fit,minmax(min(100%,360px),1fr))'));
 assert.ok(!css.includes('min-width:1000px'));
});
