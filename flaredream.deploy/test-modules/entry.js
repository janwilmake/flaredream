import { readFile } from "some-package";
import wrangler from "./wrangler.json";
import toml from "./some.toml";
import yaml from "./some.yaml";
import jsonc from "./some.jsonc";
export default {
  /**
   *
   * @param {Request} request
   * @returns
   */
  fetch: (request) => {
    const url = new URL(request.url);
    const content = readFile(url.pathname);

    return new Response(
      `Hello, you are visiting ${request.url}. Content of file is: 
      
"""
${content}
"""

JSON is a JS Object:

${JSON.stringify(wrangler)}

a property can be accessed:

wrangler.name: ${wrangler.name}


TOML is a JS Object

${JSON.stringify(toml)}


YAML is a JS Object

${JSON.stringify(yaml)}


JSONC is a JS Object

${JSON.stringify(jsonc)}

`
    );
  },
};
