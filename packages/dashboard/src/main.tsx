import { render } from "preact";

import { App } from "./app";
import "./styles/tokens.css";
import "./styles/app.css";

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Fabric Dashboard root element #app was not found.");
}

render(<App />, root);
