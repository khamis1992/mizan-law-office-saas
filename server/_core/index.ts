import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { recurringBillingHandler } from "../recurringBilling";
import { serveStatic, setupVite } from "./vite";

/** مهمة دورية: إشعارات الجلسات القريبة وتنبيهات التقادم — تُستدعى من Heartbeat. */
export async function dispatchOfficeRemindersHandler(req: express.Request, res: express.Response) {
  try {
    const baseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) return res.status(500).json({ error: 'service credentials not configured' });
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
    const [hearings, limitations] = await Promise.all([
      fetch(`${baseUrl}/rest/v1/rpc/dispatch_hearing_reminders`, { method: 'POST', headers, body: JSON.stringify({}) }),
      fetch(`${baseUrl}/rest/v1/rpc/dispatch_limitation_alerts`, { method: 'POST', headers, body: JSON.stringify({}) }),
    ]);
    const hearingCount = await hearings.json().catch(() => 0);
    const limitationCount = await limitations.json().catch(() => 0);
    if (!hearings.ok) throw new Error(`hearing reminders RPC failed: ${JSON.stringify(hearingCount)}`);
    if (!limitations.ok) throw new Error(`limitation alerts RPC failed: ${JSON.stringify(limitationCount)}`);
    return res.json({ ok: true, hearing_reminders: Number(hearingCount ?? 0), limitation_alerts: Number(limitationCount ?? 0) });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post('/api/scheduled/recurring-billing', recurringBillingHandler);
  app.post('/api/scheduled/office-reminders', dispatchOfficeRemindersHandler);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
