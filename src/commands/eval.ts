import { Config, Execute } from "@/types";

export const config: Config = {
  name: "eval",
  description: "eval ide.",
  usage: "/eval [code]",
  permission: "admin",
  creator: "itsunknown",
};

function mapToObj(map: Map<any, any>) {
  const obj: Record<string, any> = {};
  map.forEach((v, k) => {
    obj[k] = v;
  });
  return obj;
}

export async function execute({ api, event, args }: Execute) {
  // Under the multi-user web dashboard, every tenant's bot runs inside
  // the same Node process (see src/bot/manager.ts) so they can share
  // resources on a single PaaS dyno. That means arbitrary code run here
  // isn't sandboxed per-tenant — it has access to this process's memory,
  // env vars (including ENCRYPTION_KEY), and every other tenant's
  // decrypted bot token. Left disabled unless explicitly opted into via
  // ENABLE_EVAL_COMMAND=true, which should only be set on a
  // single-tenant/trusted deployment.
  if (process.env.ENABLE_EVAL_COMMAND !== "true") {
    await api.sendMessage(
      event.chat.id,
      "❌ /eval is disabled on this deployment (it isn't isolated between tenants in the shared bot process).",
    );
    return false;
  }
  // `out` isn't called anywhere in this file directly — it's exposed to
  // whatever code the admin passes to /eval, which runs in this same
  // closure via `eval()` below and can call `out(...)` to format and
  // send a result. Static analysis can't see that dynamic usage, hence
  // the no-op reference at the bottom of this function.
  function out(result: any) {
    if (
      typeof result === "number" ||
      typeof result === "boolean" ||
      typeof result === "function"
    ) {
      result = result.toString();
    } else if (result instanceof Map) {
      let text = `Map(${result.size}) `;
      text += JSON.stringify(mapToObj(result), null, 2);
      result = text;
    } else if (typeof result === "object") {
      result = JSON.stringify(result, null, 2);
    } else if (typeof result === "undefined") {
      result = "undefined";
    }

    api.sendMessage(event.chat.id, result);
  }
  void out;

  const code = `
      (async () => {
        try {
          ${args.join(" ")}
        } catch (err) {
          console.error("Eval command error:", err);
          api.sendMessage(event.chat.id, \`Error:\\n\${err.stack || err.message}\`);
        }
      })();
    `;

  try {
    eval(code);
  } catch (err: any) {
    await api.sendMessage(event.chat.id, `Error:\n${err.stack || err.message}`);
    return false;
  }
}
