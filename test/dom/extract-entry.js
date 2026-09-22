/* Test entry: exposes the content script's pure DOM layer on `window`. */
import * as posts from "../../src/content/posts.js";

globalThis.__deslopify = posts;
