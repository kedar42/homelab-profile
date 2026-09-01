import { createApp } from "./app";
import { loadConfig } from "./config";
import { loadDatabaseConfig } from "./db/config";
import { createProfileRepository } from "./db/repository";
import { loadDevelopmentIdentity, withDevelopmentAuthDefaults } from "./development-auth";

const developmentIdentity = loadDevelopmentIdentity();
const developmentEnvironment = withDevelopmentAuthDefaults(process.env, developmentIdentity);
const config = loadConfig(developmentEnvironment);
const databaseConfig = loadDatabaseConfig(developmentEnvironment);
const repository = createProfileRepository(databaseConfig);
const app = createApp({ config, repository, developmentIdentity });

app.listen({ port: config.port, hostname: "0.0.0.0" });
console.log(
  `Profile development API is listening on http://0.0.0.0:${config.port} (${developmentIdentity ? "local identity" : "Authentik OIDC"}, ${databaseConfig.driver})`,
);
if (developmentEnvironment !== process.env) {
  console.warn("Using the built-in development-only cookie secret.");
}

async function shutdown() {
  await app.stop();
  await repository.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
