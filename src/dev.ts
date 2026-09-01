import { createApp } from "./app";
import { loadConfig } from "./config";
import { createProfileRepository } from "./db/repository";
import { loadDevelopmentIdentity } from "./development-auth";

const config = loadConfig();
const developmentIdentity = loadDevelopmentIdentity();
const repository = createProfileRepository(config.databaseUrl);
const app = createApp({ config, repository, developmentIdentity });

app.listen({ port: config.port, hostname: "0.0.0.0" });
console.log(
  `Profile development API is listening on http://0.0.0.0:${config.port} (${developmentIdentity ? "local identity" : "Authentik OIDC"})`,
);

async function shutdown() {
  await app.stop();
  await repository.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
