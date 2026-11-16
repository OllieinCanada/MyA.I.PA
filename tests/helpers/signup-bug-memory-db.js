'use strict';
const {signupBusinessKey}=require('../../server/signupBusinessIdentity');
function fixture(){const rows=new Map(),attempts=new Map();let records=[],tail=Promise.resolve(),ordinal=0,writes=0,reads=0;
 const matches=(row,where={})=>{
  if(where.AND&&!where.AND.every(rule=>matches(row,rule)))return false;
  if(typeof where.key==='string'&&row.key!==where.key)return false;
  if(where.key?.startsWith&&!row.key.startsWith(where.key.startsWith))return false;
  if(where.data){let value=row.data;for(const part of where.data.path)value=value?.[part];if(value!==where.data.equals)return false;}
  return true;
 };
 const store=map=>({findUnique:async({where})=>{reads++;return map.has(where.key)?structuredClone(map.get(where.key)):null;},
  create:async({data})=>{writes++;if(map.has(data.key))throw Error('duplicate');const row={...structuredClone(data),createdAt:new Date(++ordinal*1000)};map.set(data.key,row);return structuredClone(row);},
  findMany:async({where,orderBy,take,cursor,skip=0})=>{reads++;let all=[...map.values()].sort((a,b)=>b.createdAt-a.createdAt||b.key.localeCompare(a.key));if(cursor){const index=all.findIndex(row=>row.key===cursor.key);all=index<0?[]:all.slice(index+skip);}return structuredClone(all.filter(row=>matches(row,where)).slice(0,take));}});
 const signupAttempt={findUnique:async({where})=>attempts.get(where.eventKey)||null,findMany:async({where})=>[...attempts.values()].filter(row=>where.eventKey.in.includes(row.eventKey))};
 const prisma={runtimeStore:store(rows),signupAttempt,$transaction:fn=>{const task=tail.then(async()=>{const snapshot=new Map(structuredClone([...rows]));const result=await fn({runtimeStore:store(snapshot),signupAttempt,$queryRaw:async()=>[]});rows.clear();for(const [key,row]of snapshot)rows.set(key,row);return result;});tail=task.catch(()=>{});return task;}};
 function add(fill='a'){const attemptId='signup_'+fill.repeat(32),payload={business:{name:'Synthetic business '+fill},owner:{email:fill+'@private.example.invalid',phone:'+19055550123'}};const record={signupAttemptId:attemptId,businessName:payload.business.name,ownerEmail:payload.owner.email,ownerPhone:payload.owner.phone};attempts.set(attemptId,{eventKey:attemptId,payload});records.push(record);return {attemptId,payload,record,businessKey:signupBusinessKey(record)};}
 return {rows,attempts,prisma,add,listSignups:()=>records,get records(){return records;},setRecords:value=>{records=value;},get writes(){return writes;},get reads(){return reads;}};
}
module.exports={fixture};
