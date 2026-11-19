import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Signup from '../src/Signup';
import AdminSignupTracker from '../src/AdminSignupTracker';
import IntuitiveLandingPage from '../src/IntuitiveLandingPage';
import {navigateToSignup,installSignupStartLinks} from '../src/features/signup/signupStartIntent';
import '../src/tailwind.generated.css';
import '../src/AdminDashboard.css';
function Preview() {
  const read=()=>window.location.hash.replace(/^#\/?/,'').split('?')[0]||'home';
  const [route,setRoute]=useState(read);
  useEffect(() => {const sync=()=>setRoute(read()),stop=installSignupStartLinks();window.addEventListener('hashchange',sync);return()=>{window.removeEventListener('hashchange',sync);stop();};},[]);
  return <><nav style={{ padding: '12px', background: '#123c32', color: 'white', font: '12px system-ui' }}>LOCAL SYNTHETIC FORM TEST · No live customers/provider operations <button type="button" onClick={navigateToSignup} style={{margin:'0 15px'}}>Open signup form</button><button type="button" onClick={()=>{window.location.hash='/admin';}}>Open admin report</button></nav>{route==='admin'?<main className="myai-admin" style={{padding:'8px 12px 30px',maxWidth:1480,margin:'auto'}}><AdminSignupTracker/></main>:route==='signup'?<Signup/>:<IntuitiveLandingPage/>}</>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
