import { treaty } from "@elysia/eden";
import type { App } from "../../src/app";

export const api = treaty<App>(window.location.origin);
