import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import CopaTejasTable, { COMPETITIONS } from "./CopaTejasTable";
import ShieldTable from "./ShieldTable";
import reportWebVitals from "./reportWebVitals";

/**
 * One page per competition, chosen from the URL so each can be iframed on its own:
 *   /        or /mls   -> MLS (Austin FC, FC Dallas, Houston Dynamo)
 *   /uslc              -> USL Championship (El Paso Locomotive, San Antonio FC)
 *   /shield            -> Copa Tejas Shield (every Texas club, all leagues, by PPG)
 * `?competition=uslc` works too. vercel.json rewrites the paths to this page.
 */
const PAGES = { ...COMPETITIONS, shield: { id: "shield", label: "Shield" } };

function pageFromLocation() {
  const pathSegment = window.location.pathname.replace(/\/+$/, "").split("/").pop().toLowerCase();
  const queryValue = (new URLSearchParams(window.location.search).get("competition") || "").toLowerCase();
  return PAGES[pathSegment]?.id || PAGES[queryValue]?.id || "mls";
}

const page = pageFromLocation();
document.title = `Copa Tejas Table - ${PAGES[page].label}`;

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    {page === "shield" ? <ShieldTable /> : <CopaTejasTable competition={page} />}
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
