import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import LegacyApp from "./Hello";
import Signup from "./Signup";
import AdminDashboard from "./AdminDashboard";
import VoiceAssistant from "./components/VoiceAssistant";
import "./style.css";

const getRoute = () => {
  const hashRoute = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hashRoute) return hashRoute;
  const pathRoute = window.location.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return pathRoute || "home";
};

function RouterRoot() {
  const [route, setRoute] = React.useState(getRoute());

  React.useEffect(() => {
    const syncRoute = () => setRoute(getRoute());
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  let page = <App />;
  if (route === "signup") page = <Signup />;
  else if (route === "admin") page = <AdminDashboard />;
  else if (route === "hello" || route === "legacy") page = <LegacyApp />;

  return (
    <>
      {page}
      {route !== "home" ? <VoiceAssistant placement="bottom-right" /> : null}
    </>
  );
}

ReactDOM.render(<RouterRoot />, document.getElementById("root"));
