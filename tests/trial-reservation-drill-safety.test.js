const test=require('node:test'),assert=require('node:assert/strict');
const {validateDrillTarget}=require('../scripts/trial-reservation-drill-safety');
const good={CI:'true',RUN_TRIAL_RESERVATION_DRILL:'1',TRIAL_RESERVATION_DRILL_DATABASE_URL:
  'postgresql://trial_drill:synthetic-ci-only@127.0.0.1:5432/myaipa_trial_reservation_drill_ci?connection_limit=4'};
test('drill accepts only an explicitly enabled disposable loopback target',()=>{assert.equal(validateDrillTarget(good),good.TRIAL_RESERVATION_DRILL_DATABASE_URL);});
test('drill refuses disabled runs and never falls back to DATABASE_URL',()=>{
  for(const env of [{},{...good,CI:'false'},{...good,RUN_TRIAL_RESERVATION_DRILL:'0'},
    {...good,TRIAL_RESERVATION_DRILL_DATABASE_URL:'',DATABASE_URL:good.TRIAL_RESERVATION_DRILL_DATABASE_URL}])assert.throws(()=>validateDrillTarget(env));
});
test('drill rejects any changed host, credentials, database, port or URL options',()=>{
  for(const url of [good.TRIAL_RESERVATION_DRILL_DATABASE_URL.replace('127.0.0.1','production.example'),
    good.TRIAL_RESERVATION_DRILL_DATABASE_URL.replace('trial_drill:','other:'),
    good.TRIAL_RESERVATION_DRILL_DATABASE_URL.replace('synthetic-ci-only','other'),
    good.TRIAL_RESERVATION_DRILL_DATABASE_URL.replace('5432','5433'),
    good.TRIAL_RESERVATION_DRILL_DATABASE_URL.replace('myaipa_trial_reservation_drill_ci','myaipa'),
    good.TRIAL_RESERVATION_DRILL_DATABASE_URL+'&sslmode=require',good.TRIAL_RESERVATION_DRILL_DATABASE_URL+'#fragment'])
    assert.throws(()=>validateDrillTarget({...good,TRIAL_RESERVATION_DRILL_DATABASE_URL:url}));
});
test('no provider credentials may enter the no-send drill',()=>{
  for(const k of ['VAPI_API_KEY','TWILIO_AUTH_TOKEN','TELEGRAM_BOT_TOKEN','STRIPE_SECRET_KEY','MAKE_API_KEY','SMTP_PASSWORD'])
    assert.throws(()=>validateDrillTarget({...good,[k]:'must-not-enter'}));
});
