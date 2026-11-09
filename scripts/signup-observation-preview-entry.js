import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Signup from '../src/Signup';
import AdminSignupTracker from '../src/AdminSignupTracker';
import '../src/tailwind.generated.css';
function Preview() {
  const [admin, setAdmin] = useState(window.location.hash.includes('admin'));
  useEffect(() => { const read=()=>setAdmin(window.location.hash.includes('admin')); window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read); },[]);
  return <><nav style={{ padding: '12px', background: '#123c32', color: 'white', font: '12px system-ui' }}>LOCAL SYNTHETIC FORM TEST · No live customers/provider operations <button type="button" onClick={()=>{window.location.hash='/signup';}} style={{margin:'0 15px'}}>Open signup form</button><button type="button" onClick={()=>{window.location.hash='/admin';}}>Open admin report</button></nav>{admin?<AdminSignupTracker/>:<Signup/>}</>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
