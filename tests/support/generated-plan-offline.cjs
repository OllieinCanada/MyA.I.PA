'use strict';
// Bounded independent interpreter for this generated Liquid subset only.
// It executes the generated template, not a copied guard decision. NOT Vapi or
// LiquidJS parity evidence. Unsupported syntax throws instead of being ignored.
function renderSubset(source,messages){
 const tokens=source.split(/({%[\s\S]*?%})/g).filter(Boolean).map(s=>s.startsWith('{%')?{tag:s.slice(2,-2).trim()}:{text:s});let i=0;
 const keyword=()=>tokens[i]?.tag?.split(/\s+/)[0];
 function block(stops=[]){const nodes=[];while(i<tokens.length){const t=tokens[i];if(t.tag&&stops.includes(keyword()))break;if(!t.tag){nodes.push(t);i++;continue;}
  if(keyword()==='assign'){const m=/^assign (\w+) = ([\s\S]+)$/.exec(t.tag);if(!m)throw Error('Unsupported assign');nodes.push({assign:m[1],value:m[2]});i++;}
  else if(keyword()==='for'){const m=/^for (\w+) in (\w+)$/.exec(t.tag);if(!m)throw Error('Unsupported for');i++;const body=block(['endfor']);if(keyword()!=='endfor')throw Error('Missing endfor');i++;nodes.push({loop:m[1],over:m[2],body});}
  else if(keyword()==='if'){const branches=[];let condition=t.tag.slice(3);i++;branches.push({condition,body:block(['elsif','else','endif'])});while(keyword()==='elsif'){condition=tokens[i].tag.slice(6);i++;branches.push({condition,body:block(['elsif','else','endif'])});}if(keyword()==='else'){i++;branches.push({condition:null,body:block(['endif'])});}if(keyword()!=='endif')throw Error('Missing endif');i++;nodes.push({branches});}
  else throw Error('Unsupported generated tag '+t.tag);
 }return nodes;}
 const ast=block();if(i!==tokens.length)throw Error('Unconsumed template');const state={messages};
 function atom(v){v=v.trim();if(/^'[^']*'$/.test(v))return v.slice(1,-1);if(v==='true')return true;if(v==='false')return false;if(/^-?\d+$/.test(v))return Number(v);if(!/^[\w.]+$/.test(v))throw Error('Unsupported expression '+v);return v.split('.').reduce((o,k)=>o!=null&&Object.hasOwn(Object(o),k)?o[k]:undefined,state);}
 function value(expr){const parts=expr.split('|').map(s=>s.trim());let v=atom(parts.shift());for(const item of parts){const m=/^(\w+)(?::\s*([\s\S]+))?$/.exec(item);if(!m)throw Error('Unsupported filter');const args=m[2]?m[2].split(',').map(atom):[];
  if(m[1]==='default')v=v==null||v===false||v===''?args[0]:v;else if(m[1]==='downcase')v=String(v??'').toLowerCase();else if(m[1]==='strip')v=String(v??'').trim();else if(m[1]==='slice'){const text=String(v??'');const start=args[0]<0?Math.max(0,text.length+args[0]):args[0];v=text.slice(start,start+args[1]);}else throw Error('Unsupported filter '+m[1]);
 }return v;}
 const truthy=v=>v!==false&&v!=null;
 function condition(expr){const m=/^([\s\S]+?)\s+(==|!=)\s+([\s\S]+)$/.exec(expr);return m?(m[2]==='=='?value(m[1])===value(m[3]):value(m[1])!==value(m[3])):truthy(value(expr));}
 function execute(nodes){let result='';for(const n of nodes){if(n.text!=null)result+=n.text;else if(n.assign)state[n.assign]=value(n.value);else if(n.loop){const list=value(n.over);if(!Array.isArray(list)||list.length>1000)throw Error('Unsupported loop input');for(const item of list){state[n.loop]=item;result+=execute(n.body);}}else{const b=n.branches.find(b=>b.condition===null||condition(b.condition));if(b)result+=execute(b.body);}}return result;}
 const output=execute(ast).trim();if(!['true','false'].includes(output))throw Error('Liquid condition did not return a boolean');return output;
}
function evaluateGeneratedPlan(plan,messages,renderLiquid=renderSubset){
 function matches(c){if(c.type==='group')return c.operator==='OR'?c.conditions.some(matches):c.conditions.every(matches);if(c.type==='liquid')return renderLiquid(c.liquid,messages)==='true';if(c.type!=='regex')throw Error('Unsupported condition');const filtered=c.target?.role?messages.filter(m=>m.role===c.target.role):messages;const p=c.target?.position??-1;const m=filtered[p<0?filtered.length+p:p];const matched=new RegExp(c.regex.replace(/^\(\?i\)/,''),'i').test(typeof m?.content==='string'?m.content:'');return c.negate?!matched:matched;}
 return !plan.conditions.every(matches);
}
module.exports={evaluateGeneratedPlan,renderSubset};
