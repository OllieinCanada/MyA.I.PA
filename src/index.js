import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AdminDashboard from "./AdminDashboard";
import CustomerDashboard from "./CustomerDashboard";
import Signup from "./Signup";
import Privacy from "./Privacy";
import Terms from "./Terms";
import LinksPage from "./LinksPage";
import TryDemo from "./TryDemo";
import "./style.css";

const getRoute = () => {
  const hashRoute = window.location.hash
    .replace(/^#\/?/, "")
    .split(/[?#]/)[0]
    .toLowerCase();
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
  if (route === "admin") page = <AdminDashboard />;
  else if (route === "dashboard") page = <CustomerDashboard />;
  else if (route === "signup") page = <Signup />;
  else if (route === "privacy") page = <Privacy />;
  else if (route === "terms") page = <Terms />;
  else if (route === "links") page = <LinksPage />;
  else if (route === "try-demo") page = <TryDemo />;

  return page;
}

createRoot(document.getElementById("root")).render(<RouterRoot />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const publicUrl = process.env.PUBLIC_URL || "";
    navigator.serviceWorker
      .register(`${publicUrl}/sw.js`, { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}
