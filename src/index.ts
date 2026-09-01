import { addWebClient, createApp } from "./app";
import { loadConfig } from "./config";
import { createProfileRepository } from "./db/repository";
import { assertDevelopmentAuthDisabled } from "./development-auth";

assertDevelopmentAuthDisabled();
const config = loadConfig();
const repository = createProfileRepository(config.databaseUrl);
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
