import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.STUDIO_PORT ?? 4317);
app.listen(port, () => {
  console.log(`[studio] Documentary Studio API listening on http://localhost:${port}`);
});
