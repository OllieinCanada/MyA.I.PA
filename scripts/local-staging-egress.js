// Instrument trusted local application transports. This is not an OS sandbox.
function install({ports=[]}={}){
  const allowed=new Set(ports.map(Number));let blocked=0,unexpected=0,probing=false;
  function deny(){blocked++;if(!probing)unexpected++;throw Object.assign(Error('Local staging egress denied'),{code:'STAGING_EGRESS_DENIED'});}
  const net=require('node:net'),nativeConnect=net.Socket.prototype.connect;
  net.Socket.prototype.connect=function(...args){let first=args[0];if(Array.isArray(first))first=first[0];const host=typeof first==='object'?first.host:args[1],port=typeof first==='object'?first.port:first;if(host!=='127.0.0.1'||!allowed.has(Number(port)))return deny();return nativeConnect.apply(this,args);};
  for(const name of ['node:http','node:https']){const transport=require(name),request=transport.request;transport.request=function(input,...args){let url;try{url=input instanceof URL?input:typeof input==='string'?new URL(input):null;}catch{}const host=url?.hostname||input?.hostname||input?.host,port=Number(url?.port||input?.port);if(host!=='127.0.0.1'||!allowed.has(port))return deny();return request.call(this,input,...args);};transport.get=function(...args){const item=this.request(...args);item.end();return item;};}
  const nativeFetch=global.fetch;global.fetch=async(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.hostname!=='127.0.0.1'||!allowed.has(Number(url.port)))return deny();return nativeFetch(input,{...options,redirect:'error'});};
  const dns=require('node:dns'),lookup=dns.lookup;dns.lookup=(host,...args)=>host==='127.0.0.1'?lookup(host,...args):deny();dns.resolve=deny;
  const child=require('node:child_process');for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
  require('node:dgram').createSocket=deny;
  return{allowPort:port=>allowed.add(Number(port)),status:()=>({blockedTransportAttempts:blocked,unexpectedOutboundAttempts:unexpected,osSandboxProven:false}),async probes(){probing=true;let rejected=0;try{for(const probe of[()=>fetch('https://example.invalid'),()=>require('node:https').request('https://example.invalid'),()=>new net.Socket().connect({host:'203.0.113.1',port:443}),()=>dns.lookup('example.invalid'),()=>child.spawn('untrusted-command'),()=>require('node:dgram').createSocket('udp4')]){try{await probe();}catch(error){if(error.code==='STAGING_EGRESS_DENIED')rejected++;else throw error;}}}finally{probing=false;}return{rejected,...this.status()};}};
}
module.exports={install};
