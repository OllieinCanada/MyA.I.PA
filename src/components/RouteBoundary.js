import React from 'react';
export default class RouteBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){/* No account data is exported or cleared here. */}
  componentDidUpdate(previous){if(previous.route!==this.props.route&&this.state.failed)this.setState({failed:false});}
  render(){return this.state.failed?<main role="alert" style={{padding:'2rem',maxWidth:640,margin:'auto'}}>
    <h1>This page could not load</h1><p>Your saved account data has not been cleared. Reload to request the current page files. Unsaved edits may be lost.</p>
    <button type="button" onClick={()=>window.location.reload()}>Reload page</button><p><a href="#/">Back to homepage</a></p>
  </main>:this.props.children;}
}
