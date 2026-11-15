const clone = value => value == null ? value : structuredClone(value);
function memoryCalendarDb() {
  const rows = new Map(); let queue = Promise.resolve();
  const tx = {
    $queryRaw:async()=>[],
    runtimeStore:{
      findUnique:async({where})=>rows.has(where.key)?{key:where.key,data:clone(rows.get(where.key))}:null,
      create:async({data})=>{if(rows.has(data.key))throw Error('duplicate fixture key');rows.set(data.key,clone(data.data));return clone(data);},
    },
  };
  const db = {$transaction:fn=>{
    const job=queue.then(async()=>{const before=clone([...rows]);try{return await fn(tx);}catch(error){rows.clear();for(const[k,v]of before)rows.set(k,v);throw error;}});
    queue=job.catch(()=>{});return job;
  }};
  return {db,rows};
}
module.exports={memoryCalendarDb};
