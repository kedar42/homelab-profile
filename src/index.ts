import { addWebClient, createApp } from "./app";
import { assertAuthentikServiceCredential, loadConfig } from "./config";
import { assertProductionDatabase, loadDatabaseConfig } from "./db/config";
import { createProfileRepository } from "./db/repository";
import { assertDevelopmentAuthDisabled } from "./development-auth";

assertDevelopmentAuthDisabled();
const config = loadConfig();
assertAuthentikServiceCredential(config);
const databaseConfig = loadDatabaseConfig();
assertProductionDatabase(databaseConfig);
const repository = createProfileRepository(databaseConfig);
const app = await addWebClient(createApp({ config, repository }));

app.listen({ port: config.port, hostname: "0.0.0.0" });
console.log(
  `Profile API is listening on http://0.0.0.0:${config.port} (public origin: ${config.appUrl.origin})`,
);

async function shutdown() {
  await app.stop();
  await repository.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
