// Shared rows model persisted DB state across independently constructed workers.
function memoryDb() {
  const rows = new Map(); let tail = Promise.resolve();
  const match = (row, where = {}) => {
    if (where.key?.startsWith && !row.key.startsWith(where.key.startsWith)) return false;
    if (where.AND && !where.AND.every(w => match(row, w))) return false;
    if (where.OR && !where.OR.some(w => match(row, w))) return false;
    if (where.data) {
      const f=where.data, v=f.path.reduce((d,k)=>d?.[k],row.data);
      if ('equals' in f && v!==f.equals) return false;
      if ('lte' in f && !(v<=f.lte)) return false;
      if ('lt' in f && !(v<f.lt)) return false;
    }
    return true;
  };
  const runtimeStore = {
    async findUnique({where}) {return rows.has(where.key)?structuredClone(rows.get(where.key)):null;},
    async upsert({where,create,update}) {const row={key:where.key,data:structuredClone(rows.has(where.key)?update.data:create.data),updatedAt:new Date()};rows.set(where.key,row);return structuredClone(row);},
    async findMany({where,take}) {return [...rows.values()].filter(r=>match(r,where)).slice(0,take).map(r=>structuredClone(r));},
    async deleteMany({where}) {for(const [k,r] of rows)if(match(r,where))rows.delete(k);},
  };
  const prisma={runtimeStore, $transaction(work){const job=tail.then(()=>work({runtimeStore,$queryRaw:async()=>[]}));tail=job.catch(()=>{});return job;}};
  return {prisma,rows};
}
module.exports={memoryDb};
