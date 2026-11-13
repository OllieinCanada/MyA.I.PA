// Maintenance entry point only; no default enabling, client-supplied proof,
// independent fence, transport construction, broad recovery or journal reset.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { createBoundedBusinessMappingWriter } = require('./boundedBusinessMappingWriter');
const { createBoundedMappingLease, createBoundedMappingEvidenceReader } = require('./boundedBusinessMappingAdapters');
const fail = (code, statusCode = 409) => { throw Object.assign(new Error(code), { code, statusCode }); };
function stable(x) { if (Array.isArray(x)) return x.map(stable); return x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x; }
const digest = x => crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function readOperatorPolicy(directory) {
  const file=path.join(path.resolve(directory),'bounded-mapping-operator-policy.json');
  if(!fs.existsSync(file))return null;
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)fail('MAPPING_CONTROL_POLICY_FILE_INVALID');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function createBoundedMappingControl({ prisma, fence, readStore, getSigningSecret, getRelease, getOperatorPolicy,
  probe, readOverrides, enabled=()=>false, applyEnabled=()=>false, singleWriter=()=>false, now=()=>Date.now(), writerFactory=createBoundedBusinessMappingWriter }) {
  const cache=new Map();
  function policy(actor, id) {
    const doc=structuredClone(getOperatorPolicy());
    if(!doc||doc.schemaVersion!==1||!equal(doc.policyId,id)||!equal(doc.operatorSessionHash,actor)
      || !/^[a-f0-9]{64}$/.test(doc.policyId||'') || !doc.target || doc.target.release!==getRelease()
      || !Number.isFinite(Date.parse(doc.expiresAt)) || Date.parse(doc.expiresAt)<=now() || Date.parse(doc.expiresAt)>now()+900000) fail('MAPPING_CONTROL_POLICY_REQUIRED',403);
    return {doc,version:digest({schemaVersion:1,policyId:doc.policyId,operatorSessionHash:doc.operatorSessionHash,target:doc.target,expiresAt:doc.expiresAt})};
  }
  function authorize(auth) {
    if(!enabled())fail('MAPPING_CONTROL_DISABLED',403);
    const actor=auth?.reauthorize?.();
    if(!/^[a-f0-9]{64}$/.test(actor||'')||!equal(actor,auth.actorHash))fail('MAPPING_CONTROL_SESSION_REQUIRED',401);
    if(!/^[a-f0-9]{40}$/.test(getRelease()||''))fail('MAPPING_CONTROL_RELEASE_REQUIRED');
    return actor;
  }
  function makeWriter(doc,snapshot,assertAdmission=()=>fail('MAPPING_CONTROL_APPLY_NOT_APPROVED',403)) {
    return writerFactory({prisma,policy:doc.target,enabled:()=>enabled()&&applyEnabled(),singleWriter,
      withAssociationLease:createBoundedMappingLease({fence,readStore,policy:doc.target,singleProcess:singleWriter}),
      readEvidence:createBoundedMappingEvidenceReader({readStore,getProviderSnapshot:()=>snapshot,getSigningSecret,getRelease,now}),readOverrides,now,assertAdmission});
  }
  const proofHash = s => digest({release:s.release,scope:s.scope,provider:s.provider,reserveNumbers:[...(s.reserveNumbers||[])].sort()});
  async function freshProbe(doc) {
    const started=now(),s=structuredClone(await probe(doc.target));
    if(s?.complete!==true||s.release!==getRelease()||digest(s.scope)!==digest(doc.target)
      || !Number.isFinite(Date.parse(s.checkedAt)) || Date.parse(s.checkedAt)<started || Date.parse(s.checkedAt)>now())fail('MAPPING_CONTROL_PROOF_UNAVAILABLE',503);
    return s;
  }
  async function execute(body,auth) {
    const actor=authorize(auth);
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['action','policyId','planDigest','confirmation'].includes(k))
      || !['identify','dry_run','inspect','apply'].includes(body.action))fail('MAPPING_CONTROL_REQUEST_INVALID',400);
    if(body.action==='identify') {
      if(Object.keys(body).length!==1)fail('MAPPING_CONTROL_REQUEST_INVALID',400);
      return {operatorSessionHash:actor,release:getRelease(),readOnly:true,readinessGranted:false};
    }
    let {doc,version}=policy(actor,body.policyId);
    let entry=cache.get(doc.policyId);
    if(entry?.busy)fail('MAPPING_CONTROL_BUSY');
    if(body.action==='apply') {
      if(!applyEnabled()||body.confirmation!=='APPLY_EXISTING_BUSINESS_MAPPINGS_ONLY'
        || !/^[a-f0-9]{64}$/.test(body.planDigest||'')||!equal(doc.approvedPlanDigest,body.planDigest))fail('MAPPING_CONTROL_APPLY_NOT_APPROVED',403);
      if(entry?.attempted)fail('MAPPING_CONTROL_INSPECT_FIRST');
      if(!entry||entry.version!==version||!equal(entry.plan?.planDigest,body.planDigest)
        || now()-entry.createdAt>240000)fail('MAPPING_CONTROL_FRESH_DRY_RUN_REQUIRED');
    } else if(body.planDigest!==undefined||body.confirmation!==undefined)fail('MAPPING_CONTROL_REQUEST_INVALID',400);
    if(!entry) {
      if(cache.size>=8)fail('MAPPING_CONTROL_CAPACITY');
      entry={version,busy:false,attempted:false};cache.set(doc.policyId,entry);
    }
    entry.busy=true;
    try {
      if(body.action==='inspect') {
        const writer=entry.version===version&&entry.writer?entry.writer:makeWriter(doc,null);
        return {readOnly:true,...await writer.inspectOutcome(),readinessGranted:false};
      }
      if(body.action==='dry_run') {
        if(entry.attempted)fail('MAPPING_CONTROL_INSPECT_FIRST');
        const snapshot=await freshProbe(doc);authorize(auth);
        if(policy(actor,doc.policyId).version!==version)fail('MAPPING_CONTROL_POLICY_CHANGED');
        const assertAdmission=()=>{
          authorize(auth);
          const current=policy(actor,doc.policyId);
          if(!applyEnabled()||!singleWriter()||current.version!==version||!entry.plan
            ||!equal(current.doc.approvedPlanDigest,entry.plan.planDigest)||now()-entry.createdAt>240000
            ||now()-Date.parse(snapshot.checkedAt)>240000)fail('MAPPING_CONTROL_APPLY_NOT_APPROVED',403);
          return true;
        };
        const writer=makeWriter(doc,snapshot,assertAdmission),plan=await writer.prepare();
        Object.assign(entry,{version,snapshot,writer,plan,createdAt:now()});
        return {policyId:doc.policyId,...plan,expiresAt:new Date(Math.min(Date.parse(doc.expiresAt),entry.createdAt+240000)).toISOString(),
          dryRun:true,databaseWrites:0,readinessGranted:false};
      }
      const fresh=await freshProbe(doc);authorize(auth);
      const current=policy(actor,doc.policyId);
      if(current.version!==version||!applyEnabled()||!equal(current.doc.approvedPlanDigest,body.planDigest))fail('MAPPING_CONTROL_APPLY_NOT_APPROVED',403);
      if(proofHash(fresh)!==proofHash(entry.snapshot))fail('MAPPING_CONTROL_PROOF_CHANGED');
      // Retain the honest original capture time: changing it would change the
      // prepared digest. This independent fresh matching probe is admission
      // evidence, not a false timestamp refresh of the prepared snapshot.
      if(now()-Date.parse(entry.snapshot.checkedAt)>240000)fail('MAPPING_CONTROL_FRESH_DRY_RUN_REQUIRED');
      entry.attempted=true;
      return {...await entry.writer.apply(body.planDigest,actor),freshProofCheckedAt:fresh.checkedAt,readinessGranted:false};
    } finally {entry.busy=false;}
  }
  return {execute};
}
function registerBoundedMappingControlRoutes({app,requireAdmin,limiter,isAllowedOrigin,actorHash,service}) {
  app.post('/api/admin/signups/bounded-business-mapping',limiter,requireAdmin,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {
      if(!req.headers.origin||!isAllowedOrigin(req.headers.origin)||req.headers['x-myaipa-mapping-correction']!=='1'
        || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))fail('MAPPING_CONTROL_ORIGIN_REQUIRED',403);
      const auth={actorHash:actorHash(req),reauthorize:()=>actorHash(req)};
      res.json({ok:true,...await service.execute(req.body,auth)});
    } catch(error) {
      const known=/^MAPPING_[A-Z_]+$/.test(error.code||'');
      res.status(known?(error.statusCode||409):503).json({ok:false,code:known?error.code:'MAPPING_CONTROL_PROOF_UNAVAILABLE',readinessGranted:false,
        uncertain:known&&/UNCERTAIN|UNCONFIRMED|INSPECT_FIRST/.test(error.code)});
    }
  });
}
module.exports={createBoundedMappingControl,registerBoundedMappingControlRoutes,readOperatorPolicy};
