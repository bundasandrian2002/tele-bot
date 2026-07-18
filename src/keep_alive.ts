import express, { Request, Response } from "express";

const app = express();

app.get("/", (_req: Request, res: Response) => {
  res.send("Telegram Bot by @libyzyx0");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Keep-alive server listening on port ${PORT}`),
);
