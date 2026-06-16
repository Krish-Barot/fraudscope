// apps/api/src/index.ts
// Entry point for the API server
// TypeScript version — tsx runs this directly in development

import express, { Request, Response } from 'express';
import dotenv from "dotenv";
import path from 'path';

const app = express();
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
});
const PORT = process.env.PORT;

app.use(express.json());

// Health check endpoint — used by Docker and load balancers
// to know if the API is alive
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: "ok",
        service: "fraudscope_api",
        timeStamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`FraudScope API running on port ${PORT}`);
})