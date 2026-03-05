import React from "react";
import ReactDOM from "react-dom";
import App from "./Hello";
import Signup from "./Signup";
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

  if (route === "signup") return <Signup />;
  return <App />;
}

ReactDOM.render(<RouterRoot />, document.getElementById("root"));
