import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import RouteBoundary from './components/RouteBoundary';
import { installClientErrorReporting } from "./clientErrorReporter";
import { installSignupStartLinks } from './features/signup/signupStartIntent';
import "./tailwind.generated.css";
import "./style.css";

const AdminDashboard=React.lazy(()=>import(/* webpackChunkName: "admin" */ './AdminDashboard'));
const CustomerDashboard=React.lazy(()=>import(/* webpackChunkName: "customer" */ './CustomerDashboard'));
const Signup=React.lazy(()=>import(/* webpackChunkName: "signup" */ './Signup'));
const Privacy=React.lazy(()=>import('./Privacy'));
const Terms=React.lazy(()=>import('./Terms'));
const LinksPage=React.lazy(()=>import('./LinksPage'));
const TryDemo=React.lazy(()=>import('./TryDemo'));
const TradePages=React.lazy(()=>import('./TradePages'));
const FirstClassRentalsDemo=React.lazy(()=>import('./FirstClassRentalsDemo'));
const DeanAllisonDemo=React.lazy(()=>import('./DeanAllisonDemo'));
const ForwardingSetup=React.lazy(()=>import('./ForwardingSetup'));

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
  else if (route === "forwarding-setup" || route.startsWith("f/")) page = <ForwardingSetup />;
  else if (route === "demo/first-class-rentals") page = <FirstClassRentalsDemo />;
  else if (route === "demo/dean-allison") page = <DeanAllisonDemo />;
  else if (route === "trades") page = <TradePages />;
  else if (route.startsWith("trades/")) page = <TradePages slug={route.slice("trades/".length)} />;

  return <RouteBoundary route={route}><React.Suspense fallback={<main role="status" style={{padding:'2rem'}}>Loading your page…</main>}>{page}</React.Suspense></RouteBoundary>;
}

installClientErrorReporting();
installSignupStartLinks();
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
