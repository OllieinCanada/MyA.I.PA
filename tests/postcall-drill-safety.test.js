const test = require('node:test'), assert = require('node:assert/strict');
const { validatePostCallDrill } = require('../scripts/postcall-drill-safety');
const target='postgresql://postcall_drill:synthetic-ci-only@127.0.0.1:5432/myaipa_postcall_drill_ci?connection_limit=4';
const env={RUN_POSTCALL_PERSISTENCE_DRILL:'1',DISABLE_LOCAL_ENV_FILES:'1',DATABASE_URL:target,POSTCALL_PERSISTENCE_DRILL_DATABASE_URL:target};
test('post-call drill admits only the explicit loopback disposable database',()=>assert.equal(validatePostCallDrill(env),target));
for(const [name,changes] of [['missing opt-in',{RUN_POSTCALL_PERSISTENCE_DRILL:''}],['local env files',{DISABLE_LOCAL_ENV_FILES:''}],
 ['mismatching datasource',{DATABASE_URL:target+'x'}],['provider credential',{VAPI_API_KEY:'synthetic-should-also-be-refused'}],
 ['remote host',{DATABASE_URL:target.replace('127.0.0.1','example.invalid'),POSTCALL_PERSISTENCE_DRILL_DATABASE_URL:target.replace('127.0.0.1','example.invalid')}],
 ['different database',{DATABASE_URL:target.replace('myaipa_postcall_drill_ci','production'),POSTCALL_PERSISTENCE_DRILL_DATABASE_URL:target.replace('myaipa_postcall_drill_ci','production')}],
 ['injected options',{DATABASE_URL:target+'&options=x',POSTCALL_PERSISTENCE_DRILL_DATABASE_URL:target+'&options=x'}]]) {
 test('post-call drill refuses '+name,()=>assert.throws(()=>validatePostCallDrill({...env,...changes}),/postcall_drill_/));
}
