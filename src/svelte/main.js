import App from "./App.svelte";
import { mount } from "svelte";
import "simple-datatables/dist/style.css";

const app = mount(App, {
  target: document.getElementById("app"),
});

export default app;
