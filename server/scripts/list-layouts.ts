import { getDb } from "../src/db/index.js"; import { layouts } from "../src/db/schema.js"; console.log(await getDb().select().from(layouts).all());
